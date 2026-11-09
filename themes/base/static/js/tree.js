/**
 * Miller Columns Tree Navigation
 *
 * Drives the lazy-loading hierarchical tree used on repository
 * landing pages and on description pages that have children, to browse
 * an archival fonds top-down. Each column lists the children of the item
 * selected in the previous column; clicking an item reveals the next column
 * to its right. Children are fetched on demand from per-parent JSON shards
 * emitted by the build pipeline, and responses are cached so
 * back-navigation in the tree is instantaneous.
 *
 * Pipeline context:
 *   Loaded as a classic `<script>` tag from the repository landing
 *   template and from the description template. Reads per-parent child
 *   listings from the build's data shards; render targets are inside the
 *   template's `.miller-columns` host. The interface strings and the level
 *   labels (plural and singular, from the active standards profile) arrive
 *   in a `<script type="application/json" id="tree-strings">` block that the
 *   `tree-strings` partial writes into the page, so the UI copy stays in the
 *   i18n bundles and the profiles and this file holds none.
 *
 * Two rules decide what the tree prints for an item:
 *
 *   - The number before a leaf item's title is the record's
 *     `local_identifier`. Null or an empty string means no number. A record
 *     that does not carry the field at all, as in an export made before the
 *     field existed, gets the number parsed from its reference code instead
 *     (`deprecatedNumberFromReferenceCode`, removed in 2.0.0).
 *
 *   - The count under a container ("12 files") names the level in
 *     `children_level`. When the record has none, the most common
 *     `description_level` among the children the tree has already loaded is
 *     used; when that is unknown too, the generic unit string from i18n.
 *
 * The rule functions are plain functions at the top of the file, and they are
 * exported for Node when `module` exists, so tests can run them without a DOM.
 *
 * @version v1.6.0
 */

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Deprecated: parse an item number out of a reference code. It assumes one
 * publisher's code grammar and is kept only for exports that predate the
 * `local_identifier` field. It will be removed in 2.0.0.
 *
 * Scans the dash-separated segments from the end:
 *   1. "dNNN" or "nNNN" (for example `d003`) returns the digits, "003".
 *   2. Otherwise the last purely numeric segment is returned as it is.
 * An example code: `xx-arch-001-d003` gives "003".
 *
 * @param {string|null|undefined} refCode
 * @returns {string|null}
 */
function deprecatedNumberFromReferenceCode(refCode) {
  if (!refCode) return null;

  const parts = refCode.split('-');

  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[dn]\d+$/.test(parts[i])) {
      return parts[i].substring(1);
    }
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i])) {
      return parts[i];
    }
  }

  return null;
}

/**
 * The number shown before a leaf item's title.
 *
 * A record that carries `local_identifier` uses it: null, an empty string
 * or whitespace alone gives no number, and the reference code is not
 * consulted. Only a record without the key at all falls back to the
 * deprecated reference-code parse.
 *
 * @param {object} item
 * @returns {string|null}
 */
function itemNumber(item) {
  if (item && item.local_identifier !== undefined) {
    const value = item.local_identifier;
    if (value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  }
  return deprecatedNumberFromReferenceCode(item && item.reference_code);
}

/**
 * The level key that names an item's children: `children_level` from the
 * record, else the most common `description_level` among the children
 * already loaded, else null. Ties go to the level seen first.
 *
 * @param {object} item
 * @param {Array|undefined} loadedChildren
 * @returns {string|null}
 */
function childLevelKey(item, loadedChildren) {
  if (item && item.children_level) return item.children_level;

  const counts = new Map();
  for (const child of loadedChildren || []) {
    const level = child && child.description_level;
    if (level) counts.set(level, (counts.get(level) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [level, n] of counts) {
    if (n > bestCount) {
      best = level;
      bestCount = n;
    }
  }
  return best;
}

/**
 * The count text under a container, for example "12 files" or "1 expediente".
 *
 * `strings` carries `locale`, `i18n` (with the generic `childUnit` one/other
 * pair), `levelsSingular` and `levelsPlural`. A level the profile does not
 * name, or a page with no level labels, uses the generic unit; a page with no
 * strings at all gets the bare number.
 *
 * @param {number} count
 * @param {string|null} levelKey
 * @param {object} strings
 * @returns {string}
 */
function childCountText(count, levelKey, strings) {
  const locale = strings.locale || 'en';
  const form = new Intl.PluralRules(locale.split('-')[0]).select(count) === 'one' ? 'one' : 'other';
  const number = new Intl.NumberFormat(locale).format(count);

  const labels = (form === 'one' ? strings.levelsSingular : strings.levelsPlural) || {};
  let label = levelKey ? labels[levelKey] : null;
  if (!label) {
    const unit = (strings.i18n && strings.i18n.childUnit) || {};
    label = unit[form] || unit.other || '';
  }
  return label ? `${number} ${label}` : number;
}

class MillerColumnsTree {
  constructor(container, options = {}) {
    this.container = container;
    this.repoCode = options.repoCode || '';
    this.i18n = options.i18n || {};
    this.columns = [];
    this.cache = new Map(); // Cache fetched children

    // Locale and level labels for the child-count text (see childCountText)
    this.strings = {
      locale: options.locale || document.documentElement.lang || 'en',
      i18n: this.i18n,
      levelsPlural: options.levelsPlural || {},
      levelsSingular: options.levelsSingular || {},
    };

    this.init();
  }

  init() {
    this.container.classList.add('miller-columns');
    this.container.innerHTML = '<div class="miller-columns-wrapper"></div>';
    this.wrapper = this.container.querySelector('.miller-columns-wrapper');
  }

  /**
   * Load initial data (root items)
   */
  async loadRoot(rootDescriptions) {
    this.clearColumns();
    const column = this.createColumn(rootDescriptions, 0, this.i18n.contentLabel || '');
    this.wrapper.appendChild(column);
    this.columns.push(column);
  }

  /**
   * Create a column with items
   */
  createColumn(items, depth, title = '') {
    const column = document.createElement('div');
    column.className = 'miller-column';
    column.dataset.depth = depth;

    // Column header with title and filter
    const header = document.createElement('div');
    header.className = 'miller-column-header';

    if (title) {
      const titleSpan = document.createElement('span');
      titleSpan.className = 'miller-column-title';
      titleSpan.textContent = title;
      header.appendChild(titleSpan);
    }

    // Filter input (shown in rightmost/active column)
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.placeholder = this.i18n.filterPlaceholder || '';
    filterInput.className = 'column-filter';
    filterInput.addEventListener('input', (e) => this.filterColumn(column, e.target.value));
    filterInput.addEventListener('click', (e) => e.stopPropagation());
    header.appendChild(filterInput);

    column.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'miller-column-list';

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'miller-item';
      li.dataset.id = item.id;
      li.dataset.refCode = item.reference_code;
      li.dataset.hasChildren = item.child_count > 0;

      // Item content
      const content = document.createElement('div');
      content.className = 'miller-item-content';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'miller-item-title';

      // Containers show the title alone; a leaf shows its number first.
      // Without a number the title stands alone.
      const number = item.child_count > 0 ? null : itemNumber(item);
      titleSpan.textContent = number ? `${number} - ${item.title}` : item.title;
      content.appendChild(titleSpan);

      // Main row with content and arrow
      const main = document.createElement('div');
      main.className = 'miller-item-main';
      main.appendChild(content);

      // Arrow indicator for items with children
      if (item.child_count > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'miller-item-arrow';
        arrow.textContent = '›';
        main.appendChild(arrow);
      }

      li.appendChild(main);

      // Metadata row (shown when selected)
      const metadata = this.createMetadataRow(item);
      li.appendChild(metadata);

      // Click handler
      li.addEventListener('click', (e) => this.handleItemClick(li, item, depth, e));

      list.appendChild(li);
    }

    column.appendChild(list);
    return column;
  }

  /**
   * Handle clicking on an item
   */
  async handleItemClick(element, item, depth, event) {
    // Check if click was on the metadata link
    if (event && event.target.closest('.miller-item-metadata a')) {
      return; // Let the link handle navigation
    }

    // Remove selection from siblings and collapse their metadata
    const column = element.closest('.miller-column');
    column.querySelectorAll('.miller-item').forEach(el => {
      el.classList.remove('selected', 'selected-ancestor');
      const meta = el.querySelector('.miller-item-metadata');
      if (meta) meta.classList.remove('expanded');
    });

    // Change previous column selections to ancestor style
    this.wrapper.querySelectorAll('.miller-item.selected').forEach(el => {
      el.classList.remove('selected');
      el.classList.add('selected-ancestor');
    });

    // Select this item and show its metadata
    element.classList.add('selected');
    const metadata = element.querySelector('.miller-item-metadata');
    if (metadata) {
      metadata.classList.add('expanded');
    }

    // Remove columns to the right
    this.removeColumnsAfter(depth);

    // If item has children, load them
    if (item.child_count > 0) {
      element.classList.add('loading');

      try {
        const children = await this.fetchChildren(item.id);
        this.refreshChildCount(element, item, children);
        const newColumn = this.createColumn(children, depth + 1, item.title);
        this.wrapper.appendChild(newColumn);
        this.columns.push(newColumn);

        // Scroll to show new column
        this.scrollToColumn(newColumn);
      } catch (error) {
        console.error('Error fetching children:', error);
      } finally {
        element.classList.remove('loading');
      }
    }
  }

  /**
   * Fetch children from static JSON
   */
  async fetchChildren(parentId) {
    // Check cache first
    if (this.cache.has(parentId)) {
      return this.cache.get(parentId);
    }

    const response = await fetch(`/data/children/${parentId}.json`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const children = data.results || data;

    // Cache the result
    this.cache.set(parentId, children);

    return children;
  }

  /**
   * Remove all columns after a given depth
   */
  removeColumnsAfter(depth) {
    while (this.columns.length > depth + 1) {
      const column = this.columns.pop();
      column.remove();
    }
    // Clear filter input in the now-last column and restore ancestor selections
    if (this.columns.length > 0) {
      const lastColumn = this.columns[this.columns.length - 1];
      const filter = lastColumn.querySelector('.column-filter');
      if (filter) {
        filter.value = '';
        this.filterColumn(lastColumn, '');
      }
      // Restore selected-ancestor to selected in the now-last column
      const ancestorItem = lastColumn.querySelector('.miller-item.selected-ancestor');
      if (ancestorItem) {
        ancestorItem.classList.remove('selected-ancestor');
        ancestorItem.classList.add('selected');
      }
    }
  }

  /**
   * Clear all columns
   */
  clearColumns() {
    this.columns = [];
    this.wrapper.innerHTML = '';
  }

  /**
   * Scroll to show a column
   */
  scrollToColumn(column) {
    setTimeout(() => {
      column.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
    }, 100);
  }

  /**
   * Filter items in a column by search text
   */
  filterColumn(column, searchText) {
    const items = column.querySelectorAll('.miller-item');
    const search = searchText.toLowerCase().trim();

    items.forEach(item => {
      if (!search) {
        item.style.display = '';
        return;
      }

      const title = item.querySelector('.miller-item-title')?.textContent?.toLowerCase() || '';
      const subtitle = item.querySelector('.miller-item-subtitle')?.textContent?.toLowerCase() || '';
      const refCode = item.dataset.refCode?.toLowerCase() || '';

      const matches = title.includes(search) || subtitle.includes(search) || refCode.includes(search);
      item.style.display = matches ? '' : 'none';
    });
  }

  /**
   * Create expandable metadata row for an item
   */
  createMetadataRow(item) {
    const metadata = document.createElement('div');
    metadata.className = 'miller-item-metadata';

    // Reference code
    const refCode = document.createElement('p');
    refCode.className = 'metadata-refcode';
    refCode.textContent = item.reference_code;
    metadata.appendChild(refCode);

    // Divider line
    const divider = document.createElement('hr');
    divider.className = 'metadata-divider';
    metadata.appendChild(divider);

    // Date range (if available)
    if (item.date_expression) {
      const date = document.createElement('p');
      date.className = 'metadata-date';
      date.textContent = item.date_expression;
      metadata.appendChild(date);
    }

    // Scope/content (truncated)
    if (item.scope_content) {
      const scope = document.createElement('p');
      scope.className = 'metadata-scope';
      // Truncate to ~150 chars
      const text = item.scope_content.length > 150
        ? item.scope_content.substring(0, 150) + '...'
        : item.scope_content;
      scope.textContent = text;
      metadata.appendChild(scope);
    }

    // Child count (for containers)
    if (item.child_count > 0) {
      const count = document.createElement('p');
      count.className = 'metadata-count';

      count.textContent = this.childCountLabel(item, this.cache.get(item.id));
      metadata.appendChild(count);
    }

    // Link to full record (flat URL structure)
    const link = document.createElement('a');
    link.href = `/${item.reference_code.replace(/[?#]/g, '')}/`;
    link.className = 'metadata-link';
    link.textContent = this.i18n.viewRecord || item.reference_code;
    metadata.appendChild(link);

    return metadata;
  }

  /**
   * The text in parentheses under a container's metadata, for example
   * "(12 files)". `loadedChildren` is whatever the tree holds for the item.
   */
  childCountLabel(item, loadedChildren) {
    const levelKey = childLevelKey(item, loadedChildren);
    return `(${childCountText(item.child_count, levelKey, this.strings)})`;
  }

  /**
   * Redraw the count once the item's children are loaded, because the most
   * common child level is only known from then on.
   */
  refreshChildCount(element, item, children) {
    const count = element.querySelector('.metadata-count');
    if (count) count.textContent = this.childCountLabel(item, children);
  }
}

// Initialize when DOM is ready (browsers only; Node loads this file for tests)
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  const treeContainer = document.getElementById('collection-tree');
  if (!treeContainer) return;

  const locale = document.documentElement.lang || 'en';

  // The tree-strings partial writes the strings into the page. The host's
  // data attributes are still read and take precedence, for a site template
  // that passes its own.
  const parseJson = (text, what) => {
    try {
      return JSON.parse(text || '{}') || {};
    } catch (e) {
      console.warn(`Could not parse ${what}`);
      return {};
    }
  };
  const pageStrings = parseJson(
    document.getElementById('tree-strings')?.textContent, 'tree strings');
  const levelLabels = parseJson(treeContainer.dataset.levelLabels, 'level labels');
  const hostI18n = parseJson(treeContainer.dataset.i18n, 'i18n strings');

  const tree = new MillerColumnsTree(treeContainer, {
    repoCode: treeContainer.dataset.repoCode || '',
    locale,
    i18n: { ...(pageStrings.i18n || {}), ...hostI18n },
    levelsPlural: { ...(pageStrings.levelsPlural || {}), ...levelLabels },
    levelsSingular: pageStrings.levelsSingular || {},
  });

  // Case 1: Repository page — root data embedded in page
  const rootDataEl = document.getElementById('root-descriptions-data');
  if (rootDataEl) {
    try {
      tree.loadRoot(JSON.parse(rootDataEl.textContent));
    } catch (e) {
      console.error('Could not parse root descriptions:', e);
    }
    return;
  }

  // Case 2: Description page — fetch children from static JSON
  const parentId = treeContainer.dataset.parentId;
  if (parentId) {
    tree.fetchChildren(parentId).then(children => {
      tree.loadRoot(children);
    }).catch(e => {
      console.error('Could not load children:', e);
    });
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    deprecatedNumberFromReferenceCode,
    itemNumber,
    childLevelKey,
    childCountText,
  };
}

// Version: v1.6.0
