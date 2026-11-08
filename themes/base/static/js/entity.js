/**
 * Entity Detail Page Controller (`/{entity_code}/`)
 *
 * Drives the entity detail page. Renders the intro sentence,
 * timeline view, and the per-entity "Red de conexiones" graph view
 * for a single focal entity. The graph view is a companion to
 * `infinite-bipartite-explorer.js` but centred on a fixed focal
 * entity rather than an explorer canvas the user can drag across.
 *
 * Pipeline context (build-time inputs):
 *   - `/data/entity-links/{entity_code}.json` — the focal shard
 *     listing every description that links to this entity.
 *   - `/data/doc-entities/{entity_code}.json` — a reference_code →
 *     [entity_codes] map for every document linked to the focal,
 *     consumed by `preCheckExpandable`, `checkExpandable`, and
 *     `expandDocument` for O(1) synchronous doc→entity lookups.
 *     Replaces the per-doc Pagefind round-trips used pre-v1.0.0:
 *     those stretched to 20–45 s on prod for large-focal entities
 *     because each check cost one Cloudflare/R2 RTT and ran
 *     serially.
 *   - `/data/entity-index.json` — one record per entity carrying
 *     display_name, entity_type, and linked_description_count.
 *     `expandDocument` reads an expanded entity's label, type, and
 *     linked count from this structured index (fetched once, memoized),
 *     keyed by entity_code.
 *
 * i18n / single-source: the role-label table, role-group
 * accordion headers, and entity-type labels are NOT hardcoded here —
 * they are read from data-role-labels / data-role-group-labels /
 * data-entity-type-labels on #entity-intro (sourced from ui.yaml), and
 * every user-facing string is read from the #entity-intro data-i18n
 * blob with no Spanish fallback, so display copy lives only in the
 * locale bundles and never in this file. The entity-type for the focal
 * graph node resolves from the stable data-entity-type-raw CODE rather
 * than mapping localized badge text, which keeps it locale-invariant.
 * Numbers, plurals and dates follow the page's <html lang> through
 * Intl: "March 15, 1723" under en-US, "15 de marzo de 1723" under
 * es-CO. Role-group membership and order are read from
 * data-role-groups, with the module's roleGroups array as the fallback
 * when the attribute is absent.
 *
 * @version v1.6.0
 */

// Render-time vocabulary read from data attributes on #entity-intro
// (data-role-labels, data-role-group-labels, data-entity-type-labels)
// and the app-label strings from its data-i18n blob. Populated once on
// DOMContentLoaded by _initEntityVocab() so the module-level timeline
// helpers (renderTimeline / renderTimelineEntry / formatDate) and the
// in-closure graph functions all read from a single source. Spanish is
// never hardcoded in this file — display copy lives only in the locale bundles.
var _entityRoleLabels = Object.create(null);       // role code → display label
var _entityRoleGroupLabels = Object.create(null);  // group id → display label
var _entityTypeLabels = Object.create(null);       // entity_type code → display label
var _entityI18n = {};             // app-label blob

// Role groups, in display order, with the role codes each holds (display
// labels come from _entityRoleGroupLabels, keyed by these group IDs).
// _initEntityVocab replaces this list with data-role-groups, which the
// template builds from data/vocab/role-groups.yaml and the export's
// vocabulary.json. The array below is used only when the attribute is
// absent, as under a template override that leaves it out, and must stay
// equal to data/vocab/role-groups.yaml (tests/role-groups-parity.test.js).
var roleGroups = [
  { id: 'production', members: ['creator', 'author', 'editor', 'publisher', 'mentioned', 'subject', 'official'] },
  { id: 'correspondence', members: ['sender', 'recipient'] },
  { id: 'notarial', members: ['scribe', 'witness', 'notary'] },
  { id: 'legal', members: ['plaintiff', 'defendant', 'petitioner', 'judge', 'appellant', 'fiador', 'apoderado', 'victim'] },
  { id: 'family', members: ['heir', 'albacea', 'spouse'] },
  { id: 'transactions', members: ['grantor', 'donor', 'seller', 'buyer', 'mortgagor', 'mortgagee', 'creditor', 'debtor'] },
  { id: 'visual', members: ['photographer', 'artist'] }
];

// Colours come from the theme tokens through theme-colors.js, which the
// layout shell loads first; the grey stands in if a layout omits it.
var themeColor = window.zasquaThemeColor || function () { return '#888'; };
var themeFont = window.zasquaThemeFont || function () { return 'sans-serif'; };

// Entity colours by type (shared with graph)
var entityColors = {
  person: themeColor('graph-person'),
  corporate_body: themeColor('graph-corporate'),
  corporate: themeColor('graph-corporate'),
  family: themeColor('graph-corporate')
};
var graphColors = {
  document: themeColor('graph-document'),
  documentHover: themeColor('graph-document-hover'),
  documentDimmed: themeColor('graph-document-dimmed'),
  entityDimmed: themeColor('graph-entity-dimmed'),
  nodeFill: themeColor('graph-node-fill'),
  link: themeColor('graph-link')
};

// All grouped role values (for detecting roles in no group, which are
// listed under 'otros'). Rebuilt whenever roleGroups is replaced.
var groupedRoles = new Set();
function _indexGroupedRoles() {
  groupedRoles = new Set();
  for (var _gi = 0; _gi < roleGroups.length; _gi++) {
    for (var _mi = 0; _mi < roleGroups[_gi].members.length; _mi++) {
      groupedRoles.add(roleGroups[_gi].members[_mi]);
    }
  }
}
_indexGroupedRoles();

// label-map:start
// A code → label map read from a data-*-labels attribute. The map has no
// prototype, so a code such as "constructor" or "toString" finds no
// inherited value and `labels[code] || code` falls back to the code. Only
// string values are kept; a missing or malformed attribute gives an empty
// map.
function parseLabelMap(raw) {
  var map = Object.create(null);
  if (!raw) return map;
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return map; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
  Object.keys(parsed).forEach(function (key) {
    if (typeof parsed[key] === 'string') map[key] = parsed[key];
  });
  return map;
}
// label-map:end

// role-counts:start
// Role codes are compared in lowercase everywhere: in the counts, the
// filters and the label lookups, as in the vocab partial, which lowercases
// the export's role codes and group ids. roleCode gives that form ('' for
// a link without a role).
function roleCode(role) {
  return role ? String(role).toLowerCase() : '';
}

// The number of links for each role code, lowercased; links without a
// role are skipped. The map has no prototype, so a role code such as
// "constructor" is counted like any other.
function countRoles(links) {
  var counts = Object.create(null);
  for (var i = 0; i < links.length; i++) {
    var r = roleCode(links[i].role);
    if (!r) continue;
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}
// role-counts:end

// Read the render-time vocabulary + app-label blob off #entity-intro.
// Called once on DOMContentLoaded before any render runs.
function _initEntityVocab() {
  var introEl = document.getElementById('entity-intro');
  if (!introEl) return;
  _entityRoleLabels = parseLabelMap(introEl.dataset.roleLabels);
  _entityRoleGroupLabels = parseLabelMap(introEl.dataset.roleGroupLabels);
  _entityTypeLabels = parseLabelMap(introEl.dataset.entityTypeLabels);
  try { _entityI18n = JSON.parse(introEl.dataset.i18n || '{}'); } catch (e) {}
  if (introEl.dataset.roleGroups) {
    try {
      var groups = JSON.parse(introEl.dataset.roleGroups);
      if (Array.isArray(groups)) {
        roleGroups = groups.filter(function (g) {
          return g && typeof g.id === 'string' && Array.isArray(g.members);
        });
        _indexGroupedRoles();
      }
    } catch (e) {}
  }
}

// CLDR plural selection helper — chooses the one/other form from a
// {one, other} sub-table and substitutes the {count} token with the
// locale-formatted number. Returns '' if the dict is missing (blob-only,
// no Spanish fallback).
var _entityPr = null;
function _entityPlural(dict, n) {
  if (!dict || typeof dict !== 'object') return '';
  if (!_entityPr) {
    _entityPr = new Intl.PluralRules(_pageLocale());
  }
  var form = dict[_entityPr.select(n)] || dict.other || '';
  return form.replace('{count}', _getEntityFmt().format(n));
}

// Number formatter in the page's language — initialised on first use so
// document.documentElement is available. Shared by all functions in this
// file via closure.
var _entityFmt = null;

function _getEntityFmt() {
  if (!_entityFmt) {
    _entityFmt = new Intl.NumberFormat(_pageLocale());
  }
  return _entityFmt;
}

document.addEventListener('DOMContentLoaded', async function() {
  var timelineEl = document.getElementById('entity-timeline');
  if (!timelineEl) return;

  var entityCode = timelineEl.dataset.entityCode;
  if (!entityCode) return;

  // Initialise locale-aware formatters now that DOM is ready
  _getEntityFmt();

  // Read the render-time vocabulary + app-label blob off #entity-intro
  // before any render runs — single source, no hardcoded Spanish.
  _initEntityVocab();

  // Doc-entities sidecar map: reference_code → [entity_codes]. Populated
  // by the parallel fetch below and consulted by `preCheckExpandable`,
  // `checkExpandable`, and `expandDocument` for O(1) expandability
  // resolution. Declared at the top of the scope so the graph-view
  // closures can see it.
  var docEntitiesMap = {};

  var links;
  // Fetch the entity-links shard + doc-entities sidecar in parallel.
  // The sidecar is optional (graph still renders without it; every doc
  // node just falls back to hollow), so a fetch failure on the sidecar
  // is non-fatal. The entity-links shard is mandatory.
  var linksPromise = fetch('/data/entity-links/' + entityCode + '.json')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  var docEntitiesPromise = fetch('/data/doc-entities/' + entityCode + '.json')
    .then(function (res) { return res.ok ? res.json() : {}; })
    .catch(function () { return {}; });
  try {
    var fetched = await Promise.all([linksPromise, docEntitiesPromise]);
    links = fetched[0];
    docEntitiesMap = fetched[1] || {};
  } catch (err) {
    console.error('[entity] Failed to load shard:', err);
    timelineEl.innerHTML = '<p class="text-stone-500 text-sm">' + escapeHtml(_entityI18n.shardError || '') + '</p>';
    return;
  }

  // State
  var activeRoles = new Set();
  var currentView = 'timeline';
  var graphInstance = null;

  // Initial render
  renderTimeline(timelineEl, links, activeRoles);
  buildIntro(links);
  buildRoleFilters(links);
  wireToggleButtons();

  // Auto-switch to graph if ?vista=red
  if (new URLSearchParams(window.location.search).get('vista') === 'red') {
    setTimeout(function() { switchView('graph'); }, 0);
  }

  // --- Intro sentence with view links ---

  function buildIntro(allLinks) {
    var introEl = document.getElementById('entity-intro');
    if (!introEl) return;

    var entityType = (introEl.dataset.entityType || '').toLowerCase();
    var code = introEl.dataset.entityCode;
    var count = allLinks.length;

    // Build intro sentence: focalIntro is a {one, other} pair carrying
    // {type} and {count}; the plural helper picks the form and fills the count
    var text = _entityPlural(_entityI18n.focalIntro, count)
      .replace('{type}', escapeHtml(entityType));

    introEl.innerHTML = text;

    // "una línea de tiempo" link
    var tlLink = document.createElement('button');
    tlLink.type = 'button';
    tlLink.className = 'entity-view-link active';
    tlLink.textContent = _entityI18n.viewTimeline || '';
    tlLink.dataset.view = 'timeline';
    tlLink.addEventListener('click', function() { switchView('timeline'); });
    introEl.appendChild(tlLink);

    introEl.appendChild(document.createTextNode(', '));

    // "una red" link
    var graphLink = document.createElement('button');
    graphLink.type = 'button';
    graphLink.className = 'entity-view-link';
    graphLink.textContent = _entityI18n.viewGraph || '';
    graphLink.dataset.view = 'graph';
    graphLink.addEventListener('click', function() { switchView('graph'); });
    introEl.appendChild(graphLink);

    introEl.appendChild(document.createTextNode(_entityI18n.sep || ''));

    // "un filtro en el sistema de búsquedas" link
    var searchLink = document.createElement('a');
    searchLink.className = 'entity-view-link';
    searchLink.href = '/buscar/?entidad=' + encodeURIComponent(code);
    searchLink.textContent = _entityI18n.viewSearch || '';
    introEl.appendChild(searchLink);

    introEl.appendChild(document.createTextNode(_entityI18n.tail || ''));
  }

  // --- Segmented control ---

  function wireToggleButtons() {
    var toggleEl = document.getElementById('entity-view-toggle');
    if (!toggleEl) return;
    var btns = toggleEl.querySelectorAll('.entity-toggle-btn');
    btns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchView(btn.dataset.view);
      });
    });
  }

  function switchView(view) {
    if (view === currentView) return;
    currentView = view;

    // Update prose link styles
    var viewLinks = document.querySelectorAll('.entity-view-link[data-view]');
    viewLinks.forEach(function(link) {
      link.classList.toggle('active', link.dataset.view === view);
    });

    // Update segmented control styles
    var toggleBtns = document.querySelectorAll('.entity-toggle-btn[data-view]');
    toggleBtns.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    var timelineFrame = document.getElementById('entity-timeline-frame');
    var graphFrame = document.getElementById('entity-graph-frame');

    if (view === 'timeline') {
      timelineFrame.style.display = '';
      graphFrame.style.display = 'none';
      renderTimeline(timelineEl, links, activeRoles);
    } else {
      timelineFrame.style.display = 'none';
      graphFrame.style.display = '';
      renderGraph(links, activeRoles);
    }
  }

  // --- Role filters (collapsible role-group accordion) ---

  function buildRoleFilters(allLinks) {
    var filtersEl = document.getElementById('entity-role-filters');
    if (!filtersEl) return;

    // Count roles from all links
    var roleCounts = countRoles(allLinks);

    // Build visible groups (only those with at least one role present in data)
    var visibleGroups = [];
    for (var gi = 0; gi < roleGroups.length; gi++) {
      var group = roleGroups[gi];
      var members = [];
      for (var mi = 0; mi < group.members.length; mi++) {
        var role = group.members[mi];
        if (roleCounts[role] > 0) {
          members.push({ role: role, count: roleCounts[role] });
        }
      }
      if (members.length === 0) continue;
      members.sort(function(a, b) { return b.count - a.count; });
      var total = 0;
      for (var ti = 0; ti < members.length; ti++) total += members[ti].count;
      visibleGroups.push({ id: group.id, label: _entityRoleGroupLabels[group.id] || group.id, members: members, total: total });
    }

    // Collect ungrouped roles (present in data but not in any group)
    var otrosMembers = [];
    var allRoles = Object.keys(roleCounts);
    for (var oi = 0; oi < allRoles.length; oi++) {
      var or_ = allRoles[oi];
      if (!groupedRoles.has(or_) && roleCounts[or_] > 0) {
        otrosMembers.push({ role: or_, count: roleCounts[or_] });
      }
    }
    if (otrosMembers.length > 0) {
      otrosMembers.sort(function(a, b) { return b.count - a.count; });
      var otrosTotal = 0;
      for (var oti = 0; oti < otrosMembers.length; oti++) otrosTotal += otrosMembers[oti].count;
      var otrosId = 'otros';
      visibleGroups.push({ id: otrosId, label: _entityRoleGroupLabels[otrosId] || otrosId, members: otrosMembers, total: otrosTotal });
    }

    if (visibleGroups.length === 0) { filtersEl.innerHTML = ''; return; }

    var wrap = document.createElement('div');
    wrap.className = 'focal-role-facet';

    // Header with title and clear button
    var header = document.createElement('div');
    header.className = 'focal-role-facet-header';

    var title = document.createElement('span');
    title.className = 'focal-role-facet-title';
    title.textContent = _entityI18n.filterByRole || '';
    header.appendChild(title);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'focal-role-facet-clear';
    // Short-form "Clear" — ui.clearShort (shared sort/clear vocab,
    // distinct from the long "Limpiar filtros" → search.clearFilters).
    // Read blob-only off #entity-intro, no Spanish fallback.
    clearBtn.textContent = _entityI18n.clearShort;
    clearBtn.style.display = activeRoles.size > 0 ? '' : 'none';
    clearBtn.addEventListener('click', function() {
      activeRoles = new Set();
      applyFilters();
      buildRoleFilters(allLinks);
    });
    header.appendChild(clearBtn);
    wrap.appendChild(header);

    // Build each group
    for (var vgi = 0; vgi < visibleGroups.length; vgi++) {
      (function(grp) {
        var groupEl = document.createElement('div');
        groupEl.className = 'focal-role-group';

        var groupHeader = document.createElement('div');
        groupHeader.className = 'focal-role-group-header';

        // Group-level checkbox: tri-state (all/some/none)
        var allChecked = grp.members.every(function(m) { return activeRoles.has(m.role); });
        var someChecked = grp.members.some(function(m) { return activeRoles.has(m.role); });

        var groupCheckbox = document.createElement('input');
        groupCheckbox.type = 'checkbox';
        groupCheckbox.className = 'focal-role-group-checkbox';
        groupCheckbox.checked = allChecked;
        groupCheckbox.indeterminate = someChecked && !allChecked;
        groupCheckbox.addEventListener('click', function(e) { e.stopPropagation(); });
        groupCheckbox.addEventListener('change', function() {
          if (groupCheckbox.checked) {
            for (var ci = 0; ci < grp.members.length; ci++) activeRoles.add(grp.members[ci].role);
          } else {
            for (var ci = 0; ci < grp.members.length; ci++) activeRoles.delete(grp.members[ci].role);
          }
          applyFilters();
          buildRoleFilters(allLinks);
        });
        groupHeader.appendChild(groupCheckbox);

        var groupLabel = document.createElement('span');
        groupLabel.className = 'focal-role-group-label';
        groupLabel.textContent = grp.label;
        groupHeader.appendChild(groupLabel);

        var groupCount = document.createElement('span');
        groupCount.className = 'focal-role-group-count';
        groupCount.textContent = '(' + _getEntityFmt().format(grp.total) + ')';
        groupHeader.appendChild(groupCount);

        var chevron = document.createElement('span');
        chevron.className = 'focal-role-group-chevron';
        // Expand group if any of its members are active
        var expanded = someChecked;
        chevron.textContent = expanded ? '\u2212' : '+';
        groupHeader.appendChild(chevron);

        // Toggle expand/collapse on header click
        groupHeader.addEventListener('click', function() {
          var isExpanded = groupEl.classList.toggle('is-expanded');
          chevron.textContent = isExpanded ? '\u2212' : '+';
        });

        // All groups collapsed on load, unless a member is active
        if (expanded) groupEl.classList.add('is-expanded');

        groupEl.appendChild(groupHeader);

        // Member checkboxes
        var memberList = document.createElement('div');
        memberList.className = 'focal-role-group-members';
        for (var mbi = 0; mbi < grp.members.length; mbi++) {
          (function(m) {
            var optLabel = document.createElement('label');
            optLabel.className = 'focal-role-option';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = m.role;
            cb.checked = activeRoles.has(m.role);
            cb.addEventListener('change', function() {
              if (cb.checked) {
                activeRoles.add(m.role);
              } else {
                activeRoles.delete(m.role);
              }
              applyFilters();
              buildRoleFilters(allLinks);
            });
            optLabel.appendChild(cb);

            var text = document.createElement('span');
            text.className = 'focal-role-option-label';
            text.textContent = _entityRoleLabels[m.role] || m.role;
            optLabel.appendChild(text);

            var cnt = document.createElement('span');
            cnt.className = 'focal-role-option-count';
            cnt.textContent = '(' + _getEntityFmt().format(m.count) + ')';
            optLabel.appendChild(cnt);

            memberList.appendChild(optLabel);
          })(grp.members[mbi]);
        }
        groupEl.appendChild(memberList);

        wrap.appendChild(groupEl);
      })(visibleGroups[vgi]);
    }

    filtersEl.innerHTML = '';
    filtersEl.appendChild(wrap);
  }

  function applyFilters() {
    if (currentView === 'timeline') {
      renderTimeline(timelineEl, links, activeRoles);
    } else {
      renderGraph(links, activeRoles);
    }
  }

  // --- Graph view ---

  // Graph state persists across re-renders
  var graphNodes = new Map();  // id → node object
  var graphEdges = [];         // { source, target, role }
  var nodeNeighbours = new Map();  // id → Set of neighbour ids
  var nodeLinks = new Map();       // id → Set of link objects
  var shardCache = new Map();  // entity_code → links array
  var activeTooltip = null;    // current tooltip element
  var tooltipNode = null;      // node the tooltip is attached to

  // Entity index, fetched once and memoized. /data/entity-index.json
  // carries display_name, entity_type, and linked_description_count per
  // entity (emitted by scripts/precompute-links.js) — the fields an
  // expanded-entity node needs, keyed by entity_code. One index fetch
  // serves every expansion.
  var entityIndexPromise = null;
  var entityIndexMap = null;
  function loadEntityIndex() {
    if (entityIndexPromise) return entityIndexPromise;
    entityIndexPromise = fetch('/data/entity-index.json')
      .then(function (res) {
        if (!res.ok) throw new Error('entity-index.json HTTP ' + res.status);
        return res.json();
      })
      .then(function (records) {
        var map = new Map();
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r && r.entity_code) map.set(r.entity_code, r);
        }
        entityIndexMap = map;
        return map;
      })
      .catch(function () {
        // Do not memoize a failed load: clear the promise so a later expansion
        // refetches. A transient fetch failure must not permanently blank
        // expanded-entity metadata for the page session; entityIndexMap stays
        // null so callers keep retrying through loadEntityIndex().
        entityIndexPromise = null;
        return new Map();
      });
    return entityIndexPromise;
  }

  function renderGraph(allLinks, activeFilters) {
    var canvas = document.getElementById('entity-graph-canvas');
    if (!canvas) return;

    var filtered = filterLinks(allLinks, activeFilters);

    if (filtered.length === 0) {
      canvas.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#78716c;font-size:0.875rem">' + escapeHtml(_entityI18n.graphEmpty || '') + '</div>';
      if (graphInstance) { graphInstance._destructor && graphInstance._destructor(); graphInstance = null; }
      return;
    }

    // Reset graph data
    graphNodes.clear();
    graphEdges = [];

    // Central entity node. Read the entity-type CODE from the stable
    // data-entity-type-raw attribute (person / corporate_body / family)
    // rather than mapping the localized badge text, which keeps it
    // locale-invariant. Colours/type labels key off the code.
    var introEl = document.getElementById('entity-intro');
    var mappedType = (introEl && introEl.dataset.entityTypeRaw) || 'person';
    var entityNameEl = document.querySelector('.detail-title');

    graphNodes.set(entityCode, {
      id: entityCode,
      type: 'entity',
      label: entityNameEl ? entityNameEl.textContent.trim() : entityCode,
      entityType: mappedType,
      color: entityColors[mappedType] || entityColors.person
    });

    // Document nodes from this entity's links
    for (var i = 0; i < filtered.length; i++) {
      var link = filtered[i];
      if (!graphNodes.has(link.reference_code)) {
        graphNodes.set(link.reference_code, {
          id: link.reference_code,
          type: 'document',
          label: link.title,
          date: link.date_expression || '',
          role: link.role || '',
          expandable: null,  // null = unchecked, true/false after lookup
          color: graphColors.document
        });
      }
      graphEdges.push({ source: entityCode, target: link.reference_code, role: link.role });
    }

    rebuildForceGraph(canvas);
  }

  function rebuildAdjacency() {
    nodeNeighbours.clear();
    nodeLinks.clear();
    for (var i = 0; i < graphEdges.length; i++) {
      var edge = graphEdges[i];
      for (var nid of [edge.source, edge.target]) {
        if (!nodeNeighbours.has(nid)) nodeNeighbours.set(nid, new Set());
        if (!nodeLinks.has(nid)) nodeLinks.set(nid, new Set());
      }
      nodeNeighbours.get(edge.source).add(edge.target);
      nodeNeighbours.get(edge.target).add(edge.source);
      nodeLinks.get(edge.source).add(edge);
      nodeLinks.get(edge.target).add(edge);
    }
  }

  function rebuildForceGraph(canvas) {
    canvas.innerHTML = '';

    var nodes = Array.from(graphNodes.values());
    var edges = graphEdges.map(function(e) { return Object.assign({}, e); });

    rebuildAdjacency();

    var highlightedNodes = new Set();
    var highlightedLinks = new Set();

    if (graphInstance) { graphInstance._destructor && graphInstance._destructor(); }

    var width = canvas.clientWidth || 600;
    var height = canvas.clientHeight || 480;

    // Canvas labels use the font the page computes for the graph's
    // container, since a canvas does not inherit CSS fonts.
    var labelFont = themeFont(canvas);

    graphInstance = new ForceGraph(canvas)
      .width(width)
      .height(height)
      .graphData({ nodes: nodes, links: edges })
      .nodeId('id')
      .nodeLabel(function(node) {
        if (node.type === 'entity') {
          return '<strong>' + escapeHtml(node.label) + '</strong>';
        }
        var label = '<strong>' + escapeHtml(node.label) + '</strong>';
        if (node.date) label = formatDate(node.date) + '<br>' + label;
        return label;
      })
      .nodeVal(function(node) { return node.type === 'entity' ? 2 : 0.3; })
      .nodeRelSize(2.5)
      .nodeCanvasObjectMode(function() { return 'replace'; })
      .nodeCanvasObject(function(node, ctx, globalScale) {
        var r = Math.sqrt(node.type === 'entity' ? 2 : 0.3) * 2.5;

        if (node.type === 'document') {
          // Filled = has connections to other entities (pre-checked or already expanded)
          var neighbours = nodeNeighbours.get(node.id);
          var entityNeighbourCount = 0;
          if (neighbours) neighbours.forEach(function(nid) {
            var n = graphNodes.get(nid);
            if (n && n.type === 'entity') entityNeighbourCount++;
          });
          var filled = entityNeighbourCount > 1 || node.expandable === true;

          var dimmed = highlightedNodes.size > 0 && !highlightedNodes.has(node.id);
          var hovered = highlightedNodes.has(node.id);

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          if (filled) {
            ctx.fillStyle = dimmed ? graphColors.documentDimmed : hovered ? graphColors.documentHover : node.color;
            ctx.fill();
          } else {
            ctx.fillStyle = graphColors.nodeFill;
            ctx.fill();
            ctx.strokeStyle = dimmed ? graphColors.documentDimmed : hovered ? graphColors.documentHover : node.color;
            ctx.lineWidth = 1.2 / globalScale;
            ctx.stroke();
          }
        } else {
          // Entity node: filled circle + label
          var dimmedE = highlightedNodes.size > 0 && !highlightedNodes.has(node.id);
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          ctx.fillStyle = dimmedE ? graphColors.entityDimmed : node.color;
          ctx.fill();

          var show = globalScale > 1.2 || highlightedNodes.has(node.id);
          if (show) {
            var fontSize = 10 / globalScale;
            ctx.font = 'bold ' + fontSize + 'px ' + labelFont;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = highlightedNodes.has(node.id) ? '#333' : '#777';
            ctx.fillText(node.label, node.x, node.y + r + 1);
          }
        }
      })
      .linkColor(function(link) {
        if (highlightedLinks.has(link)) return '#888';
        if (highlightedNodes.size > 0) return 'rgba(0,0,0,0.03)';
        return graphColors.link;
      })
      .linkWidth(function(link) { return highlightedLinks.has(link) ? 2 : 0.8; })
      .enableNodeDrag(true)
      .enableZoomInteraction(true)
      .cooldownTime(5000)
      .d3AlphaDecay(0.02)
      .d3VelocityDecay(0.3)
      .onNodeHover(function(node) {
        canvas.style.cursor = node ? 'pointer' : '';
        highlightedNodes.clear();
        highlightedLinks.clear();
        if (node) {
          highlightedNodes.add(node.id);
          var neighbours = nodeNeighbours.get(node.id);
          if (neighbours) neighbours.forEach(function(n) { highlightedNodes.add(n); });
          var nLinks = nodeLinks.get(node.id);
          if (nLinks) nLinks.forEach(function(l) { highlightedLinks.add(l); });
        }
      })
      .onNodeClick(function(node) {
        if (!node) return;
        dismissTooltip();
        if (node.type === 'entity') {
          graphInstance.centerAt(node.x, node.y, 400);
          showEntityTooltip(node, canvas);
        } else if (node.type === 'document') {
          graphInstance.centerAt(node.x, node.y, 400);
          showDocTooltip(node, canvas);
        }
      })
      .onBackgroundClick(function() { dismissTooltip(); })
      .onNodeDragEnd(function(node) { node.fx = node.x; node.fy = node.y; })
      .onZoom(function() { updateTooltipPosition(); });

    graphInstance.d3Force('charge').strength(-20);
    graphInstance.d3Force('link').distance(20).strength(0.5);

    // Zoom to fit early so the graph doesn't start as a distant speck
    setTimeout(function() {
      if (graphInstance) graphInstance.zoomToFit(0, 30);
    }, 300);

    // Resize
    new ResizeObserver(function() {
      if (graphInstance && canvas.clientWidth > 0) {
        graphInstance.width(canvas.clientWidth).height(canvas.clientHeight);
      }
    }).observe(canvas);

    // Pre-check which documents have expandable connections
    preCheckExpandable();
  }

  function preCheckExpandable() {
    // Synchronous resolution from the pre-loaded doc-entities sidecar.
    // For each doc node whose expandability hasn't been resolved, look
    // up its linked entity codes and mark `expandable = true` iff at
    // least one of those entities isn't already in the graph. Replaces
    // the prior serialised Pagefind round-trip loop whose wall time
    // scaled linearly with CDN latency × doc count.
    graphNodes.forEach(function(node) {
      if (node.type !== 'document' || node.expandable !== null) return;
      var codes = docEntitiesMap[node.id];
      if (!codes || codes.length === 0) {
        node.expandable = false;
        return;
      }
      node.expandable = false;
      for (var j = 0; j < codes.length; j++) {
        if (!graphNodes.has(codes[j])) { node.expandable = true; break; }
      }
    });
  }

  // --- Entity tooltip ---

  function showEntityTooltip(node, canvas) {
    dismissTooltip();

    var tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';

    // Count shared documents in the graph
    var neighbours = nodeNeighbours.get(node.id);
    var sharedDocs = 0;
    if (neighbours) neighbours.forEach(function(nid) {
      var n = graphNodes.get(nid);
      if (n && n.type === 'document') sharedDocs++;
    });

    // Central entity name
    var centralNode = graphNodes.get(entityCode);
    var centralName = centralNode ? centralNode.label : entityCode;

    var html = '';
    html += '<div class="graph-tooltip-role">' + escapeHtml(_entityTypeLabels[node.entityType] || node.entityType) + '</div>';
    html += '<div class="graph-tooltip-name"><a href="/' + escapeHtml(node.id) + '/">' + escapeHtml(node.label) + '</a></div>';
    html += '<div class="graph-tooltip-ref">' + escapeHtml(node.id) + '</div>';
    if (sharedDocs > 0 && node.id !== entityCode) {
      // entity.sharedDocsSentence {one,other} — tokens {name} {count}.
      var _shared = _entityPlural(_entityI18n.sharedDocsSentence, sharedDocs)
        .replace('{name}', escapeHtml(centralName));
      html += '<div class="graph-tooltip-actions">';
      html += _shared;
      html += '</div>';
    }
    var totalLinked = node.linkedCount || 0;
    var otherDocs = totalLinked - sharedDocs;
    if (otherDocs > 0 && node.id !== entityCode) {
      // entity.connectedOtherDocs {one,other} — {type} resolved from the
      // type-labels attr by CODE (lowercased to match the mid-sentence
      // Spanish wording "Esta {type} …"), {count} from PluralRules.
      var _typeWord = (_entityTypeLabels[node.entityType] || node.entityType || '').toLowerCase();
      var _other = _entityPlural(_entityI18n.connectedOtherDocs, otherDocs)
        .replace('{type}', escapeHtml(_typeWord));
      html += '<div class="graph-tooltip-actions">';
      html += _other;
      html += '<a href="/' + escapeHtml(node.id) + '/?vista=red" class="graph-tooltip-btn">' + escapeHtml(_entityI18n.openInExplorer || '') + '</a>';
      html += '</div>';
    }

    tooltip.innerHTML = html;
    positionTooltip(tooltip, node);

    canvas.appendChild(tooltip);
    activeTooltip = tooltip;
    tooltipNode = node;
  }

  // --- Document tooltip ---

  function showDocTooltip(node, canvas) {
    dismissTooltip();

    var tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';

    var html = '';
    if (node.date) {
      html += '<div class="graph-tooltip-date">' + formatDate(node.date) + '</div>';
    }
    if (node.role) {
      html += '<div class="graph-tooltip-role">' + escapeHtml(_entityRoleLabels[roleCode(node.role)] || node.role) + '</div>';
    }
    html += '<div class="graph-tooltip-name"><a href="/' + escapeHtml(node.id) + '/">' + escapeHtml(node.label) + '</a></div>';
    html += '<div class="graph-tooltip-ref">' + escapeHtml(node.id) + '</div>';

    tooltip.innerHTML = html;
    positionTooltip(tooltip, node);

    canvas.appendChild(tooltip);
    activeTooltip = tooltip;
    tooltipNode = node;

    // Check how many connections can be expanded
    checkExpandable(node.id).then(function(count) {
      if (!count || activeTooltip !== tooltip) return;
      var actions = document.createElement('div');
      actions.className = 'graph-tooltip-actions';
      // graph.connectedToSite {one,other} — {count} via PluralRules.
      var text = _entityPlural(_entityI18n.connectedToSite, count) + ' ';
      var span = document.createElement('span');
      span.textContent = text;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'graph-tooltip-btn';
      btn.textContent = _entityI18n.expand || '';
      btn.addEventListener('click', async function() {
        btn.textContent = _entityI18n.loading || '';
        btn.disabled = true;
        node.fx = node.x;
        node.fy = node.y;
        await expandDocument(node.id, canvas);
        graphInstance.centerAt(node.x, node.y, 400);
        dismissTooltip();
      });
      actions.appendChild(span);
      actions.appendChild(btn);
      tooltip.appendChild(actions);
    });
  }

  // Returns the count of new entity connections (0 = nothing to expand).
  // Kept as an async function so the `.then(count => …)` call site in
  // `showDocumentTooltip` doesn't need rewriting; the JS runtime wraps
  // the synchronous return in a resolved Promise.
  async function checkExpandable(refCode) {
    var codes = docEntitiesMap[refCode];
    if (!codes || codes.length === 0) return 0;
    var count = 0;
    for (var i = 0; i < codes.length; i++) {
      if (!graphNodes.has(codes[i])) count++;
    }
    return count;
  }

  function positionTooltip(tooltip, node) {
    var coords = graphInstance.graph2ScreenCoords(node.x, node.y);
    tooltip.style.left = coords.x + 'px';
    tooltip.style.top = (coords.y - 8) + 'px';
    tooltip.style.transform = 'translate(-50%, -100%)';
  }

  function updateTooltipPosition() {
    if (activeTooltip && tooltipNode && graphInstance) {
      positionTooltip(activeTooltip, tooltipNode);
    }
  }

  function dismissTooltip() {
    if (activeTooltip) {
      activeTooltip.remove();
      activeTooltip = null;
      tooltipNode = null;
    }
  }

  // --- Expand document: load connected entities ---

  async function expandDocument(refCode, canvas) {
    // Look up the document's linked entities from the pre-loaded
    // doc-entities sidecar (O(1)). Replaces the prior per-click
    // Pagefind descriptions round-trip.
    var entityCodes = docEntitiesMap[refCode] || [];
    if (entityCodes.length === 0) return;

    var newEntities = entityCodes.filter(function(c) { return !graphNodes.has(c); });
    if (newEntities.length === 0) return;

    // Resolve name + type + linked count for each new entity from the
    // entity index (display_name / entity_type / linked_description_count),
    // keyed by entity_code. A code absent from the index is SKIPPED — node
    // and edge both omitted: the entity-links/doc-entities shards are built
    // from entity_links.json while the index and the /{entity_code}/ pages
    // are built from entities.json, and nothing cross-checks that every
    // linked code has an authority record. A node without one is a dead end
    // (its page 404s), so omission is the correct failure mode here. This
    // deliberately diverges from infinite-bipartite-explorer.js, which
    // renders index-missing entities with a default label: expanded
    // entities here are user-triggered detail; graph nodes there are bulk
    // display.
    var index = entityIndexMap || await loadEntityIndex();
    for (var i = 0; i < newEntities.length; i++) {
      var code = newEntities[i];
      var rec = index.get(code);
      if (!rec) continue;
      var label = rec.display_name || code;
      var eType = rec.entity_type || 'person';
      var linkedCount = rec.linked_description_count != null
        ? rec.linked_description_count : 0;
      graphNodes.set(code, {
        id: code,
        type: 'entity',
        label: label,
        entityType: eType,
        linkedCount: linkedCount,
        color: entityColors[eType] || entityColors.person
      });
      graphEdges.push({ source: code, target: refCode, role: '' });
    }

    // Also fetch shard for each new entity to find shared documents with existing nodes
    for (var j = 0; j < newEntities.length; j++) {
      var c = newEntities[j];
      if (!graphNodes.has(c)) continue; // skipped above (no entity-index record)
      if (!shardCache.has(c)) {
        try {
          var r = await fetch('/data/entity-links/' + c + '.json');
          if (r.ok) shardCache.set(c, await r.json());
          else shardCache.set(c, []);
        } catch (e) { shardCache.set(c, []); }
      }
      // Add edges to existing document nodes
      var shard = shardCache.get(c) || [];
      for (var k = 0; k < shard.length; k++) {
        var s = shard[k];
        if (graphNodes.has(s.reference_code) && s.reference_code !== refCode) {
          // This entity is also linked to another document already in the graph
          graphEdges.push({ source: c, target: s.reference_code, role: s.role });
        }
      }
    }

    // Incrementally add new nodes/links without rebuilding
    if (graphInstance) {
      var currentData = graphInstance.graphData();
      var nodeIds = new Set(currentData.nodes.map(function(n) { return n.id; }));
      var edgeKeys = new Set(currentData.links.map(function(l) {
        var s = typeof l.source === 'object' ? l.source.id : l.source;
        var t = typeof l.target === 'object' ? l.target.id : l.target;
        return s + '→' + t;
      }));

      var newNodes = [];
      var newLinks = [];

      graphNodes.forEach(function(node) {
        if (!nodeIds.has(node.id)) newNodes.push(node);
      });

      graphEdges.forEach(function(edge) {
        var key = edge.source + '→' + edge.target;
        if (!edgeKeys.has(key)) newLinks.push(Object.assign({}, edge));
      });

      if (newNodes.length > 0 || newLinks.length > 0) {
        // Position new nodes near the clicked document node
        var anchor = currentData.nodes.find(function(n) { return n.id === refCode; });
        if (anchor) {
          for (var ni = 0; ni < newNodes.length; ni++) {
            var angle = (2 * Math.PI * ni) / newNodes.length;
            newNodes[ni].x = anchor.x + 30 * Math.cos(angle);
            newNodes[ni].y = anchor.y + 30 * Math.sin(angle);
          }
        }

        rebuildAdjacency();
        graphInstance.graphData({
          nodes: currentData.nodes.concat(newNodes),
          links: currentData.links.concat(newLinks)
        });
        graphInstance.d3ReheatSimulation();

        // Keep centred on the clicked document
        if (anchor) {
          graphInstance.centerAt(anchor.x, anchor.y, 400);
        }
      }
    }
  }

  // --- Helpers ---

  function filterLinks(allLinks, active) {
    if (active.size === 0) return allLinks;
    return allLinks.filter(function(link) {
      return active.has(roleCode(link.role) || 'unknown');
    });
  }

});

// --- Timeline rendering ---

function renderTimeline(container, links, activeRoles) {
  var filtered = activeRoles && activeRoles.size > 0
    ? links.filter(function(l) { return activeRoles.has(roleCode(l.role) || 'unknown'); })
    : links;

  if (!filtered || filtered.length === 0) {
    container.innerHTML = '<p class="text-stone-500 text-sm" style="padding:16px 0">' + escapeHtml(_entityI18n.timelineFilteredEmpty || '') + '</p>';
    return;
  }

  // Three-bucket chronological sort (2026-04-20 fix):
  //   1. date_start (ISO YYYY-MM-DD from backend) — true chronological order.
  //   2. date_expression only — freeform Spanish string sort as a fallback
  //      for records whose backend export predates the date_start field.
  //   3. Sin fecha — no usable date on either field.
  // Display still uses date_expression; only the sort key changes.
  var datedByStart = [];
  var datedByExprOnly = [];
  var undated = [];
  for (var i = 0; i < filtered.length; i++) {
    if (filtered[i].date_start) {
      datedByStart.push(filtered[i]);
    } else if (filtered[i].date_expression) {
      datedByExprOnly.push(filtered[i]);
    } else {
      undated.push(filtered[i]);
    }
  }

  datedByStart.sort(function(a, b) {
    return a.date_start.localeCompare(b.date_start);
  });
  datedByExprOnly.sort(function(a, b) {
    return a.date_expression.localeCompare(b.date_expression);
  });

  var all = datedByStart.concat(datedByExprOnly, undated.length > 0 ? [null] : [], undated);
  var html = '';
  for (var j = 0; j < all.length; j++) {
    if (all[j] === null) {
      html += '<div class="timeline-no-date">' + escapeHtml(_entityI18n.noDateLabel || '') + '</div>';
      continue;
    }
    var isLast = (j === all.length - 1);
    html += renderTimelineEntry(all[j], isLast);
  }

  container.innerHTML = html;
}

function renderTimelineEntry(link, isLast) {
  var slug = link.reference_code.replace(/[?#]/g, '');
  var html = '<div class="timeline-entry' + (isLast ? ' timeline-entry-last' : '') + '">';

  // Left dot + vertical line
  html += '<div class="timeline-track">';
  html += '<div class="timeline-dot"><div class="timeline-dot-inner"></div></div>';
  if (!isLast) html += '<div class="timeline-line"></div>';
  html += '</div>';

  // Card with date, role badge, title, ref
  html += '<div class="timeline-card">';
  if (link.date_expression) {
    html += '<div class="timeline-date">' + escapeHtml(formatDate(link.date_expression)) + '</div>';
  }
  if (link.role) {
    var roleLabel = _entityRoleLabels[roleCode(link.role)] || link.role;
    html += '<span class="timeline-role-badge">' + escapeHtml(roleLabel) + '</span>';
  }
  html += '<a href="/' + slug + '/" class="timeline-title">' + escapeHtml(link.title) + '</a>';
  html += '<div class="timeline-ref">' + escapeHtml(link.reference_code) + '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

// The page's language is the one in <html lang>, which Hugo writes from
// the site's [ui] language setting.
function _pageLocale() {
  return (document.documentElement && document.documentElement.lang) || undefined;
}

function formatDate(dateStr) {
  return narrativeDate(dateStr, _pageLocale());
}

// narrative-date:start
// Formats an archival date string ("1723-03-15", "1723-03", or a range
// joined by " .. ") as prose in `locale`, with the month names and word
// order Intl takes from CLDR: "15 de marzo de 1723" in es-CO, "March 15,
// 1723" in en-US. The year is copied from the input so that years before
// 1000 keep four digits. Anything else passes through unchanged. This
// block is identical in entity.js, infinite-bipartite-explorer.js and
// place.js, and matches scripts/enrichment/date-format.js; tests check all four.
var _narrativeDateFmts = {};
function narrativeDate(dateStr, locale) {
  if (!dateStr) return '';
  if (dateStr.indexOf(' .. ') !== -1) {
    var range = dateStr.split(' .. ');
    return narrativeDate(range[0], locale) + ' – ' + narrativeDate(range[1], locale);
  }
  var m = dateStr.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return dateStr;
  var month = parseInt(m[2], 10);
  var day = m[3] ? parseInt(m[3], 10) : 0;
  if (month < 1 || month > 12) return dateStr;
  // 2000 is a leap year, so 29 February is a valid stand-in date.
  var date = new Date(Date.UTC(2000, month - 1, day || 1));
  if (day && date.getUTCDate() !== day) return dateStr;
  var key = (locale || '') + (day ? '|ymd' : '|ym');
  if (!_narrativeDateFmts[key]) {
    var opts = { timeZone: 'UTC', calendar: 'gregory', year: 'numeric', month: 'long' };
    if (day) opts.day = 'numeric';
    _narrativeDateFmts[key] = new Intl.DateTimeFormat(locale || undefined, opts);
  }
  var year = m[1];
  return _narrativeDateFmts[key].formatToParts(date).map(function (p) {
    return p.type === 'year' ? year : p.value;
  }).join('');
}
// narrative-date:end

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

// Version: v1.6.0
