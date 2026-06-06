/**
 * Miller Columns Tree Navigation
 *
 * Drives the lazy-loading hierarchical tree used on repository
 * landing pages to browse an archival fonds top-down. Each column
 * lists the children of the item selected in the previous column;
 * clicking an item reveals the next column to its right. Children
 * are fetched on demand from per-parent JSON shards emitted by the
 * build pipeline, and responses are cached so back-navigation in
 * the tree is instantaneous.
 *
 * Pipeline context:
 *   Loaded as a classic `<script>` tag from the repository landing
 *   template. Reads per-parent child listings from the repository's
 *   Hugo-rendered data shards; render targets are inside the
 *   template's `.miller-columns` host. Level labels (fonds, series,
 *   item, …) are injected via the host's data attributes so the UI
 *   copy stays in one place.
 *
 * @version v1.1.0
 */

class MillerColumnsTree {
  constructor(container, options = {}) {
    this.container = container;
    this.repoCode = options.repoCode || '';
    this.levelLabels = options.levelLabels || {};
    this.i18n = options.i18n || {};
    this.columns = [];
    this.cache = new Map(); // Cache fetched children

    // Locale-aware formatters (read from <html lang>; fallback es-CO)
    const locale = options.locale || document.documentElement.lang || 'es-CO';
    this._fmt = new Intl.NumberFormat(locale);
    this._pr  = new Intl.PluralRules(locale.split('-')[0]);

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
    const column = this.createColumn(rootDescriptions, 0, this.i18n.contentLabel || 'Contenido');
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
    filterInput.placeholder = this.i18n.filterPlaceholder || 'Filtrar...';
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

      // Container words - skip number prefix if title contains these
      const containerWords = /\b(legajo|caja|tomo|carpeta|vol\.|volumen|expediente|sección|seccion|subsección|subseccion|serie|subserie|fondo|subfondo|unidad|protocolo|capítulo|capitulo)\b/i;

      if (item.child_count > 0) {
        // Container: show just title in main row
        titleSpan.textContent = item.title;
        content.appendChild(titleSpan);
      } else if (containerWords.test(item.title)) {
        // Leaf item but title suggests it's a container (e.g., empty Legajo)
        titleSpan.textContent = item.title;
        content.appendChild(titleSpan);
      } else {
        // Leaf item: show "### - Title" format if we can extract a number
        const docNum = this.extractDocNumber(item.reference_code);
        if (docNum) {
          titleSpan.textContent = `${docNum} - ${item.title}`;
        } else {
          titleSpan.textContent = item.title;
        }
        content.appendChild(titleSpan);
      }

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

      // Container types that indicate children are "unidades compuestas"
      const containerTypes = ['caja', 'carpeta', 'tomo', 'legajo', 'volume', 'serie', 'subserie', 'section', 'fonds', 'subfonds', 'file'];

      const _prForm = this._pr.select(item.child_count);  // 'one' or 'other'
      let label;
      if (!item.children_level) {
        // Mixed or unknown → generic "unidades"
        const _u = this.i18n.childUnit || {};
        label = _u[_prForm] || (item.child_count === 1 ? 'unidad' : 'unidades');
      } else if (containerTypes.includes(item.children_level)) {
        // Children are containers
        const _uc = this.i18n.childUnitCompuesta || {};
        label = _uc[_prForm] || (item.child_count === 1 ? 'unidad compuesta' : 'unidades compuestas');
      } else {
        // Children are items/documents
        const _us = this.i18n.childUnitSimple || {};
        label = _us[_prForm] || (item.child_count === 1 ? 'unidad simple' : 'unidades simples');
      }

      count.textContent = `(${this._fmt.format(item.child_count)} ${label})`;
      metadata.appendChild(count);
    }

    // Link to full record (flat URL structure)
    const link = document.createElement('a');
    link.href = `/${item.reference_code.replace(/[?#]/g, '')}/`;
    link.className = 'metadata-link';
    link.textContent = this.i18n.viewRecord || 'Ver registro →';
    metadata.appendChild(link);

    return metadata;
  }

  /**
   * Extract document number from reference code for leaf items.
   * Scans backwards to find a document-number segment:
   *   1. "dNNN" or "nNNN" prefix (e.g., d005, n003) — strip the letter, return "005"/"003"
   *   2. Pure numeric (e.g., 001) — return as-is
   * e.g., "co-ahrb-aht-009-d005" -> "005"
   * e.g., "co-ahr-gob-caj001-car001-001" -> "001"
   */
  extractDocNumber(refCode) {
    if (!refCode) return null;

    const parts = refCode.split('-');

    // First pass: look for dNNN or nNNN segments (document identifiers)
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^[dn]\d+$/.test(parts[i])) {
        return parts[i].substring(1);
      }
    }

    // Second pass: last purely numeric segment
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        return parts[i];
      }
    }

    return null;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const treeContainer = document.getElementById('collection-tree');
  if (!treeContainer) return;

  const locale = document.documentElement.lang || 'es-CO';

  let levelLabels = {};
  try {
    levelLabels = JSON.parse(treeContainer.dataset.levelLabels || '{}');
  } catch (e) {
    console.warn('Could not parse level labels');
  }

  let i18n = {};
  try {
    i18n = JSON.parse(treeContainer.dataset.i18n || '{}');
  } catch (e) {
    console.warn('Could not parse i18n strings');
  }

  const tree = new MillerColumnsTree(treeContainer, {
    repoCode: treeContainer.dataset.repoCode || '',
    levelLabels,
    locale,
    i18n
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

// Version: v1.1.0
