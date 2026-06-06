/**
 * Place Explorer Controller (`/lugares/`)
 *
 * Drives the place explorer at `/lugares/`: a Pagefind-powered
 * search over the places index, a MapLibre + Protomaps terrain
 * basemap with clustered markers, a paginated results list,
 * sidebar facets (`place_type`, `has_coordinates`, `has_authority`),
 * filter pills, URL state sync, sort toggle, selected-place card,
 * and a viewport-bound filter toggle that re-derives counts from
 * the in-memory places list when active. Pagefind is a client-side
 * search engine that ships a small WebAssembly bundle plus a JSON
 * index built at build time, so the search runs entirely in the
 * browser with no server round-trip. The file is loaded as a
 * classic `<script>` tag (no ES module imports) and the
 * `PlaceExplorer` class self-instantiates from a
 * `DOMContentLoaded` listener at the bottom of the file when an
 * `#place-explorer` host is present.
 *
 * Cold-click performance follows the same three-sidecar pattern as
 * the entity explorer: `/lugares-facets.json` gives global facet
 * counts for the landing sidebar, `/lugares-pivots.json` gives
 * pair-wise intersection counts for single-filter cold clicks, and
 * `/lugares-triples.json` gives triple-wise intersection counts
 * for two-filter cold clicks. The explorer reads all three in
 * parallel at init, renders the sidebar synchronously from the
 * sidecars, and falls through to Pagefind's filter cache once it
 * warms in the background.
 *
 * `selectFacetCounts` and `buildPivotScopedFiltersPure` are
 * byte-for-byte sister copies of the helpers in `search.js` and
 * `entity-explorer.js`; see the narrative header of
 * `entity-explorer.js` for why the three flat `<script>`-loaded
 * explorer files each carry an independent copy rather than sharing
 * a module.
 *
 * Pipeline context:
 *   Build-time inputs: the `/pagefind-places/` Pagefind bundle,
 *   `/data/place-index.json` (map coordinates), and the three
 *   `lugares-*.json` sidecars. Run-time inputs: URL params, search
 *   and facet clicks, map drags. Outputs: DOM updates inside the
 *   explorer template slots (`#place-search-input`,
 *   `#sidebar-facets`, `#place-explorer`, `#selected-place-card`).
 *
 * @version v1.3.0
 */

/**
 * Pick the correct Pagefind facet count for a given (facetKey, value)
 * pair, given the user's currently active filter selections.
 *
 * Byte-identical to `selectFacetCounts` in `static/js/search.js` and
 * `static/js/entity-explorer.js` (the three flat `<script>`-loaded
 * explorer files each carry their own inline copy rather than
 * importing a shared module). Selection rule, missing-value handling,
 * and JSDoc are documented in detail at the canonical site in
 * `static/js/search.js`; see also the five cases in
 * `tests/pagefind-facets.test.js`.
 *
 * The logic is built around OR-group siblings — when the user picks
 * two+ values inside a single facet, `totalFilters[key][sibling]`
 * gives each sibling's true contribution to the union. In the
 * single-active-value case (exactly one value active for this facet
 * AND that value is the one being queried), Pagefind's `totalFilters`
 * entry collapses to 0 because there is no OR-sibling to restore
 * against — the "restore count" is mathematically the cardinality of
 * the empty sibling set. That renders as "Lugar poblado (0)" in the
 * sidebar when `place_type=city` is the sole active filter and
 * ~3,437 places match, which is worse than uninformative. For this
 * degenerate case we return `result.results.length` (the scoped
 * total) so the active badge reflects the size of the current result
 * set. Multi-value OR-group behaviour is preserved — only the exact
 * shape `activeFilters[facetKey] === [value]` takes the short-circuit.
 *
 * @param {object|null} result Pagefind `search()` payload (may be null).
 * @param {string} facetKey The facet key the caller is asking about.
 * @param {string} value The facet value the caller is asking about.
 * @param {object|null} activeFilters Map of currently active filters,
 *                                    shape `{ key: [value, ...] }`.
 * @returns {number} The count to render against this facet value.
 */
function selectFacetCounts(result, facetKey, value, activeFilters) {
  activeFilters = activeFilters || {};
  const activeInKey = Array.isArray(activeFilters[facetKey]) ? activeFilters[facetKey] : [];
  // Active-single-value short-circuit: when the queried
  // value is the sole active member of its facet, Pagefind's
  // `totalFilters[key][value]` collapses to 0 (no OR-group siblings to
  // restore against). Return the scoped result total instead so the
  // active badge is informative. Multi-value OR-group rendering is
  // unchanged — this branch only fires when activeInKey is exactly
  // [value].
  if (activeInKey.length === 1 && activeInKey[0] === value &&
      result && result.results && typeof result.results.length === 'number') {
    return result.results.length;
  }
  const sameFacetHasActive = activeInKey.length > 0;
  if (sameFacetHasActive) {
    // Same-facet OR-group OR the active value itself — read totalFilters.
    const group = (result && result.totalFilters && result.totalFilters[facetKey]) || {};
    return group[value] || 0;
  }
  // Cross-facet display — read from filters (constrained counts).
  const group = (result && result.filters && result.filters[facetKey]) || {};
  return group[value] || 0;
}

// 3-key pivot set for /lugares/. Must stay byte-equivalent to
// PLACE_PIVOT_FACET_KEYS in scripts/generate-pagefind-indices.js — the
// on-disk sidecar shape and the consumer lookup are on the same contract.
// Alphabetical ordering matters because buildPivotScopedFiltersPure uses
// canonical alphabetical ordering when walking the triples sidecar for the
// N=2 branch. Mirrors the PIVOT_KEYS constant in static/js/search.js with a
// different binding (6 keys for /buscar/, 4 keys for /entidades/, 3 keys here).
const PIVOT_KEYS = ['has_authority', 'has_coordinates', 'place_type'];

/**
 * Pure helper that computes a scoped filters object from the pivot /
 * triple sidecars, given a set of active filter dimensions and the
 * global facet counts. Extracted from the class method so
 * tests/pagefind-facets.test.js can exercise the full dispatch
 * (0, 1, 2, >=3 active dims) without constructing a PlaceExplorer
 * instance.
 *
 * The body is byte-equivalent to the same helper in
 * static/js/entity-explorer.js except that it closes over this file's
 * local PIVOT_KEYS (3 keys, alphabetical) instead of
 * entity-explorer.js's 4-key constant, and the two year-passthrough
 * lines are removed because places carry no year filter. The function
 * body text itself references PIVOT_KEYS by name so the same source is
 * portable with the different constant bound.
 *
 * @param {object} args
 * @param {object} args.activeByKey  Map of active pivot dim →
 *                                    non-empty array of active values
 *                                    (e.g. { place_type: ['city'],
 *                                    has_coordinates: ['true'] }).
 *                                    Keys outside PIVOT_KEYS are
 *                                    ignored.
 * @param {object|null} args.pivots       Pair-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object|null} args.triples      Triple-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object} args.globalFilters     Global facet counts — used for
 *                                        the active-key pass-through.
 * @returns {object|null} A scopedFilters object with the same shape
 *                        as globalFilters (`{ key: { value: count } }`),
 *                        or null if no applicable pivot path exists
 *                        (0 or >=3 active dims, sidecar missing, etc.).
 *                        Caller falls back to globalFilters when null
 *                        is returned.
 */
function buildPivotScopedFiltersPure(args) {
  const activeByKey = (args && args.activeByKey) || {};
  const pivots = (args && args.pivots) || null;
  const triples = (args && args.triples) || null;
  const globalFilters = (args && args.globalFilters) || {};

  const activeKeys = [];
  for (const key of PIVOT_KEYS) {
    if (Array.isArray(activeByKey[key]) && activeByKey[key].length > 0) {
      activeKeys.push(key);
    }
  }
  const n = activeKeys.length;
  if (n === 0) return null;          // isLanding branch handles.
  if (n >= 3) return null;           // Quad-pivot deferred (wishlist).

  if (n === 1) {
    if (!pivots) return null;
    const activeKey = activeKeys[0];
    const activeValues = activeByKey[activeKey];
    const pivot = pivots[activeKey];
    if (!pivot) return null;
    const scoped = Object.create(null);
    // Active key: keep globalFilters counts so OR-group siblings show
    // their true sizes and the active-badge fix (selectFacetCounts)
    // can surface the scoped total via result.results.length.
    scoped[activeKey] = Object.create(null);
    for (const v of Object.keys(globalFilters[activeKey] || {})) {
      scoped[activeKey][v] = (globalFilters[activeKey] || {})[v] || 0;
    }
    // Inactive pivot keys: sum pair-wise pivot counts across each
    // active value.
    for (const inactiveKey of PIVOT_KEYS) {
      if (inactiveKey === activeKey) continue;
      scoped[inactiveKey] = Object.create(null);
      for (const inactiveVal of Object.keys(globalFilters[inactiveKey] || {})) {
        let sum = 0;
        for (const a of activeValues) {
          const cell = pivot[a] && pivot[a][inactiveKey] && pivot[a][inactiveKey][inactiveVal];
          if (cell) sum += cell;
        }
        scoped[inactiveKey][inactiveVal] = sum;
      }
    }
    // Note: no year passthrough — places carry no year filter.
    return scoped;
  }

  // n === 2: triple-wise lookup.
  if (!triples) return null;
  const [keyA, keyB] = activeKeys;
  const valuesA = activeByKey[keyA];
  const valuesB = activeByKey[keyB];
  const scoped = Object.create(null);
  // Active keys: keep globalFilters counts (same rationale as N=1 —
  // the selectFacetCounts active-value branch handles the scoped
  // total via result.results.length on the single-active-value case,
  // and OR-group siblings show their real sizes).
  for (const activeKey of activeKeys) {
    scoped[activeKey] = Object.create(null);
    for (const v of Object.keys(globalFilters[activeKey] || {})) {
      scoped[activeKey][v] = (globalFilters[activeKey] || {})[v] || 0;
    }
  }
  // Inactive pivot keys: sum triple-wise counts across each (a, b)
  // pair in the two active value sets. The triples sidecar is indexed
  // in canonical alphabetical key order (A < B < C per the indexer
  // emission), so we sort the three keys alphabetically and look up
  // by the sorted path before walking.
  for (const inactiveKey of PIVOT_KEYS) {
    if (inactiveKey === keyA || inactiveKey === keyB) continue;
    scoped[inactiveKey] = Object.create(null);
    const sortedKeys = [keyA, keyB, inactiveKey].slice().sort();
    const [sk0, sk1, sk2] = sortedKeys;
    for (const inactiveVal of Object.keys(globalFilters[inactiveKey] || {})) {
      let sum = 0;
      for (const a of valuesA) {
        for (const b of valuesB) {
          const valByKey = { [keyA]: a, [keyB]: b, [inactiveKey]: inactiveVal };
          const v0 = valByKey[sk0];
          const v1 = valByKey[sk1];
          const v2 = valByKey[sk2];
          const cell = triples[sk0] && triples[sk0][v0]
            && triples[sk0][v0][sk1] && triples[sk0][v0][sk1][v1]
            && triples[sk0][v0][sk1][v1][sk2] && triples[sk0][v0][sk1][v1][sk2][v2];
          if (cell) sum += cell;
        }
      }
      scoped[inactiveKey][inactiveVal] = sum;
    }
  }
  // Note: no year passthrough — places carry no year filter.
  return scoped;
}

class PlaceExplorer {
  constructor(container) {
    this.container = container;
    this.allPlaces = [];      // Loaded from place-index.json — map coordinates only
    this.pagefind = null;
    this.globalFilters = {};
    this.pivots = null;       // Pair-wise pivot sidecar (null until fetch)
    this.triples = null;      // Triple-wise pivot sidecar (null until fetch)
    this.lastSearch = null;   // Cached last Pagefind search result (for viewport re-filter)
    this.map = null;
    this.mapReady = false;
    this.perPage = 20;
    this._debounce = null;
    this._onMoveEnd = null;
    this._searchGen = 0;

    // Locale-aware formatters (read from <html lang>; fallback es-CO).
    const _locale = document.documentElement.lang || 'es-CO';
    this._locale = _locale;
    this._fmt  = new Intl.NumberFormat(_locale);
    this._pr   = new Intl.PluralRules(_locale.split('-')[0]);

    // App-label strings from data-i18n blob injected by the template.
    this._i18n = {};
    try {
      this._i18n = JSON.parse(container.dataset.i18n || '{}');
    } catch (e) {
      console.warn('PlaceExplorer: could not parse data-i18n');
    }

    this.placeTypes = {};
    try {
      this.placeTypes = JSON.parse(container.dataset.placeTypes || '{}');
    } catch (e) {
      console.warn('PlaceExplorer: could not parse data-place-types');
    }

    this.maptilerKey = container.dataset.maptilerKey || '';
    this.maptilerStyleId = container.dataset.maptilerStyleId || '';

    this.state = {
      q: '',
      type: [],
      hasCoords: null,
      hasAuthority: null,
      sort: 'name:asc',
      page: 1,
      mapBound: false
    };

    this.facetGroupState = { type: true, coords: true, authority: true };

    this.init();
  }

  async init() {
    this.parseUrlParams();
    this.showLoadingOverlay();

    try {
      // Load Pagefind and place-index.json in parallel.
      // pagefind.filters() is deliberately not awaited here: it blocks init
      // for ~7-13 s on a cold place-index and is not needed for the first
      // render. The fire-and-forget .then() chain below populates
      // this.globalFilters once the warm completes.
      const pagefindInit = (async () => {
        this.pagefind = await import('/pagefind-places/pagefind.js');
        await this.pagefind.options({ basePath: '/pagefind-places/' });
        await this.pagefind.init();
      })();

      const jsonLoad = (async () => {
        const response = await fetch('/data/place-index.json');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        this.allPlaces = await response.json();
      })();

      await Promise.all([pagefindInit, jsonLoad]);
    } catch (e) {
      this.hideLoadingOverlay();
      this.showError();
      return;
    }

    // Fetch the three landing sidecars in parallel: facets + pivots + triples.
    // (The same pattern is used by static/js/search.js and entity-explorer.js.)
    // Non-fatal on each failure — the consumer returns null and the caller falls
    // back to globalFilters or to the warm chain.
    const [facetsRes, pivotsRes, triplesRes] = await Promise.allSettled([
      fetch('/lugares-facets.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      fetch('/lugares-pivots.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      fetch('/lugares-triples.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    ]);
    if (facetsRes.status === 'fulfilled') {
      this.globalFilters = facetsRes.value;
    } else {
      console.warn('Failed to load /lugares-facets.json; landing sidebar will wait for filters() warm.', facetsRes.reason);
    }
    this.pivots = pivotsRes.status === 'fulfilled' ? pivotsRes.value : null;
    if (pivotsRes.status === 'rejected') {
      console.warn('Failed to load /lugares-pivots.json; falling back to global counts on cold first-click.', pivotsRes.reason);
    }
    this.triples = triplesRes.status === 'fulfilled' ? triplesRes.value : null;
    if (triplesRes.status === 'rejected') {
      console.warn('Failed to load /lugares-triples.json; falling back to global counts on cold first-click.', triplesRes.reason);
    }

    // Move pagefind.filters() off the init critical path (the same approach
    // entity-explorer.js and static/js/search.js take). Fire-and-forget with a
    // swallowed .catch — failures surface on the first user action that reads
    // this.globalFilters. The constructor default this.globalFilters = {} keeps
    // synchronous reads safe via the existing `|| this.globalFilters` fallback
    // patterns in renderFacets and _buildScopedFacetCounts; the .then() callback
    // overwrites with the authoritative Pagefind facets when the warm chain
    // resolves. Both read sites are guarded (one uses `|| {}`, the other uses
    // `filters || this.globalFilters`) with the {} constructor default as the
    // ultimate fallback, so no additional inline guards are needed for places.
    this.pagefind.filters()
      .then(gf => { this.globalFilters = gf; })
      .catch(() => { /* swallowed; surfaces on first user action */ });

    this.hideLoadingOverlay();
    this.buildDOM();
    this.initMap();
    // Cold-init fix: the MapTiler 'load' event does not fire when the style
    // fetch fails. Call search() unconditionally here so pills + results +
    // facets render regardless of map state. updateMap() inside search() is
    // already guarded by `if (!this.mapReady) return;`, so calling search()
    // before the map loads is safe — it renders the Pagefind surface and skips
    // the marker update. When the map does load, the on('load') callback
    // in initMap() fires search() a second time with mapReady=true,
    // pushing markers to the now-ready map canvas. The double call is
    // safe via the _searchGen stale-render cancellation mechanism.
    this.search();
    this.initExampleButtons();
    this.initViewportFilter();

    // Update place count live from Pagefind index
    var countEl = document.getElementById('place-count-live');
    if (countEl) {
      try {
        var allPlaces = await this.pagefind.search(null, {});
        var n = allPlaces.results.length;
        if (n > 0) countEl.textContent = this._fmt.format(n);
      } catch (e) {
        // keep static count from template
      }
    }

    window.addEventListener('popstate', () => {
      this.parseUrlParams();
      this.syncFormToState();
      this.search();
    });
  }

  showLoadingOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'search-loading search-loading-overlay';
    overlay.id = 'place-explorer-loading';
    overlay.innerHTML = '<p>' + this.escapeHtml(this._i18n.loadingPlaces) + '</p>';
    this.container.appendChild(overlay);
  }

  hideLoadingOverlay() {
    var overlay = document.getElementById('place-explorer-loading');
    if (overlay) overlay.remove();
  }

  showError() {
    this.container.innerHTML =
      '<div class="search-no-results">' +
      '<p style="font-size:1.1rem;font-weight:500;color:var(--color-stone-600)">' + this.escapeHtml(this._i18n.errorTitle) + '</p>' +
      '<p style="color:var(--color-stone-400)">' + this.escapeHtml(this._i18n.errorHint) + '</p>' +
      '</div>';
  }

  // ─── DOM construction ───────────────────────────────────────────────────────

  buildDOM() {
    // ── Search input into #place-search-input ──────────────────────────────
    var searchSlot = document.getElementById('place-search-input');
    if (searchSlot) {
      this.searchInput = document.createElement('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = this._i18n.searchPlaceholder;
      this.searchInput.value = this.state.q;
      this.searchInput.style.cssText = 'width:100%;padding:0.75rem 1.25rem;font-size:1rem;border:1px solid var(--color-stone-300);border-radius:50px;outline:none;font-family:var(--font-sans);box-sizing:border-box';
      this.searchInput.addEventListener('input', () => {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => {
          this.state.q = this.searchInput.value;
          this.state.page = 1;
          this.search();
          this.updateUrl();
        }, 250);
      });
      searchSlot.appendChild(this.searchInput);
    }

    // ── Active filter pills into #place-explorer (results column) ─────────
    this.pillsEl = document.createElement('div');
    this.pillsEl.className = 'active-filters';
    this.pillsEl.style.marginBottom = '0';
    this.container.appendChild(this.pillsEl);

    // Ghost-pill fix: the "Borrar todos los filtros" button previously lived
    // inside pillsEl (.active-filters flex row), making it a pill-shaped flex
    // sibling of the active filter pills and visually ambiguous. Moving it to
    // a dedicated sibling node eliminates the ambiguity without changing any
    // behaviour. clearBtnEl is hidden when there are no active filters (same
    // guard as renderPills' hasAny check).
    this.clearBtnEl = document.createElement('div');
    this.clearBtnEl.style.cssText = 'margin-bottom:0.75rem;display:none';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'clear-filters-btn';
    clearBtn.textContent = this._i18n.clearFilters;
    clearBtn.addEventListener('click', () => this.clearFilters());
    this.clearBtnEl.appendChild(clearBtn);
    this.container.appendChild(this.clearBtnEl);

    // ── Results info bar ───────────────────────────────────────────────────
    this.resultsInfoEl = document.createElement('div');
    this.resultsInfoEl.className = 'search-results-info';
    this.resultsInfoEl.style.marginBottom = '0.5rem';
    this.container.appendChild(this.resultsInfoEl);

    // ── Results list ───────────────────────────────────────────────────────
    this.resultsListEl = document.createElement('div');
    this.resultsListEl.className = 'results-list';
    this.container.appendChild(this.resultsListEl);

    // ── Pagination ─────────────────────────────────────────────────────────
    this.paginationEl = document.createElement('div');
    this.paginationEl.className = 'search-pagination';
    this.container.appendChild(this.paginationEl);

    // ── Facets go into #sidebar-facets ─────────────────────────────────────
    this.facetContainer = document.getElementById('sidebar-facets');
    if (!this.facetContainer) {
      // Fallback: create inline (shouldn't happen with new template)
      this.facetContainer = document.createElement('div');
      this.facetContainer.className = 'facet-container';
      this.container.appendChild(this.facetContainer);
    }
  }

  // ─── Map init ───────────────────────────────────────────────────────────────

  initMap() {
    if (typeof maplibregl === 'undefined') return;

    // Basemap: custom MapTiler Topo style. Style ID + API key come from
    // hugo.toml [params] via `data-maptiler-*` attributes on the
    // #place-explorer container; the key is origin-restricted server-side at
    // MapTiler. Cluster-count labels use `Noto Sans Regular` — a font the
    // MapTiler Topo style exposes; no runtime font-probe needed.
    var style = 'https://api.maptiler.com/maps/' + this.maptilerStyleId + '/style.json?key=' + this.maptilerKey;
    this._clusterFont = ['Noto Sans Regular'];

    this.map = new maplibregl.Map({
      container: 'explorer-map',
      style: style,
      center: [-74.0, 5.5],
      zoom: 5,
      renderWorldCopies: false
    });

    this.map.fitBounds([[-83.0, -5.0], [-60.0, 15.0]], { padding: 20, animate: false });

    this.map.on('load', () => {
      this.mapReady = true;

      // GeoJSON source with clustering enabled
      this.map.addSource('places', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 50
      });

      // Cluster circles — size scales with point_count
      this.map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'places',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#8B2942',
          'circle-radius': [
            'step', ['get', 'point_count'],
            14,
            10, 18,
            50, 22,
            200, 28
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff'
        }
      });

      // Cluster count labels
      this.map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'places',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': this._clusterFont,
          'text-size': 11
        },
        paint: {
          'text-color': '#fff'
        }
      });

      // Unclustered individual place markers
      this.map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'places',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#8B2942',
          'circle-radius': 6,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff'
        }
      });

      // Click on cluster: zoom to expand children
      this.map.on('click', 'clusters', async (e) => {
        var features = this.map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;
        var clusterId = features[0].properties.cluster_id;
        var zoom = await this.map.getSource('places').getClusterExpansionZoom(clusterId);
        this.map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
      });

      // Click on unclustered point: select place in sidebar
      this.map.on('click', 'unclustered-point', (e) => {
        var feat = e.features[0];
        if (!feat) return;
        var placeRecord = this.allPlaces.find(function(p) {
          return String(p.id) === String(feat.properties.id);
        }) || feat.properties;
        this.highlightPlace(placeRecord);
      });

      // Reusable hover popup (no close button, positioned above marker)
      this._hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: [0, -10],
        className: 'place-tooltip'
      });

      // Cluster hover: show place count
      this.map.on('mouseenter', 'clusters', (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
        var feat = e.features[0];
        if (!feat) return;
        var count = feat.properties.point_count || 0;
        this._hoverPopup
          .setLngLat(feat.geometry.coordinates)
          .setHTML(this.escapeHtml(this._i18n.clusterCount.replace('{count}', this._fmt.format(count))))
          .addTo(this.map);
      });
      this.map.on('mouseleave', 'clusters', () => {
        this.map.getCanvas().style.cursor = '';
        this._hoverPopup.remove();
      });

      // Unclustered point hover: show place name + doc count
      this.map.on('mouseenter', 'unclustered-point', (e) => {
        this.map.getCanvas().style.cursor = 'pointer';
        var feat = e.features[0];
        if (!feat) return;
        var props = feat.properties;
        var name = props.display_name || '';
        var n = props.linked_description_count || 0;
        var docText = n > 0
          ? ' \u2014 ' + this._fmt.format(n) + ' ' + (this._i18n.document || {})[this._pr.select(n)]
          : '';
        this._hoverPopup
          .setLngLat(feat.geometry.coordinates)
          .setHTML(this.escapeHtml(name) + docText)
          .addTo(this.map);
      });
      this.map.on('mouseleave', 'unclustered-point', () => {
        this.map.getCanvas().style.cursor = '';
        this._hoverPopup.remove();
      });

      // Initial search after map is ready
      this.search();
    });
  }

  // ─── Example place buttons (in header intro text) ───────────────────────────

  initExampleButtons() {
    var buttons = document.querySelectorAll('.explorer-page-intro button[data-place]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        var slug = btn.getAttribute('data-place');
        if (!slug) return;
        var found = this.allPlaces.find(function(p) {
          var normalised = p.display_name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[áä]/g, 'a')
            .replace(/[éë]/g, 'e')
            .replace(/[íï]/g, 'i')
            .replace(/[óö]/g, 'o')
            .replace(/[úü]/g, 'u')
            .replace(/ñ/g, 'n')
            .replace(/[^a-z0-9-]/g, '');
          return normalised === slug || normalised.startsWith(slug);
        });
        if (found) {
          this.highlightPlace(found);
        }
      });
    });
  }

  // ─── Viewport filter ────────────────────────────────────────────────────────

  initViewportFilter() {
    var toggle = document.getElementById('viewport-filter-toggle');
    var label = toggle && toggle.querySelector('.viewport-filter-label');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      this.state.mapBound = !this.state.mapBound;
      toggle.classList.toggle('is-active', this.state.mapBound);
      toggle.setAttribute('aria-pressed', this.state.mapBound ? 'true' : 'false');
      if (label) {
        // Both states are blob-driven (place.viewportFilterLabel inactive,
        // place.viewportFilterActive active). No Spanish fallback —
        // single-source.
        label.textContent = this.state.mapBound
          ? this._i18n.viewportFilterActive
          : this._i18n.viewportFilterLabel;
      }

      if (this.state.mapBound && this.map) {
        this._onMoveEnd = () => {
          if (!this.state.mapBound) return;
          clearTimeout(this._debounce);
          this._debounce = setTimeout(() => { this.search(); }, 250);
        };
        this.map.on('moveend', this._onMoveEnd);
      } else {
        if (this._onMoveEnd && this.map) {
          this.map.off('moveend', this._onMoveEnd);
          this._onMoveEnd = null;
        }
      }

      this.state.page = 1;
      this.search();
    });
  }

  // ─── Selected place card ────────────────────────────────────────────────────

  highlightPlace(place) {
    var card = document.getElementById('selected-place-card');
    if (!card) return;

    var name = place.display_name || '';
    var placeType = place.place_type || '';
    var typeLabel = this.placeTypes[placeType] || placeType;
    var n = place.linked_description_count || 0;
    // Selected-place stat reuses the shared [ui].linkedDocLabel plural noun
    // ("documento(s) vinculado(s)"), pluralized via Intl.PluralRules \u2014 blob-only.
    var _docLabel = (this._i18n.linkedDocLabel || {})[this._pr.select(n)];
    var docText = n + ' ' + _docLabel;
    var placeId = place.id;
    var placeCode = place.place_code;

    card.innerHTML =
      '<div class="selected-entity-header">' +
        '<h3 class="selected-entity-name">' + this.escapeHtml(name) + '</h3>' +
        '<button type="button" class="selected-entity-close" aria-label="' + this.escapeHtml(this._i18n.selectedClose) + '">&times;</button>' +
      '</div>' +
      '<span class="selected-entity-badge">' + this.escapeHtml(typeLabel) + '</span>' +
      '<div class="selected-entity-stat" style="margin-top:0.75rem">' + this.escapeHtml(docText) + '</div>' +
      '<a href="/' + this.escapeHtml(placeCode) + '/" class="selected-entity-link" ' +
      'style="display:block;margin-top:0.5rem">' + this.escapeHtml(this._i18n.cardLink) + '</a>';

    // Close button clears back to stub
    var closeBtn = card.querySelector('.selected-entity-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        card.innerHTML = '<div class="selected-entity-stub">' + this.escapeHtml(this._i18n.selectPrompt) + '</div>';
      });
    }

    // Pan/zoom map to place coordinates
    if (place.latitude != null && place.longitude != null && this.map && this.mapReady) {
      this.map.easeTo({ center: [place.longitude, place.latitude], zoom: Math.max(this.map.getZoom(), 8) });
    }
  }

  // ─── URL state ──────────────────────────────────────────────────────────────

  parseUrlParams() {
    var params = new URLSearchParams(window.location.search);
    this.state.q = params.get('q') || '';
    this.state.type = params.getAll('type');
    this.state.hasCoords = params.has('coords') ? params.get('coords') === '1' : null;
    this.state.hasAuthority = params.has('authority') ? params.get('authority') === '1' : null;
    // Parse sort param with legacy backcompat and direction promotion.
    // state.sort is now 'field:dir'. Old bookmarks that
    // contain bare field names are promoted to canonical defaults:
    //   ?sort=         → 'name:asc'  (default)
    //   ?sort=name     → 'name:asc'
    //   ?sort=linked   → 'linked:desc' (promoted — desc is the natural
    //                    first-click direction for a document-count sort)
    //   ?sort=field:dir → passed through verbatim if valid
    //   unknown        → clamped to 'name:asc'
    var rawSort = params.get('sort') || '';
    var validSorts = ['name:asc', 'name:desc', 'linked:asc', 'linked:desc'];
    if (!rawSort || rawSort === 'name') {
      this.state.sort = 'name:asc';
    } else if (rawSort === 'linked') {
      this.state.sort = 'linked:desc';
    } else if (validSorts.indexOf(rawSort) !== -1) {
      this.state.sort = rawSort;
    } else {
      this.state.sort = 'name:asc';
    }
    this.state.page = parseInt(params.get('page') || '1', 10);
    this.state.mapBound = params.get('map_bound') === '1';
  }

  updateUrl() {
    var params = new URLSearchParams();
    if (this.state.q) params.set('q', this.state.q);
    for (var i = 0; i < this.state.type.length; i++) params.append('type', this.state.type[i]);
    if (this.state.hasCoords !== null) params.set('coords', this.state.hasCoords ? '1' : '0');
    if (this.state.hasAuthority !== null) params.set('authority', this.state.hasAuthority ? '1' : '0');
    // Omit sort param when state is 'name:asc' (default — suppress from URL).
    if (this.state.sort !== 'name:asc') params.set('sort', this.state.sort);
    if (this.state.page > 1) params.set('page', String(this.state.page));
    if (this.state.mapBound) params.set('map_bound', '1');
    var qs = params.toString();
    var url = qs ? '/lugares/?' + qs : '/lugares/';
    history.pushState(null, '', url);
  }

  // Sync form controls to restored state (after popstate)
  syncFormToState() {
    if (this.searchInput) this.searchInput.value = this.state.q;
    var toggle = document.getElementById('viewport-filter-toggle');
    var label = toggle && toggle.querySelector('.viewport-filter-label');
    if (toggle) {
      toggle.classList.toggle('is-active', this.state.mapBound);
      toggle.setAttribute('aria-pressed', this.state.mapBound ? 'true' : 'false');
      if (label) {
        // Both states are blob-driven (place.viewportFilterLabel inactive,
        // place.viewportFilterActive active). No Spanish fallback —
        // single-source.
        label.textContent = this.state.mapBound
          ? this._i18n.viewportFilterActive
          : this._i18n.viewportFilterLabel;
      }
    }
  }

  // ─── Pivot-scoped filter collector ──────────────────────────────────────────

  // Class-method adapter that maps PlaceExplorer state to the activeByKey
  // shape that buildPivotScopedFiltersPure expects, then delegates. The
  // URL-param key for type is 'type' but the Pagefind filter key (and
  // pivot/triples sidecar key) is 'place_type' — the adapter renames.
  // state.hasCoords === true (strict equal) emits has_coordinates: ['true']
  // (a string array matching the indexer emission in
  // scripts/generate-pagefind-indices.js); the negative case is not
  // included because the place-explorer UI only exposes the positive
  // checkbox. Likewise for state.hasAuthority.
  buildPivotScopedFilters() {
    const activeByKey = Object.create(null);
    if (this.state.type && this.state.type.length > 0) {
      activeByKey.place_type = this.state.type;
    }
    if (this.state.hasCoords === true) {
      activeByKey.has_coordinates = ['true'];
    }
    if (this.state.hasAuthority === true) {
      activeByKey.has_authority = ['true'];
    }
    return buildPivotScopedFiltersPure({
      activeByKey,
      pivots: this.pivots,
      triples: this.triples,
      globalFilters: this.globalFilters || {},
    });
  }

  // ─── Pagefind search ─────────────────────────────────────────────────────────

  async search() {
    if (!this.pagefind) return;
    if (!this.resultsListEl) return;

    // Pre-Pagefind sidebar render from the pivot/triples sidecar when N=1 or
    // N=2 active dims are present and the sidecars loaded successfully. The
    // post-Pagefind renderFacets at the end of this method will OVERWRITE this
    // with the authoritative shape — both come from the same indexer pipeline
    // so the values match. The main pane (renderResultsInfo / renderResults)
    // stays on the post-Pagefind path; place-explorer never derived the
    // main-pane total from a pre-Pagefind path, so there is no
    // self-contradiction window. The pre-Pagefind sidebar render is purely
    // additive — the user sees correct intersection counts in the sidebar
    // immediately and the same totals in the main pane when Pagefind resolves.
    // When pivotScoped is null (sidecars failed, OR n=0 active dims, OR n=3
    // active dims), the if-guard skips and the existing flow proceeds.
    const pivotScoped = this.buildPivotScopedFilters();
    if (pivotScoped) {
      this.renderFacets(pivotScoped);
    }

    // Generation counter prevents stale in-flight searches from
    // calling renderFacets() and resetting checkbox state
    var gen = ++this._searchGen;

    // Build Pagefind filters
    var pfFilters = {};
    if (this.state.type.length > 0) pfFilters.place_type = { any: this.state.type };
    if (this.state.hasCoords !== null) pfFilters.has_coordinates = this.state.hasCoords ? 'true' : 'false';
    if (this.state.hasAuthority !== null) pfFilters.has_authority = this.state.hasAuthority ? 'true' : 'false';

    // Build Pagefind sort. Native sort uses the `count` field
    // registered by the places indexer. state.sort is 'field:dir';
    // split on ':' to get field and direction. Map field 'linked' →
    // Pagefind key 'count'. Pass pfSort unconditionally.
    var sortParts = this.state.sort.split(':');
    var sortField = sortParts[0];
    var sortDir   = sortParts[1] || 'asc';
    var pfSortKey = sortField === 'linked' ? 'count' : sortField;
    var pfSort = {};
    pfSort[pfSortKey] = sortDir;

    try {
      var searchResult = await this.pagefind.search(
        this.state.q || null,
        {
          filters: Object.keys(pfFilters).length ? pfFilters : undefined,
          sort: pfSort
        }
      );

      if (gen !== this._searchGen) return;

      this.lastSearch = searchResult;

      var allResults = searchResult.results;
      // per-value selection via selectFacetCounts.
      // Same { facetKey: { value: count } } shape as before so the
      // three renderFacets blocks (place_type, has_coordinates,
      // has_authority) read counts unchanged, but each cell now
      // respects the filters / totalFilters split.
      var scopedFilters = this._buildScopedFacetCounts(searchResult);

      // Apply viewport filter if mapBound is active
      var filteredResults = allResults;
      if (this.state.mapBound && this.map && this.mapReady) {
        var bounds = this.map.getBounds();
        var viewportNames = new Set(
          this.allPlaces
            .filter(function(p) {
              return p.latitude != null && p.longitude != null &&
                p.longitude >= bounds.getWest() && p.longitude <= bounds.getEast() &&
                p.latitude >= bounds.getSouth() && p.latitude <= bounds.getNorth();
            })
            .map(function(p) { return p.display_name; })
        );
        // Load data for all results to check title against viewport names.
        // Pagefind stubs don't expose URL or title, so we must resolve them.
        var allData = await Promise.all(allResults.map(function(r) { return r.data(); }));
        if (gen !== this._searchGen) return;
        allData = allData.filter(function(d) { return viewportNames.has(d.meta.title); });
        var total = allData.length;
        var totalPages = Math.ceil(total / this.perPage) || 1;
        if (this.state.page > totalPages) this.state.page = 1;
        var start = (this.state.page - 1) * this.perPage;
        var hits = allData.slice(start, start + this.perPage);
      } else {
        var total = filteredResults.length;
        var totalPages = Math.ceil(total / this.perPage) || 1;
        if (this.state.page > totalPages) this.state.page = 1;
        // Pagefind native sort handles ordering for both
        // 'name' ({ name: 'asc' }) and 'linked' ({ count: 'desc' }).
        // The pfSort object is built above and passed to pagefind.search().
        // No client-side sort is needed — the full result set is already
        // in the correct order when Pagefind returns it. (An earlier
        // client-side sort over filteredResults was removed: it was a no-op
        // because raw stubs expose no .url property.)
        var start = (this.state.page - 1) * this.perPage;
        var pageResults = filteredResults.slice(start, start + this.perPage);
        var hits = await Promise.all(pageResults.map(function(r) { return r.data(); }));
        if (gen !== this._searchGen) return;
      }

      // Sync map markers with search/filter state
      if (this.state.q || this.state.type.length || this.state.hasCoords !== null || this.state.hasAuthority !== null) {
        var matchingCodes = new Set();
        for (var ri = 0; ri < allResults.length; ri++) {
          var url = allResults[ri].url || '';
          var segments = url.split('/').filter(Boolean);
          if (segments.length > 0) matchingCodes.add(segments[segments.length - 1]);
        }
        var filteredPlaces = this.allPlaces.filter(function(p) {
          return matchingCodes.has(p.place_code);
        });
        this.updateMap(filteredPlaces);
      } else {
        this.updateMap(this.allPlaces);
      }

      // When viewport-filtering, recompute facet counts from the
      // in-memory place data filtered to the current map bounds.
      if (this.state.mapBound && this.map && this.mapReady) {
        var vpBounds = this.map.getBounds();
        var vpPlaces = this.allPlaces.filter(function(p) {
          return p.latitude != null && p.longitude != null &&
            p.longitude >= vpBounds.getWest() && p.longitude <= vpBounds.getEast() &&
            p.latitude >= vpBounds.getSouth() && p.latitude <= vpBounds.getNorth();
        });
        var vpFacets = { place_type: {}, has_coordinates: {}, has_authority: {} };
        for (var vi = 0; vi < vpPlaces.length; vi++) {
          var vp = vpPlaces[vi];
          var pt = vp.place_type || 'unknown';
          vpFacets.place_type[pt] = (vpFacets.place_type[pt] || 0) + 1;
          var hasCoords = (vp.latitude != null && vp.longitude != null) ? 'true' : 'false';
          vpFacets.has_coordinates[hasCoords] = (vpFacets.has_coordinates[hasCoords] || 0) + 1;
          var hasAuth = (vp.has_wikidata || vp.has_tgn || vp.has_whg || vp.has_hgis) ? 'true' : 'false';
          vpFacets.has_authority[hasAuth] = (vpFacets.has_authority[hasAuth] || 0) + 1;
        }
        scopedFilters = vpFacets;
      }

      this.renderResultsInfo(total, allResults.length);
      this.renderResults(hits, total);
      this.renderPagination(total);
      this.renderFacets(scopedFilters);
      this.renderPills();
    } catch (e) {
      console.error('PlaceExplorer search error:', e);
    }
  }

  // ─── Results info bar ───────────────────────────────────────────────────────

  renderResultsInfo(total, rawTotal) {
    this.resultsInfoEl.innerHTML = '';

    var countSpan = document.createElement('span');
    countSpan.className = 'results-count';

    var hasFilters = this.state.q || this.state.type.length > 0 ||
      this.state.hasCoords !== null || this.state.hasAuthority !== null || this.state.mapBound;

    if (!hasFilters) {
      countSpan.textContent = this._i18n.countNoFilter.replace('{count}', this._fmt.format(rawTotal || total));
    } else if (total === 1) {
      countSpan.textContent = this._i18n.countOne;
    } else {
      countSpan.textContent = this._i18n.countMany.replace('{count}', this._fmt.format(total));
    }
    this.resultsInfoEl.appendChild(countSpan);

    // Sort controls — mirror the /buscar/ sort-wrap DOM shape in
    // static/js/search.js. The class name is 'sort-wrap'; the label is
    // 'Ordenar por:'; each button carries a sort-arrow span showing ↑ or ↓.
    // Options are Nombre + Documentos only (no Relevancia — place search is
    // not relevance-scored).
    var sortWrap = document.createElement('div');
    sortWrap.className = 'sort-wrap';

    var sortLabel = document.createElement('span');
    sortLabel.className = 'sort-label';
    sortLabel.textContent = this._i18n.sortBy;
    sortWrap.appendChild(sortLabel);

    var sortOptions = [
      { field: 'name',   label: this._i18n.sortName },
      { field: 'linked', label: this._i18n.sortDocs }
    ];

    var currentField = this.state.sort.split(':')[0];
    var currentDir   = this.state.sort.split(':')[1];

    for (var i = 0; i < sortOptions.length; i++) {
      var opt = sortOptions[i];

      if (i > 0) {
        var divider = document.createElement('span');
        divider.className = 'sort-divider';
        divider.textContent = '|';
        sortWrap.appendChild(divider);
      }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sort-btn';
      var isActive = currentField === opt.field;
      if (isActive) btn.classList.add('active');

      btn.textContent = opt.label;

      var arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      if (isActive) {
        arrow.textContent = currentDir === 'desc' ? ' \u2193' : ' \u2191';
      } else {
        arrow.textContent = ' \u2191';
      }
      btn.appendChild(arrow);

      btn.addEventListener('click', ((field, active, dir) => () => {
        var newSort;
        if (active) {
          // Toggle direction on the active button.
          newSort = field + ':' + (dir === 'asc' ? 'desc' : 'asc');
        } else if (field === 'linked') {
          // /lugares/ sort convention: the first click on an inactive
          // Documentos button defaults to desc — "most docs first" is the
          // useful first-click direction for a document-count field.
          newSort = 'linked:desc';
        } else {
          // Nombre defaults to asc on first click (alphabetical).
          newSort = field + ':asc';
        }
        this.state.sort = newSort;
        this.state.page = 1;
        this.search();
        this.updateUrl();
      })(opt.field, isActive, currentDir));

      sortWrap.appendChild(btn);
    }
    this.resultsInfoEl.appendChild(sortWrap);
  }

  // ─── Results list ───────────────────────────────────────────────────────────

  renderResults(hits, total) {
    this.resultsListEl.innerHTML = '';

    if (total === 0) {
      var empty = document.createElement('div');
      empty.className = 'search-no-results';
      empty.innerHTML =
        '<p style="font-size:1.1rem;font-weight:500;color:var(--color-stone-600)">' + this.escapeHtml(this._i18n.noResultsTitle) + '</p>' +
        '<p style="color:var(--color-stone-400)">' + this.escapeHtml(this._i18n.noResultsText) + '</p>';
      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'clear-filters-btn';
      clearBtn.style.marginTop = '0.75rem';
      clearBtn.textContent = this._i18n.clearFilters;
      clearBtn.addEventListener('click', () => this.clearFilters());
      empty.appendChild(clearBtn);
      this.resultsListEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < hits.length; i++) {
      var hit = hits[i];
      var item = document.createElement('div');
      item.className = 'result-item';

      var placeName = hit.meta.title || '';
      var placeType = hit.meta.place_type || '';
      var hasCoords = hit.meta.has_coordinates === 'true';
      var linkedCount = parseInt(hit.meta.linked_count || '0', 10);
      var nameVariants = hit.meta.name_variants || '';
      var placeUrl = hit.url;

      // Row 1: name + inline meta
      var row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;align-items:baseline;gap:0.5rem;flex-wrap:wrap';

      var titleLink = document.createElement('a');
      titleLink.href = placeUrl;
      titleLink.className = 'result-title';
      titleLink.textContent = placeName;

      // Wire click: select place in map/card instead of navigating
      titleLink.addEventListener('click', (e) => {
        e.preventDefault();
        var pName = e.currentTarget.textContent;
        var found = this.allPlaces.find(function(p) { return p.display_name === pName; });
        if (found) this.highlightPlace(found);
      });

      row1.appendChild(titleLink);

      var badge = document.createElement('span');
      badge.className = 'level-badge';
      badge.textContent = this.placeTypes[placeType] || placeType;
      row1.appendChild(badge);

      var count = document.createElement('span');
      count.style.cssText = 'font-size:0.85rem;color:var(--color-stone-500)';
      // Both branches are blob-only: associatedTo carries the {count}
      // placeholder (prefixed with the "\u00b7 " separator here); zeroDocs already
      // ships its own leading "\u00b7 " separator. No Spanish fallback.
      count.textContent = linkedCount > 0
        ? '\u00b7 ' + this._i18n.associatedTo
            .replace('{{.}}', linkedCount).replace('{{ . }}', linkedCount).replace('{count}', linkedCount)
        : this._i18n.zeroDocs;
      row1.appendChild(count);

      // Indicators (pushed right)
      var indicators = document.createElement('span');
      indicators.style.cssText = 'display:inline-flex;gap:0.35rem;align-items:center;margin-left:auto';

      if (hasCoords) {
        var pin = document.createElement('span');
        pin.className = 'material-symbols-outlined';
        pin.style.cssText = 'font-size:1.3rem;color:var(--color-burgundy);font-variation-settings:"wght" 200';
        pin.textContent = 'location_on';
        pin.title = this._i18n.coordsTitle;
        indicators.appendChild(pin);
      }

      if (hit.meta.has_authority === 'true') {
        var authBadge = document.createElement('span');
        authBadge.className = 'authority-pill';
        authBadge.style.cssText += 'font-size:0.7rem;padding:2px 6px';
        authBadge.textContent = this._i18n.authorityBadge;
        authBadge.title = this._i18n.authorityTitle;
        indicators.appendChild(authBadge);
      }

      row1.appendChild(indicators);
      item.appendChild(row1);

      // Row 2: name variants (if any)
      if (nameVariants) {
        var variantsList = nameVariants.split(',').map(function(v) { return v.trim(); }).filter(Boolean);
        if (variantsList.length > 0) {
          var variants = document.createElement('div');
          variants.style.cssText = 'font-size:0.8rem;color:var(--color-stone-400);margin-top:0.15rem';
          variants.textContent = variantsList.join(', ');
          item.appendChild(variants);
        }
      }

      this.resultsListEl.appendChild(item);
    }
  }

  // ─── Pagination ─────────────────────────────────────────────────────────────

  renderPagination(total) {
    this.paginationEl.innerHTML = '';
    var totalPages = Math.ceil(total / this.perPage);
    if (totalPages <= 1) return;

    var current = this.state.page;

    var addLink = (label, page, isActive, isEllipsis) => {
      if (isEllipsis) {
        var span = document.createElement('span');
        span.className = 'pagination-ellipsis';
        span.textContent = '\u2026';
        this.paginationEl.appendChild(span);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pagination-link' + (isActive ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.state.page = page;
        this.search();
        this.updateUrl();
        if (this.resultsListEl) this.resultsListEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      this.paginationEl.appendChild(btn);
    };

    var visiblePages = new Set();
    visiblePages.add(1);
    visiblePages.add(totalPages);
    for (var i = Math.max(1, current - 2); i <= Math.min(totalPages, current + 2); i++) {
      visiblePages.add(i);
    }

    var sorted = Array.from(visiblePages).sort(function(a, b) { return a - b; });
    var prev = 0;
    for (var j = 0; j < sorted.length; j++) {
      var p = sorted[j];
      if (p - prev > 1) addLink(null, null, false, true);
      addLink(String(p), p, p === current, false);
      prev = p;
    }
  }

  // ─── Facets ─────────────────────────────────────────────────────────────────

  // Build a `{ facetKey: { value: count } }` object
  // from a Pagefind search result by selecting each cell via the
  // shared `selectFacetCounts` helper. Translates the controller's
  // boolean / array `state` shape into the helper's expected
  // `{ key: [value, ...] }` activeFilters shape:
  //   - place_type: this.state.type is already an array
  //   - has_coordinates: 'true' is the only meaningful active value
  //   - has_authority:   'true' is the only meaningful active value
  // Falls back to globalFilters when Pagefind has not produced any
  // facet payloads yet (early init or explicit empty result).
  _buildScopedFacetCounts(searchResult) {
    var activeFilters = {
      place_type: Array.isArray(this.state.type) ? this.state.type : [],
      has_coordinates: this.state.hasCoords === true ? ['true'] : [],
      has_authority: this.state.hasAuthority === true ? ['true'] : []
    };
    var out = {};
    if (searchResult) {
      var keys = {};
      var srcFilters = searchResult.filters || {};
      var srcTotal = searchResult.totalFilters || {};
      for (var k1 in srcFilters) keys[k1] = true;
      for (var k2 in srcTotal) keys[k2] = true;
      for (var fk in keys) {
        out[fk] = {};
        var values = {};
        var fkF = srcFilters[fk] || {};
        var fkT = srcTotal[fk] || {};
        for (var v1 in fkF) values[v1] = true;
        for (var v2 in fkT) values[v2] = true;
        for (var v in values) {
          out[fk][v] = selectFacetCounts(searchResult, fk, v, activeFilters);
        }
      }
    }
    if (Object.keys(out).length === 0) {
      var gf = this.globalFilters || {};
      for (var gk in gf) out[gk] = gf[gk];
    }
    return out;
  }

  renderFacets(filters) {
    this.facetContainer.innerHTML = '';

    var pfFilters = filters || this.globalFilters;

    // Group 1: place-type facet (this._i18n.facetType)
    var typeGroup = this.makeFacetGroup(this._i18n.facetType, 'type', this.facetGroupState.type);
    var typeContent = typeGroup.querySelector('.facet-group-content');

    var typeCounts = pfFilters.place_type || {};
    for (var key in this.placeTypes) {
      if (!Object.prototype.hasOwnProperty.call(this.placeTypes, key)) continue;
      var label = this.placeTypes[key];
      var count = typeCounts[key] || 0;
      if (count === 0 && !this.state.type.includes(key)) continue;
      var lbl = document.createElement('label');
      lbl.className = 'facet-option';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = key;
      cb.checked = this.state.type.includes(key);
      cb.addEventListener('change', ((k, checkbox) => () => {
        if (checkbox.checked) {
          if (!this.state.type.includes(k)) this.state.type.push(k);
        } else {
          this.state.type = this.state.type.filter(function(t) { return t !== k; });
        }
        this.state.page = 1;
        this.search();
        this.updateUrl();
      })(key, cb));
      lbl.appendChild(cb);
      var txt = document.createElement('span');
      txt.className = 'facet-label-text';
      txt.textContent = label;
      lbl.appendChild(txt);
      var cnt = document.createElement('span');
      cnt.className = 'facet-count';
      cnt.textContent = '(' + this._fmt.format(count) + ')';
      lbl.appendChild(cnt);
      typeContent.appendChild(lbl);
    }
    this.facetContainer.appendChild(typeGroup);

    // Group 2: coordinates facet (this._i18n.facetCoords)
    var coordsGroup = this.makeFacetGroup(this._i18n.facetCoords, 'coords', this.facetGroupState.coords);
    var coordsContent = coordsGroup.querySelector('.facet-group-content');
    var coordsCounts = pfFilters.has_coordinates || {};
    var coordsWithCoords = coordsCounts['true'] || 0;

    var coordsLbl = document.createElement('label');
    coordsLbl.className = 'facet-option';
    var coordsCb = document.createElement('input');
    coordsCb.type = 'checkbox';
    coordsCb.checked = this.state.hasCoords === true;
    coordsCb.addEventListener('change', () => {
      this.state.hasCoords = coordsCb.checked ? true : null;
      this.state.page = 1;
      this.search();
      this.updateUrl();
    });
    coordsLbl.appendChild(coordsCb);
    var coordsTxt = document.createElement('span');
    coordsTxt.className = 'facet-label-text';
    coordsTxt.textContent = this._i18n.facetCoordsOnly;
    coordsLbl.appendChild(coordsTxt);
    var coordsCnt = document.createElement('span');
    coordsCnt.className = 'facet-count';
    coordsCnt.textContent = '(' + this._fmt.format(coordsWithCoords) + ')';
    coordsLbl.appendChild(coordsCnt);
    coordsContent.appendChild(coordsLbl);
    this.facetContainer.appendChild(coordsGroup);

    // Group 3: authorities facet (this._i18n.facetAuthorities)
    var authGroup = this.makeFacetGroup(this._i18n.facetAuthorities, 'authority', this.facetGroupState.authority);
    var authContent = authGroup.querySelector('.facet-group-content');
    var authCounts = pfFilters.has_authority || {};
    var withAuthority = authCounts['true'] || 0;

    var authLbl = document.createElement('label');
    authLbl.className = 'facet-option';
    var authCb = document.createElement('input');
    authCb.type = 'checkbox';
    authCb.checked = this.state.hasAuthority === true;
    authCb.addEventListener('change', () => {
      this.state.hasAuthority = authCb.checked ? true : null;
      this.state.page = 1;
      this.search();
      this.updateUrl();
    });
    authLbl.appendChild(authCb);
    var authTxt = document.createElement('span');
    authTxt.className = 'facet-label-text';
    authTxt.textContent = this._i18n.facetAuthorityOnly;
    authLbl.appendChild(authTxt);
    var authCnt = document.createElement('span');
    authCnt.className = 'facet-count';
    authCnt.textContent = '(' + this._fmt.format(withAuthority) + ')';
    authLbl.appendChild(authCnt);
    authContent.appendChild(authLbl);
    this.facetContainer.appendChild(authGroup);
  }

  makeFacetGroup(title, stateKey, isOpen) {
    var group = document.createElement('div');
    group.className = 'facet-group';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'facet-group-toggle';
    toggle.innerHTML =
      '<span class="facet-group-title">' + this.escapeHtml(title) + '</span>' +
      '<span class="facet-group-indicator">' + (isOpen ? '\u2212' : '+') + '</span>';

    var content = document.createElement('div');
    content.className = 'facet-group-content';
    content.style.display = isOpen ? '' : 'none';

    toggle.addEventListener('click', () => {
      this.facetGroupState[stateKey] = !this.facetGroupState[stateKey];
      var indicator = toggle.querySelector('.facet-group-indicator');
      content.style.display = this.facetGroupState[stateKey] ? '' : 'none';
      indicator.textContent = this.facetGroupState[stateKey] ? '\u2212' : '+';
    });

    group.appendChild(toggle);
    group.appendChild(content);
    return group;
  }

  // ─── Filter pills ───────────────────────────────────────────────────────────

  renderPills() {
    this.pillsEl.innerHTML = '';

    var hasAny = this.state.type.length > 0 ||
      this.state.hasCoords !== null ||
      this.state.hasAuthority !== null;

    // clearBtnEl (sibling of pillsEl, created
    // in buildDOM) is shown/hidden here instead of a freshly created button
    // being appended inside pillsEl. This keeps the "Borrar todos los filtros"
    // button outside the .active-filters flex row so it does not appear as a
    // pill-shaped sibling of the active filter pills.
    if (this.clearBtnEl) {
      this.clearBtnEl.style.display = hasAny ? '' : 'none';
    }

    if (!hasAny) return;

    for (var i = 0; i < this.state.type.length; i++) {
      var t = this.state.type[i];
      var label = this.placeTypes[t] || t;
      this.pillsEl.appendChild(this.makePill(label, ((k) => () => {
        this.state.type = this.state.type.filter(function(x) { return x !== k; });
        this.state.page = 1;
        this.search();
        this.updateUrl();
      })(t)));
    }

    if (this.state.hasCoords !== null) {
      this.pillsEl.appendChild(this.makePill(this._i18n.pillCoords, () => {
        this.state.hasCoords = null;
        this.state.page = 1;
        this.search();
        this.updateUrl();
      }));
    }

    if (this.state.hasAuthority !== null) {
      this.pillsEl.appendChild(this.makePill(this._i18n.pillAuthorities, () => {
        this.state.hasAuthority = null;
        this.state.page = 1;
        this.search();
        this.updateUrl();
      }));
    }
  }

  makePill(label, onRemove) {
    var pill = document.createElement('span');
    pill.className = 'filter-pill';
    pill.textContent = label;
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'filter-pill-remove';
    removeBtn.setAttribute('aria-label', this._i18n.removeFilter.replace('{label}', label));
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', onRemove);
    pill.appendChild(removeBtn);
    return pill;
  }

  clearFilters() {
    this.state.q = '';
    this.state.type = [];
    this.state.hasCoords = null;
    this.state.hasAuthority = null;
    this.state.page = 1;
    if (this.searchInput) this.searchInput.value = '';
    this.search();
    this.updateUrl();
  }

  // ─── Map data update ────────────────────────────────────────────────────────

  updateMap(places) {
    if (!this.mapReady) return;
    var features = places
      .filter(function(p) { return p.latitude != null && p.longitude != null; })
      .map(function(p) {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
          properties: {
            id: p.id,
            display_name: p.display_name,
            place_type: p.place_type,
            linked_description_count: p.linked_description_count
          }
        };
      });
    var source = this.map.getSource('places');
    if (source) {
      source.setData({ type: 'FeatureCollection', features: features });
    }
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Self-invoking init. Wrapped in a `typeof document` guard so the file
// can be loaded under Node/Vitest (which has no DOM) without throwing.
// In the browser `document` is always defined, so the listener still
// binds exactly as before.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    var container = document.getElementById('place-explorer');
    if (container) new PlaceExplorer(container);
  });
}

// Conditional CommonJS export so `selectFacetCounts` can be unit-tested
// from `tests/pagefind-facets.test.js` under Node. The browser loads
// this file as a classic <script>; `typeof module` is undefined there,
// so the block is a no-op. Kept symmetric with the same footer in
// `static/js/search.js` and `static/js/entity-explorer.js`.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selectFacetCounts, buildPivotScopedFiltersPure, PIVOT_KEYS };
}

// Version: v1.3.0
