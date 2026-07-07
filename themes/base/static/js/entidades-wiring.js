/**
 * Entity Explorer page wiring (`/entidades/`)
 *
 * Instantiates and connects the two controllers that drive the entity
 * explorer page: `InfiniteBipartiteExplorer` (the force-graph panel,
 * from infinite-bipartite-explorer.js) and `EntityExplorer` (the
 * filter/results sidebar, from entity-explorer.js). Wires the
 * cross-controller callbacks (focus, role filter, focal clear/visibility,
 * entity selection, filter changes), the viewport-filter toggle button,
 * the graph empty-state and its example-entity buttons, the zoom-driven
 * debounced re-search, and the live entity-count readout.
 *
 * Load order (constraints): this script MUST be loaded AFTER
 * infinite-bipartite-explorer.js and entity-explorer.js (it references the
 * `InfiniteBipartiteExplorer` and `EntityExplorer` globals they define),
 * and AFTER the page DOM (it runs on evaluation, not on DOMContentLoaded,
 * so its host elements — #graph-container, #entity-explorer,
 * #viewport-filter-toggle, #graph-empty-state, #entity-count-live — must
 * already exist). The template loads all three from its end-of-body
 * scripts block in that order.
 *
 * Value handoff: every Hugo-templated value this wiring needs travels via
 * DOM / data-* attributes set by entidades/list.html — the viewport
 * button's labels from its `data-i18n` blob, the example-entity codes from
 * each button's `data-entity`, the locale from `documentElement.lang`.
 * This file contains only static JS and no server-rendered values; the
 * i18n strings it reads are blob-only, with no Spanish fallback.
 *
 * @version v1.4.0
 */
(function() {
  'use strict';

  var _locale = document.documentElement.lang || 'es-CO';

  var graphContainer = document.getElementById('graph-container');
  var sidebarContainer = document.getElementById('entity-explorer');

  var graph = new InfiniteBipartiteExplorer(graphContainer);
  var sidebar = new EntityExplorer(sidebarContainer);

  graph.onEntityFocused = function(entityCode, entityMeta, shard) {
    sidebar.highlightEntity(entityCode, entityMeta, shard);
  };

  sidebar.onFocalRoleFilterChanged = function(rolesSet) {
    graph.setFocalRoleFilter(rolesSet);
  };

  sidebar.onFocalCleared = function() {
    graph.dismissTooltip && graph.dismissTooltip();
  };

  graph.onFocalVisibilityChanged = function(visible) {
    var card = document.getElementById('focal-entity-card');
    if (!card) return;
    if (visible) {
      card.classList.remove('is-excluded');
    } else {
      card.classList.add('is-excluded');
    }
  };

  sidebar.onEntitySelected = function(entityCode) {
    graph.refocusOn(entityCode);
  };

  sidebar.onFilterChanged = function(filters) {
    graph.applyFilters(filters);
  };

  sidebar._visibleCodeSource = function() { return graph.getVisibleEntityCodes(); };
  sidebar._visibleEntitiesSource = function() { return graph.getVisibleEntities(); };

  var viewportToggle = document.getElementById('viewport-filter-toggle');
  var viewportLabel = viewportToggle && viewportToggle.querySelector('.viewport-filter-label');
  var rerunDebounced = null;
  if (viewportToggle) {
    var _i18n = {};
    try { _i18n = JSON.parse(viewportToggle.dataset.i18n || '{}'); } catch (e) {}
    viewportToggle.addEventListener('click', function() {
      sidebar.viewportFilter = !sidebar.viewportFilter;
      viewportToggle.classList.toggle('is-active', sidebar.viewportFilter);
      viewportToggle.setAttribute('aria-pressed', sidebar.viewportFilter ? 'true' : 'false');
      if (viewportLabel) {
        viewportLabel.textContent = sidebar.viewportFilter
          ? (_i18n.viewportFilterActive || '')
          : (_i18n.viewportFilterLabel || '');
      }
      sidebar.state.page = 1;
      sidebar.search();
    });
  }

  var emptyState = document.getElementById('graph-empty-state');
  var hasUrlEntity = !!new URLSearchParams(location.search).get('entidad');
  if (emptyState) {
    if (!hasUrlEntity) emptyState.classList.add('is-active');
    emptyState.querySelectorAll('button[data-entity]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var code = btn.getAttribute('data-entity');
        if (code) graph.refocusOn(code);
      });
    });
  }

  var prevOnFocused = graph.onEntityFocused;
  graph.onEntityFocused = function(entityCode, entityMeta, shard) {
    if (emptyState) emptyState.classList.remove('is-active');
    if (prevOnFocused) prevOnFocused(entityCode, entityMeta, shard);
  };

  graph.init({ skipAutoLoad: !hasUrlEntity });
  sidebar.init();

  if (graph.graphInstance && typeof graph.graphInstance.onZoom === 'function') {
    graph.graphInstance.onZoom(function() {
      graph.updateTooltipPosition && graph.updateTooltipPosition();
      if (!sidebar.viewportFilter) return;
      clearTimeout(rerunDebounced);
      rerunDebounced = setTimeout(function() { sidebar.search(); }, 250);
    });
  }

  sidebar.onReady = function() {
    var el = document.getElementById('entity-count-live');
    if (el && typeof sidebar.getTotalEntityCount === 'function') {
      var n = sidebar.getTotalEntityCount();
      if (n > 0) el.textContent = new Intl.NumberFormat(_locale).format(n);
    }
  };
})();

// Version: v1.4.0
