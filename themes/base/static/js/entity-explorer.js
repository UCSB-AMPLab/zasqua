/**
 * Entity Explorer Controller (`/entidades/`)
 *
 * Drives the entity explorer at `/entidades/`: a Pagefind-powered
 * search over the entities index, a facet sidebar, and bidirectional
 * sync with the bipartite graph that shares the page. Pagefind is a
 * client-side search engine that ships a small WebAssembly bundle
 * plus a JSON index built at build time, so the search runs entirely
 * in the browser with no server round-trip. This file is loaded as
 * a classic `<script>` tag (no ES module imports) and the
 * `EntityExplorer` class is instantiated from the entities listing
 * template so the graph and explorer can coordinate their startup
 * order.
 *
 * Cold-click performance is the feature this file spends the most
 * care on. On a deep-link or a first-click into a facet, Pagefind's
 * WebAssembly runtime takes a noticeable moment to load its filter
 * chunks; rendering the sidebar off `pagefind.filters()` alone meant
 * the user saw stale or empty counts for a couple of seconds after
 * every reload. The explorer therefore also fetches three JSON
 * sidecars emitted by the indexer at build time — a landing-facets
 * file (global counts), a pair-wise pivot file (intersection counts
 * when one facet filter is active), and a triple-wise pivot file
 * (intersection counts when two are active) — and serves the
 * sidebar synchronously from those while Pagefind warms in the
 * background. Once Pagefind's filter cache has warmed, subsequent
 * renders route through it for cross-facet narrowing.
 *
 * `selectFacetCounts` is the canonical helper that picks between
 * Pagefind's `result.filters` (constrained cross-facet counts) and
 * `result.totalFilters` (same-facet OR-group counts and active-
 * value restore counts). It also carries an active-single-value
 * short-circuit: when a single filter value is applied against its
 * own facet, the count returns the result set size rather than
 * querying the filter against itself and returning zero. The helper
 * is copy-pasted across `search.js`, `entity-explorer.js`, and
 * `place-explorer.js` — the three explorer files are loaded as
 * independent classic `<script>` tags, not ES modules, so they
 * cannot share an import. A unit-test suite
 * (`tests/pagefind-facets.test.js`) pins the helper's behaviour
 * across all three copies.
 *
 * Pipeline context:
 *   Build-time inputs: the `/pagefind-entities/` Pagefind bundle
 *   plus `/entidades-facets.json`, `/entidades-pivots.json`, and
 *   `/entidades-triples.json` sidecars, all written alongside the
 *   main Hugo build. Run-time inputs: URL parameters, search and
 *   facet clicks, graph viewport changes. Outputs: DOM updates
 *   inside the explorer host (`#entity-explorer`), the sidebar
 *   facet panel (`#sidebar-facets`), and callbacks the wiring
 *   script forwards to the graph controller (`onEntitySelected`,
 *   `onFilterChanged`, `onFocalRoleFilterChanged`).
 *
 * Every user-facing string is read from the data-i18n blob (single-
 * source, no Spanish fallback); role and role-group display labels
 * come from data-role-labels / data-role-group-labels injected from
 * ui.yaml, so the former triplicated 27-role table is gone.
 * Entity-type labels come from data-entity-types keyed by entity_type
 * code (no branching on display text).
 *
 * @version v1.3.0
 */

/**
 * Pick the correct Pagefind facet count for a given (facetKey, value)
 * pair, given the user's currently active filter selections.
 *
 * Byte-identical to `selectFacetCounts` in `static/js/search.js` and
 * `static/js/place-explorer.js` (the three flat `<script>`-loaded
 * explorer files each carry their own inline copy rather than
 * importing a shared module). Selection rule, missing-value handling,
 * and JSDoc are documented in detail at the canonical site in
 * `static/js/search.js`; see also the five cases in
 * `tests/pagefind-facets.test.js`.
 *
 * The same-facet branch was designed around OR-group siblings — when
 * the user picks two+ values inside a single facet,
 * `totalFilters[key][sibling]`
 *   gives each sibling's true contribution to the union. In the
 *   single-active-value case (exactly one value active for this facet
 *   AND that value is the one being queried), Pagefind's `totalFilters`
 *   entry collapses to 0 because there is no OR-sibling to restore
 *   against — the "restore count" is mathematically the cardinality of
 *   the empty sibling set. That renders as "persona (0)" in the
 *   sidebar when `entity_type=person` is the sole active filter and
 *   41,986 entities match, which is worse than uninformative. For this
 *   degenerate case we return `result.results.length` (the scoped
 *   total) so the active badge reflects the size of the current result
 *   set. Multi-value OR-group behaviour is preserved — only the exact
 *   shape `activeFilters[facetKey] === [value]` takes the short-circuit.
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
  // active-single-value short-circuit. When the queried
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

// 4-key pivot set for /entidades/. Must stay byte-equivalent to
// ENTITY_PIVOT_FACET_KEYS in scripts/generate-pagefind-indices.js —
// the on-disk sidecar shape and the consumer lookup are on the same
// contract. Alphabetical ordering matters because
// buildPivotScopedFiltersPure uses canonical alphabetical ordering
// when walking the triples sidecar for the two-active-dimension
// branch. Mirrors PIVOT_KEYS in static/js/search.js with a different
// binding (6 keys for /buscar/, 4 keys here).
const PIVOT_KEYS = ['century', 'decade', 'entity_type', 'primary_function'];

/**
 * Pure helper that computes a scoped filters object from the pivot /
 * triple sidecars, given a set of active filter dimensions and the
 * global facet counts. Extracted from the class method so
 * tests/pagefind-facets.test.js can exercise the full dispatch
 * (0, 1, 2, >=3 active dims) without constructing an EntityExplorer
 * instance.
 *
 * Body is byte-equivalent to the same helper in static/js/search.js
 * except that it closes over this file's local PIVOT_KEYS (4 keys,
 * alphabetical) instead of search.js's 6-key constant — the function
 * body text itself references PIVOT_KEYS by name so the same source is
 * portable with the different constant bound.
 *
 * @param {object} args
 * @param {object} args.activeByKey  Map of active pivot dim →
 *                                    non-empty array of active values
 *                                    (e.g. { entity_type: ['person'],
 *                                    century: ['XIX'] }).
 *                                    Keys outside PIVOT_KEYS are
 *                                    ignored.
 * @param {object|null} args.pivots       Pair-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object|null} args.triples      Triple-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object} args.globalFilters     Global facet counts — used for
 *                                        the active-key pass-through
 *                                        and the year passthrough.
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
    // Year passthrough — not in the pivot sidecar.
    if (globalFilters.year) scoped.year = globalFilters.year;
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
  // Year passthrough.
  if (globalFilters.year) scoped.year = globalFilters.year;
  return scoped;
}

// Role display labels are no longer hardcoded here: they are single-
// sourced from ui.yaml and injected via data-role-labels, read into
// this._roleLabels in the constructor. This kills the former
// triplication across entity.js / entity-explorer.js / infinite-
// bipartite-explorer.js.

// Entity colours shared with entity.js and infinite-bipartite-explorer.js
var entityColors = {
  person: '#8B2942',
  corporate_body: '#6666BB',
  corporate: '#6666BB',
  family: '#6666BB'
};

// Documentary-role taxonomy.
// Spanish primary, English secondary. Members are the canonical lowercase
// enum values stored in DescriptionEntity.role. Some values (fiador,
// apoderado, editor, photographer, artist) are not in the live data yet —
// they will land with a future import. Groups with zero hits in the
// focal entity's shard are hidden in the UI.
// Display labels for each group are NOT stored here — they are single-
// sourced from ui.yaml roleGroups and read via this._roleGroupLabels,
// keyed by the group `id` below. Only the grouping LOGIC (which role
// belongs to which family) lives in JS.
var roleGroups = [
  {
    id: 'production',
    members: ['creator', 'author', 'editor', 'publisher', 'mentioned', 'subject', 'official']
  },
  {
    id: 'correspondence',
    members: ['sender', 'recipient']
  },
  {
    id: 'notarial',
    members: ['scribe', 'witness', 'notary']
  },
  {
    id: 'legal',
    members: ['plaintiff', 'defendant', 'petitioner', 'judge', 'appellant', 'fiador', 'apoderado', 'victim']
  },
  {
    id: 'family',
    members: ['heir', 'albacea', 'spouse']
  },
  {
    id: 'transactions',
    members: ['grantor', 'donor', 'seller', 'buyer', 'mortgagor', 'mortgagee', 'creditor', 'debtor']
  },
  {
    id: 'visual',
    members: ['photographer', 'artist']
  }
];

class EntityExplorer {
  constructor(container) {
    this.container = container;
    this.pagefind = null;
    this.globalFilters = null;
    // pivot + triple sidecars, fetched in init via
    // Promise.allSettled. Null until the fetches resolve; null-safe
    // downstream because buildPivotScopedFiltersPure returns null when
    // either sidecar is absent, and the caller falls back to the
    // overload behaviour.
    this.pivots = null;
    this.triples = null;
    this.perPage = 20;

    // Locale-aware formatters (read from <html lang>; fallback es-CO)
    const _locale = document.documentElement.lang || 'es-CO';
    this._locale = _locale;
    this._fmt  = new Intl.NumberFormat(_locale);
    this._coll = new Intl.Collator(_locale);
    // CLDR plural selector for {one, other} blob sub-tables.
    this._pr   = new Intl.PluralRules(_locale.split('-')[0]);

    // App-label strings from data-i18n blob injected by the template
    this._i18n = {};
    try {
      this._i18n = JSON.parse(container.dataset.i18n || '{}');
    } catch (e) {
      console.warn('EntityExplorer: could not parse data-i18n');
    }

    this.entityTypeLabels = {};
    try {
      this.entityTypeLabels = JSON.parse(container.dataset.entityTypes || '{}');
    } catch (e) {
      console.warn('EntityExplorer: could not parse data-entity-types');
    }

    // Role + role-group display labels, single-sourced from ui.yaml via
    // data-role-labels / data-role-group-labels. Only the display
    // strings live in the data — the role→group mapping logic stays in JS
    // (the module-level roleGroups[].members arrays). _roleLabels is keyed
    // by role code; _roleGroupLabels is keyed by the English group IDs the
    // roleGroups taxonomy below already uses (production, correspondence, …).
    this._roleLabels = {};
    try {
      this._roleLabels = JSON.parse(container.dataset.roleLabels || '{}');
    } catch (e) {
      console.warn('EntityExplorer: could not parse data-role-labels');
    }

    this._roleGroupLabels = {};
    try {
      this._roleGroupLabels = JSON.parse(container.dataset.roleGroupLabels || '{}');
    } catch (e) {
      console.warn('EntityExplorer: could not parse data-role-group-labels');
    }

    this.state = {
      q: '',
      entity_type: [],
      primary_function: [],
      dateFilter: null,  // { level: 'century'|'decade'|'year', label, years: string[] }
      sort: '',
      page: 1
    };

    // Focal-card role filter — scoped to the currently selected entity's
    // documents. Lives on the right-column card (not the left sidebar)
    // because role is a per-document relationship, not an entity property.
    // Reset whenever the focal entity changes.
    this.focalRoleFilter = new Set();
    this.focalShard = [];

    // Viewport filter — when true, render the result list directly from
    // the in-memory graph nodes whose data is currently visible in the
    // canvas viewport. We bypass Pagefind because an unfiltered query on
    // the 92k entity index would block the WASM thread for tens of
    // seconds. The host wires _visibleEntitiesSource (and the
    // lower-level _visibleCodeSource for post-filtering with other
    // facets) so the explorer doesn't need a direct reference to the
    // graph instance.
    this.viewportFilter = false;
    this._visibleCodeSource = null;
    this._visibleEntitiesSource = null;

    // Callback hooks — set by wiring script in entidades.njk
    this.onEntitySelected = null;  // (entityCode) — fired when user clicks entity in results
    this.onFilterChanged = null;   // (filters) — fired when any filter/search changes
    this.onFocalRoleFilterChanged = null;  // (Set<role>) — focal-card role filter changed

    this.facetGroupState = { entity_type: true, primary_function: true, date: true };
    // Compact mode: when facets are rendered separately into #sidebar-facets,
    // suppress the inline facet column in render() to avoid duplication.
    // The `typeof document` guard lets the file load under Node/Vitest
    // (no DOM) when `tests/pagefind-facets.test.js` requires it for the
    // helper export. In the browser `document` is always defined.
    this.compactMode = typeof document !== 'undefined' && !!document.getElementById('sidebar-facets');
    // Note: init() is called explicitly by the wiring script (entidades.njk) to control
    // initialization order. Do not call this.init() here.
  }

  async init() {
    this.parseUrlParams();

    try {
      this.pagefind = await import('/pagefind-entities/pagefind.js');
      await this.pagefind.options({ basePath: '/pagefind-entities/' });
      await this.pagefind.init();
    } catch (e) {
      console.error('EntityExplorer: failed to load Pagefind:', e);
      this.showError();
      return;
    }

    // Parallel-fetch both pivot sidecars. There is no
    // /entidades-facets.json equivalent — two branches, not three.
    // Non-fatal on either fetch failure: the consumer returns null and
    // the caller falls back to the overload behaviour. Both sidecars are
    // small (~30 KB gzipped each) and served same-origin with
    // `force-cache` — typical total added latency: single-digit to
    // low-double-digit ms warm.
    const [pivotsRes, triplesRes] = await Promise.allSettled([
      fetch('/entidades-pivots.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      fetch('/entidades-triples.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    ]);
    this.pivots = pivotsRes.status === 'fulfilled' ? pivotsRes.value : null;
    if (pivotsRes.status === 'rejected') {
      console.warn('Failed to load /entidades-pivots.json; falling back to global counts on cold first-click.', pivotsRes.reason);
    }
    this.triples = triplesRes.status === 'fulfilled' ? triplesRes.value : null;
    if (triplesRes.status === 'rejected') {
      console.warn('Failed to load /entidades-triples.json; falling back to global counts on cold first-click.', triplesRes.reason);
    }

    // Move pagefind.filters() off the init critical path. Fire-and-forget
    // with a swallowed .catch — failures surface on the first user action
    // that reads globalFilters. Until the chain resolves, globalFilters
    // stays null and every synchronous read site falls back to safe
    // defaults via inline null-guards (the invariant is mechanically
    // checkable by grep alone). The pivot sidecar consumer (above) drives
    // sidebar counts from this.pivots / this.triples during the pre-warm
    // window so cold first-click cross-facet counts land without waiting
    // on filters().
    this.pagefind.filters()
      .then(gf => {
        this.globalFilters = gf;
        // Landing-render rescue: on cold no-filter landing, init's
        // first `search()` ran before globalFilters was populated and
        // rendered an empty sidebar + empty `.browse-prompt-count`. The
        // pivot sidecar consumer only applies when at least one filter
        // is active, so the landing state has no independent data
        // source. Re-trigger the landing render chain here when the
        // sidebar is still empty; active-filter paths (pivot-scoped or
        // overload fallback) paint their own sidebar and this guard
        // skips them. `onReady` is re-called because `search()` does
        // not touch `#entity-count-live` — that DOM slot is owned by
        // the wiring-script's `onReady`, whose initial call in init
        // fell through the `t > 0` guard while globalFilters was null.
        const sb = document.getElementById('sidebar-facets');
        if (sb && sb.childElementCount === 0) {
          this.search();
          if (typeof this.onReady === 'function') this.onReady();
        }
      })
      .catch(() => { /* swallowed; surfaces on first user action */ });

    // Render sidebar facets (entity type, role, date) and the search input
    // into their dedicated containers
    this.renderSidebarFacets(document.getElementById('sidebar-facets'));
    if (typeof this.onReady === 'function') this.onReady();
    const searchInputContainer = document.getElementById('entity-search-input');
    if (searchInputContainer) {
      searchInputContainer.innerHTML = '';
      searchInputContainer.appendChild(this.renderSearchInput());
    }

    window.addEventListener('popstate', () => {
      this.parseUrlParams();
      this.search();
    });

    this.search();
  }

  // --- URL state ---

  parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    this.state.q = params.get('q') || '';
    this.state.entity_type = params.getAll('tipo');
    this.state.primary_function = params.getAll('funcion');
    this.state.sort = params.get('orden') || '';
    this.state.page = parseInt(params.get('pagina'), 10) || 1;

    // Date drill-down: one active at a time
    this.state.dateFilter = null;
    const fechaNivel = params.get('fecha_nivel');
    const fechaValor = params.get('fecha_valor');
    if (fechaNivel && fechaValor) {
      if (fechaNivel === 'year') {
        this.state.dateFilter = { level: 'year', label: fechaValor, years: [fechaValor] };
      } else if (fechaNivel === 'decade') {
        const base = parseInt(fechaValor, 10);
        const years = [];
        for (let i = base; i < base + 10; i++) years.push(String(i));
        this.state.dateFilter = { level: 'decade', label: `${fechaValor}s`, years };
      } else if (fechaNivel === 'century') {
        const num = parseInt(fechaValor, 10);
        const base = (num - 1) * 100;
        const years = [];
        for (let i = base; i < base + 100; i++) years.push(String(i));
        this.state.dateFilter = { level: 'century', label: this._i18n.centuryLabel.replace('{roman}', this.romanCentury(num)), years };
      }
    }
  }

  updateUrl() {
    const params = new URLSearchParams();
    if (this.state.q) params.set('q', this.state.q);
    for (const t of this.state.entity_type) params.append('tipo', t);
    for (const f of this.state.primary_function) params.append('funcion', f);
    if (this.state.sort) params.set('orden', this.state.sort);
    if (this.state.page > 1) params.set('pagina', this.state.page);

    if (this.state.dateFilter) {
      const df = this.state.dateFilter;
      if (df.level === 'year') {
        params.set('fecha_nivel', 'year');
        params.set('fecha_valor', df.years[0]);
      } else if (df.level === 'decade') {
        params.set('fecha_nivel', 'decade');
        params.set('fecha_valor', df.years[0]);
      } else if (df.level === 'century') {
        const firstYear = parseInt(df.years[0], 10);
        const centuryNum = Math.floor(firstYear / 100) + 1;
        params.set('fecha_nivel', 'century');
        params.set('fecha_valor', String(centuryNum));
      }
    }

    const qs = params.toString();
    const url = qs ? `/entidades/?${qs}` : '/entidades/';
    history.pushState(null, '', url);
  }

  // --- Search ---

  async search() {
    if (!this.pagefind) return;

    const hasActiveFilters = this.state.entity_type.length > 0 ||
      this.state.primary_function.length > 0 ||
      this.state.dateFilter !== null ||
      this.viewportFilter;

    const isPreSearch = !this.state.q && !hasActiveFilters && !this.state.sort;

    this.showLoading();
    // Yield once so the spinner can paint before any WASM blocks. Use
    // setTimeout instead of requestAnimationFrame: rAF is paused in hidden
    // tabs (e.g. when the user opens /entidades/ in a background tab and
    // switches to it later), which would otherwise leave the explorer
    // permanently stuck on the loading spinner.
    await new Promise(r => setTimeout(r, 0));

    try {
      if (isPreSearch) {
        // Reset left-sidebar facets to global counts — the user has cleared
        // all filters, so other options should reappear at their full counts.
        const sidebarFacetsEl = document.getElementById('sidebar-facets');
        // Null-guard: globalFilters may be null during the pre-warm
        // window (filters() now resolves async).
        if (sidebarFacetsEl) this.renderSidebarFacets(sidebarFacetsEl, this.globalFilters || {});

        // Show browse prompt with total entity count
        const totalCount = this.getTotalEntityCount();
        this.renderSearchResults({
          hits: [],
          filters: this.globalFilters || {},
          total: 0,
          page: 1,
          total_pages: 0,
          query: '',
          browsePrompt: true,
          browsePromptMode: 'landing',
          totalEntityCount: totalCount
        });
        return;
      }

      // Filter-only with too many results: skip the slow Pagefind scan
      // and show the same warning prompt as description-search.
      // Viewport-only mode bypasses Pagefind entirely (synthesises hits
      // from in-memory graph nodes), so the threshold doesn't apply there.
      const onlyViewportActive = this.viewportFilter
        && this.state.entity_type.length === 0
        && this.state.primary_function.length === 0
        && this.state.dateFilter === null;
      if (!this.state.q && hasActiveFilters && !this.skipBrowsePrompt && !onlyViewportActive) {
        const estimated = this.estimateFilterCount();
        if (estimated > 10000) {
          // When the pivot / triple sidecars are loaded AND the current
          // active-dimension count is 1 or 2, render the SIDEBAR from
          // pre-computed cross-facet intersection counts immediately —
          // no WASM wait. The MAIN-PANE total is DEFERRED until the
          // Pagefind overload search resolves, so the sidebar and
          // main-pane can never contradict each other. No placeholder /
          // approximate / derived total is displayed while Pagefind is
          // in flight: summing pivot values for a main-pane total is
          // infeasible for multi-value filter fields (records can carry
          // multiple values per entity), so we show a pending state in
          // the main pane instead.

          // Shared pfOverload construction — both branches pass the
          // same Pagefind arguments so they stay observationally
          // equivalent.
          const pfOverload = {};
          if (this.state.entity_type.length) pfOverload.entity_type = { any: this.state.entity_type };
          if (this.state.primary_function.length) pfOverload.primary_function = { any: this.state.primary_function };
          if (this.state.dateFilter && this.state.dateFilter.years.length) {
            pfOverload.year = { any: this.state.dateFilter.years };
          }
          const pfOverloadArg = Object.keys(pfOverload).length ? pfOverload : undefined;

          const pivotScoped = this.buildPivotScopedFilters();
          if (pivotScoped) {
            // Pivot-scoped branch: sidebar paints synchronously from
            // pivots/triples; main-pane shows overload-pending with
            // total: null so the two panes cannot contradict.
            const sidebarEl = document.getElementById('sidebar-facets');
            if (sidebarEl) this.renderSidebarFacets(sidebarEl, pivotScoped);
            this.renderSearchResults({
              hits: [],
              filters: pivotScoped,
              total: null,
              page: 1,
              total_pages: 0,
              query: '',
              browsePrompt: true,
              browsePromptMode: 'overload-pending'
            });
            // Fire-and-forget Pagefind overload. When it lands, re-
            // render sidebar AND main-pane with authoritative
            // scopedOverloadFilters + overloadSearch.results.length +
            // browsePromptMode: 'overload'. On .catch, leave the
            // pivot-scoped sidebar in place and keep the main-pane in
            // pending state; the user's next action recovers.
            this.pagefind.search(this.state.q || null, {
              filters: pfOverloadArg
            }).then(overloadSearch => {
              const scopedOverloadFilters = this._buildScopedFacetCounts(overloadSearch);
              const el = document.getElementById('sidebar-facets');
              if (el) this.renderSidebarFacets(el, scopedOverloadFilters);
              this.renderSearchResults({
                hits: [],
                filters: scopedOverloadFilters,
                total: overloadSearch.results.length,
                page: 1,
                total_pages: 0,
                query: '',
                browsePrompt: true,
                browsePromptMode: 'overload'
              });
            }).catch(() => {
              // Pagefind failure during the refine chain: keep the
              // pivot-scoped sidebar and the overload-pending main
              // pane. Surfaces on the user's next action.
            });
            return;
          }

          // Fallback path — no pivot-scoped render available (sidecars
          // absent, 0 or 3+ active pivot dims). Await Pagefind, then
          // render sidebar + main-pane together from the authoritative
          // overloadSearch result.
          const overloadSearch = await this.pagefind.search(this.state.q || null, {
            filters: pfOverloadArg
          });
          const scopedOverloadFilters = this._buildScopedFacetCounts(overloadSearch);
          const sidebarEl = document.getElementById('sidebar-facets');
          if (sidebarEl) this.renderSidebarFacets(sidebarEl, scopedOverloadFilters);
          this.renderSearchResults({
            hits: [],
            filters: scopedOverloadFilters,
            total: overloadSearch.results.length,
            page: 1,
            total_pages: 0,
            query: '',
            browsePrompt: true,
            browsePromptMode: 'overload'
          });
          return;
        }
      }

      // Reset the override so future filter changes re-evaluate the threshold
      this.skipBrowsePrompt = false;

      // Resolve dateFilter years against actual index.
      // Null-guard: if globalFilters hasn't warmed yet, skip the
      // filter-against-index narrowing. dateFilter.years
      // was already populated from URL parsing; leaving it unfiltered
      // during the pre-warm window is safe (Pagefind itself will drop
      // unknown years at query time).
      if (this.state.dateFilter && this.globalFilters && this.globalFilters.year) {
        const indexYears = new Set(Object.keys((this.globalFilters || {}).year || {}));
        this.state.dateFilter.years = this.state.dateFilter.years.filter(y => indexYears.has(y));
      }

      // Build Pagefind filters
      const pfFilters = {};
      if (this.state.entity_type.length) pfFilters.entity_type = { any: this.state.entity_type };
      if (this.state.primary_function.length) pfFilters.primary_function = { any: this.state.primary_function };
      if (this.state.dateFilter && this.state.dateFilter.years.length) {
        pfFilters.year = { any: this.state.dateFilter.years };
      }

      // Build Pagefind sort. Apply the count:desc default only for real
      // searches — never on initial load (the pre-search guard above already
      // short-circuited that case). Sorting the full 92k index in WASM blocks
      // the main thread for 30+ seconds, so we only pay that cost when the
      // user has actually narrowed the result set with a query or filter.
      const effectiveSort = this.state.sort || 'count:desc';
      const [sortField, sortDir] = effectiveSort.split(':');
      const pfSort = { [sortField]: sortDir };

      // Viewport-only fast path: when the user has no other filters active
      // and the viewport toggle is on, render result cards directly from
      // the in-memory graph node data instead of going through Pagefind. A
      // null/null Pagefind search on the 92k entity index blocks the WASM
      // thread for tens of seconds; the visible viewport is at most ~100
      // entities, so we just synthesise hit objects from getVisibleEntities.
      const viewportOnly = this.viewportFilter && Object.keys(pfFilters).length === 0 && !this.state.q;
      let search;
      let allResults;
      if (viewportOnly) {
        const visible = (typeof this._visibleEntitiesSource === 'function')
          ? (this._visibleEntitiesSource() || [])
          : [];
        // Sort client-side per current sort selection (default count desc).
        const sortKey = (this.state.sort || 'count:desc').split(':');
        visible.sort((a, b) => {
          if (sortKey[0] === 'name') {
            return this._coll.compare(a.label || '', b.label || '') * (sortKey[1] === 'desc' ? -1 : 1);
          }
          if (sortKey[0] === 'date') {
            return ((a.date_earliest || '') < (b.date_earliest || '') ? -1 : 1) * (sortKey[1] === 'desc' ? -1 : 1);
          }
          // count:desc default
          return (b.linked_count || 0) - (a.linked_count || 0);
        });
        // Synthesise Pagefind-style hit objects so renderResultCard works.
        allResults = visible.map(e => ({
          url: `/${e.entity_code}/`,
          data: () => Promise.resolve({
            url: `/${e.entity_code}/`,
            meta: {
              title: e.label,
              entity_type: e.entity_type,
              linked_count: String(e.linked_count || 0),
              date_earliest: e.date_earliest || '',
              date_latest: e.date_latest || ''
            }
          })
        }));
        // Compute scoped facet counts from the visible entities so the
        // left sidebar facets narrow to reflect what's actually in the
        // graph viewport (and empty facet groups disappear).
        const scopedFacets = { entity_type: {}, primary_function: {}, year: {}, century: {}, decade: {} };
        for (const e of visible) {
          if (e.entity_type) {
            scopedFacets.entity_type[e.entity_type] = (scopedFacets.entity_type[e.entity_type] || 0) + 1;
          }
          if (e.primary_function) {
            scopedFacets.primary_function[e.primary_function] = (scopedFacets.primary_function[e.primary_function] || 0) + 1;
          }
          // Year coverage: contribute the entity once per year in its lifespan
          const yEarly = parseInt(e.date_earliest, 10);
          const yLate = parseInt(e.date_latest, 10);
          if (!Number.isNaN(yEarly) && !Number.isNaN(yLate) && yEarly <= yLate && yLate - yEarly < 200) {
            const seenCenturies = new Set();
            const seenDecades = new Set();
            for (let y = yEarly; y <= yLate; y++) {
              const ys = String(y);
              scopedFacets.year[ys] = (scopedFacets.year[ys] || 0) + 1;
              const c = String(Math.floor((y - 1) / 100) + 1);
              const d = String(Math.floor(y / 10) * 10);
              if (!seenCenturies.has(c)) {
                seenCenturies.add(c);
                scopedFacets.century[c] = (scopedFacets.century[c] || 0) + 1;
              }
              if (!seenDecades.has(d)) {
                seenDecades.add(d);
                scopedFacets.decade[d] = (scopedFacets.decade[d] || 0) + 1;
              }
            }
          }
        }
        search = { results: allResults, filters: scopedFacets };
      } else {
        search = await this.pagefind.search(this.state.q || null, {
          filters: Object.keys(pfFilters).length ? pfFilters : undefined,
          sort: pfSort
        });
        allResults = search.results;
        // Combine viewport with other filters: post-filter by visible code set.
        if (this.viewportFilter && typeof this._visibleCodeSource === 'function') {
          const visibleCodes = this._visibleCodeSource() || new Set();
          allResults = search.results.filter(r => {
            const m = (r.url || '').match(/\/(ne-[^/]+)\//);
            return m && visibleCodes.has(m[1]);
          });
        }
      }

      const total = allResults.length;
      const totalPages = Math.ceil(total / this.perPage);
      const start = (this.state.page - 1) * this.perPage;
      const pageResults = allResults.slice(start, start + this.perPage);
      const hits = await Promise.all(pageResults.map(r => r.data()));

      // Per-value lookups via selectFacetCounts. Shape is
      // `{ facetKey: { value: count } }` so renderSidebarFacets /
      // renderFacetGroup stay untouched, but each cell now respects the
      // filters / totalFilters split.
      const scopedFilters = this._buildScopedFacetCounts(search);

      // Re-render the left-sidebar facets with scoped counts so other
      // filter options narrow to reflect what's still reachable.
      const sidebarFacetsEl = document.getElementById('sidebar-facets');
      if (sidebarFacetsEl) this.renderSidebarFacets(sidebarFacetsEl, scopedFilters);

      this.renderSearchResults({
        hits,
        filters: scopedFilters,
        total,
        page: this.state.page,
        total_pages: totalPages,
        query: this.state.q
      });

      // Fire the filter callback so the graph stays in sync.
      if (this.onFilterChanged) {
        this.onFilterChanged({
          entityTypes: new Set(this.state.entity_type),
          functions: new Set(this.state.primary_function),
          searchQuery: this.state.q
        });
      }
    } catch (error) {
      console.error('EntityExplorer: search error:', error);
      this.showError();
    }
  }

  getTotalEntityCount() {
    // Null-guard: filters() now warms async, so globalFilters may be
    // null during the pre-warm window. Read through a local that folds
    // nullish to {} so every downstream facet access is null-safe.
    const gf = this.globalFilters || {};
    // Sum counts from entity_type filter as proxy for total entity count
    if (gf.entity_type) {
      return Object.values(gf.entity_type).reduce((a, b) => a + b, 0);
    }
    return 0;
  }

  // Estimate the result-set size for a filter-only query by summing the
  // global facet counts of each active filter and taking the smallest
  // (intersection upper bound). Mirrors search.js#estimateFilterCount.
  estimateFilterCount() {
    // Null-guard: read through a local that is always non-null so
    // every subsequent facet access is safe.
    const gf = this.globalFilters || {};
    const counts = [];

    if (this.state.entity_type.length && gf.entity_type) {
      let sum = 0;
      for (const v of this.state.entity_type) {
        sum += gf.entity_type[v] || 0;
      }
      counts.push(sum);
    }

    if (this.state.primary_function.length && gf.primary_function) {
      let sum = 0;
      for (const v of this.state.primary_function) {
        sum += gf.primary_function[v] || 0;
      }
      counts.push(sum);
    }

    if (this.state.dateFilter && this.state.dateFilter.years && gf.year) {
      let sum = 0;
      for (const y of this.state.dateFilter.years) {
        sum += gf.year[y] || 0;
      }
      counts.push(sum);
    }

    if (counts.length === 0) return this.getTotalEntityCount();
    return Math.min.apply(null, counts);
  }

  // --- Rendering ---

  renderSearchResults(data) {
    this._lastRenderData = data;
    this.container.innerHTML = '';

    const layout = document.createElement('div');
    layout.className = 'search-layout';

    // Results column
    const resultsCol = document.createElement('div');
    resultsCol.className = 'search-results';
    resultsCol.setAttribute('aria-live', 'polite');

    // Mobile filter toggle
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'mobile-filter-toggle';
    mobileToggle.type = 'button';
    mobileToggle.innerHTML = this.escapeHtml(this._i18n.filterToggle) + ' <span class="toggle-chevron">&#9660;</span>';
    mobileToggle.addEventListener('click', () => {
      const sidebar = this.container.querySelector('.search-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('sidebar-open');
        mobileToggle.classList.toggle('toggle-open');
      }
    });
    resultsCol.appendChild(mobileToggle);

    // Browse prompt — three modes:
    //   landing          → no query, no filters (initial pre-search state)
    //   overload         → filter-only with too many results to scan via Pagefind
    //   overload-pending → pivot-scoped sidebar rendered; main-pane total
    //                      awaiting Pagefind overload .then() resolution.
    //                      The pending state carries NO numeric total — we
    //                      render "Calculando total\u2026" instead so
    //                      the sidebar and main-pane cannot contradict
    //                      each other during the in-flight window.
    // All three share the same visual treatment (count/placeholder + hint +
    // button + warning) matching the description-search overload prompt
    // for consistency.
    if (data.browsePrompt) {
      const mode = data.browsePromptMode || 'landing';
      const isOverloadMode = (mode === 'overload' || mode === 'overload-pending');

      // Active filter pills (only relevant in overload modes)
      if (isOverloadMode) {
        const pills = this.renderPills();
        if (pills) resultsCol.appendChild(pills);
      }

      const prompt = document.createElement('div');
      prompt.className = 'search-browse-prompt';

      const countText = document.createElement('p');
      countText.className = 'browse-prompt-count';
      if (mode === 'overload-pending') {
        // pending-state: no numeric total. The blob copy signals that it
        // is the total, not the whole view, that is pending.
        countText.innerHTML = this.escapeHtml(this._i18n.calculatingTotal);
      } else if (mode === 'overload') {
        countText.innerHTML = this._i18n.overloadCount.replace(
          '{count}', `<strong>${this._fmt.format(Number(data.total))}</strong>`);
      } else {
        const totalCount = data.totalEntityCount || 0;
        countText.innerHTML = totalCount > 0
          ? this._i18n.landingCount.replace(
              '{count}', `<strong>${this._fmt.format(totalCount)}</strong>`)
          : '';
      }
      prompt.appendChild(countText);

      const hint = document.createElement('p');
      hint.className = 'browse-prompt-hint';
      hint.textContent = isOverloadMode
        ? this._i18n.overloadHint
        : this._i18n.landingHint;
      prompt.appendChild(hint);

      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'browse-prompt-btn';
      continueBtn.textContent = isOverloadMode
        ? this._i18n.viewAll
        : this._i18n.exploreAll;
      continueBtn.addEventListener('click', async () => {
        if (isOverloadMode) {
          // Force the next search to bypass the threshold guard
          this.skipBrowsePrompt = true;
          this.search();
          return;
        }
        // Landing mode: clear state and run a full search
        this.state.q = '';
        this.state.entity_type = [];
        this.state.primary_function = [];
        this.state.dateFilter = null;
        this.state.page = 1;
        this.updateUrl();

        this.showLoading();
        await new Promise(r => setTimeout(r, 0));
        try {
          const search = await this.pagefind.search(null);
          const total = search.results.length;
          const totalPages = Math.ceil(total / this.perPage);
          const pageResults = search.results.slice(0, this.perPage);
          const hits = await Promise.all(pageResults.map(r => r.data()));
          this.renderSearchResults({
            hits,
            filters: search.filters || (this.globalFilters || {}),
            total,
            page: 1,
            total_pages: totalPages,
            query: ''
          });
        } catch (e) {
          console.error('EntityExplorer: explore all error:', e);
          this.showError();
        }
      });
      prompt.appendChild(continueBtn);

      const warning = document.createElement('p');
      warning.className = 'browse-prompt-warning';
      warning.textContent = this._i18n.browsePromptWarning;
      prompt.appendChild(warning);

      resultsCol.appendChild(prompt);

      if (!this.compactMode) {
        const sidebar = this.renderFacets(data);
        layout.appendChild(sidebar);
      }
      layout.appendChild(resultsCol);
      this.container.appendChild(layout);
      return;
    }

    // Results info bar (count + sort)
    resultsCol.appendChild(this.renderResultsInfo(data));

    // Active filter pills
    const pills = this.renderPills();
    if (pills) resultsCol.appendChild(pills);

    // (Search input lives in the left filter sidebar — see init().)

    // Result items or empty state
    if (data.hits.length === 0) {
      resultsCol.appendChild(this.renderNoResults());
    } else {
      const resultsList = document.createElement('div');
      resultsList.className = 'search-results-list';
      for (const hit of data.hits) {
        resultsList.appendChild(this.renderResultCard(hit, data.query));
      }
      resultsCol.appendChild(resultsList);
    }

    // Pagination
    if (data.total_pages > 1) {
      resultsCol.appendChild(this.renderPagination(data));
    }

    // Sidebar (suppressed in compact mode — facets render into #sidebar-facets)
    if (!this.compactMode) {
      const sidebar = this.renderFacets(data);
      layout.appendChild(sidebar);
    }
    layout.appendChild(resultsCol);

    this.container.appendChild(layout);
  }

  renderSearchInput() {
    // Use the same .refine-search styling as the descriptions explorer
    // (rounded pill, stone-50 bg, burgundy focus border).
    const wrap = document.createElement('div');
    wrap.className = 'refine-search';

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = this._i18n.searchPlaceholder;
    input.value = this.state.q;
    input.setAttribute('aria-label', this._i18n.searchAria);

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.state.q = input.value.trim();
        this.state.page = 1;
        this.updateUrl();
        this.search();
      }, 300);
    });

    wrap.appendChild(input);
    return wrap;
  }

  renderResultCard(hit) {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    // Clicking an entity in the index loads it in the graph.
    item.style.cursor = 'pointer';
    item.addEventListener('click', (e) => {
      // Extract entity code from the result URL (pattern: /{code}/)
      const match = (hit.url || '').match(/\/(ne-[^/]+)\//);
      if (match && match[1] && this.onEntitySelected) {
        e.preventDefault();
        this.onEntitySelected(match[1]);
      }
    });

    // Row 1: title + type badge + date range
    const row1 = document.createElement('div');
    row1.style.cssText = 'display:flex; flex-wrap:wrap; align-items:baseline; gap:0.5rem;';

    const title = document.createElement('h3');
    title.className = 'result-title';
    title.style.margin = '0';
    const link = document.createElement('a');
    link.href = hit.url;
    link.textContent = hit.meta.title || '';
    // Allow normal link navigation when onEntitySelected is not wired
    link.addEventListener('click', (e) => {
      if (this.onEntitySelected) e.stopPropagation();
    });
    title.appendChild(link);
    row1.appendChild(title);

    // Entity type badge
    const entityType = hit.meta.entity_type || '';
    if (entityType) {
      const badge = document.createElement('span');
      badge.className = 'entity-type-badge entity-type-badge--' + (
        entityType === 'person' ? 'person'
        : (entityType === 'corporate_body' || entityType === 'corporate') ? 'corporate'
        : entityType === 'family' ? 'family'
        : 'unknown'
      );
      badge.textContent = this.entityTypeLabels[entityType] || entityType;
      row1.appendChild(badge);
    }

    // Date range
    const dateEarliest = hit.meta.date_earliest || '';
    const dateLatest = hit.meta.date_latest || '';
    if (dateEarliest) {
      const dateMeta = document.createElement('span');
      dateMeta.className = 'result-meta';
      dateMeta.style.fontSize = '0.875rem';
      if (dateLatest && dateLatest !== dateEarliest) {
        dateMeta.textContent = `${dateEarliest}\u2013${dateLatest}`;
      } else {
        dateMeta.textContent = dateEarliest;
      }
      row1.appendChild(dateMeta);
    }

    item.appendChild(row1);

    // Row 2: primary function + doc count
    const primaryFunction = hit.meta.primary_function || '';
    const linkedCountRaw = hit.meta.linked_count || hit.meta.count || '';
    const linkedCount = parseInt(linkedCountRaw, 10) || 0;

    if (primaryFunction || linkedCount > 0) {
      const row2 = document.createElement('div');
      row2.style.marginTop = '2px';

      if (primaryFunction) {
        const funcSpan = document.createElement('span');
        funcSpan.className = 'entity-result-function';
        funcSpan.textContent = primaryFunction;
        row2.appendChild(funcSpan);
      }

      if (primaryFunction && linkedCount > 0) {
        row2.appendChild(document.createTextNode(' \u00B7 '));
      }

      if (linkedCount > 0) {
        const countSpan = document.createElement('span');
        countSpan.className = 'entity-result-doccount';
        countSpan.textContent = this._plural(this._i18n.resultDocCount, linkedCount);
        row2.appendChild(countSpan);
      }

      item.appendChild(row2);
    }

    // Row 3: name variants (max 3)
    const nameVariantsRaw = hit.meta.name_variants || '';
    if (nameVariantsRaw) {
      const variants = nameVariantsRaw.split(', ').filter(Boolean).slice(0, 3);
      if (variants.length > 0) {
        const row3 = document.createElement('div');
        row3.className = 'entity-result-variants';

        const label = document.createElement('span');
        label.style.color = 'var(--color-stone-400)';
        label.textContent = this._i18n.variantsLabel;
        row3.appendChild(label);

        row3.appendChild(document.createTextNode(variants.join(', ')));
        item.appendChild(row3);
      }
    }

    return item;
  }

  renderResultsInfo(data) {
    const info = document.createElement('div');
    info.className = 'results-info search-results-info';

    const count = document.createElement('span');
    count.className = 'results-count';
    count.textContent = this._plural(this._i18n.countLabel, data.total);
    info.appendChild(count);

    // Sort controls — mirrors the /buscar/ and /lugares/ sort-wrap DOM
    // shape and the "Ordenar por:" label (parity with search.js and
    // place-explorer.js).
    const sortWrap = document.createElement('div');
    sortWrap.className = 'sort-wrap';

    const sortLabel = document.createElement('span');
    sortLabel.className = 'sort-label';
    sortLabel.textContent = this._i18n.sortBy;
    sortWrap.appendChild(sortLabel);

    // Per-option default direction — Nombre/Fecha default asc (alphabetical/oldest-first),
    // Documentos default desc (most-linked first). Matches the /lugares/ convention.
    const sortOptions = [
      { field: 'name',  defaultDir: 'asc',  label: this._i18n.sortName },
      { field: 'date',  defaultDir: 'asc',  label: this._i18n.sortDate },
      { field: 'count', defaultDir: 'desc', label: this._i18n.sortDocs },
    ];

    const [curField, curDir] = (this.state.sort || '').split(':');

    sortOptions.forEach((opt, i) => {
      if (i > 0) {
        const divider = document.createElement('span');
        divider.className = 'sort-divider';
        divider.textContent = '|';
        sortWrap.appendChild(divider);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sort-btn';
      const isActive = curField === opt.field;
      if (isActive) btn.classList.add('active');
      btn.textContent = opt.label;

      // Arrow span: active → current direction; inactive → defaultDir hint.
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      const arrowDir = isActive ? curDir : opt.defaultDir;
      arrow.textContent = arrowDir === 'desc' ? ' \u2193' : ' \u2191';
      btn.appendChild(arrow);

      btn.addEventListener('click', ((field, active, dir, defaultDir) => () => {
        if (active) {
          // Toggle direction on the active button.
          this.state.sort = field + ':' + (dir === 'asc' ? 'desc' : 'asc');
        } else {
          // First click on inactive button: apply per-option default direction.
          this.state.sort = field + ':' + defaultDir;
        }
        this.state.page = 1;
        this.updateUrl();
        this.search();
      })(opt.field, isActive, curDir, opt.defaultDir));

      sortWrap.appendChild(btn);
    });

    info.appendChild(sortWrap);
    return info;
  }

  // --- Focal-card role facet (documentary-role taxonomy) ---
  //
  // Renders the 7-group documentary-role taxonomy scoped to the currently
  // selected entity's shard. Groups (and their children) with zero hits
  // in the focal entity's documents are hidden. Ticking a checkbox
  // filters which docs hang off the focal entity in the graph — it does
  // NOT filter the entity results list (role is per-document, not
  // per-entity).
  //
  // The 7-group rollup is computed client-side from a flat list of
  // canonical role values. When a future import lands more roles
  // (fiador, apoderado, etc.) they slot into the existing groups
  // without restructuring the UI.
  renderFocalRoleFacet(shard) {
    // Count roles in the focal entity's shard
    const counts = {};
    for (const link of shard) {
      const r = (link.role || '').toLowerCase();
      if (!r) continue;
      counts[r] = (counts[r] || 0) + 1;
    }

    // Compute per-group totals and surviving members
    const visibleGroups = [];
    for (const group of roleGroups) {
      const members = group.members
        .map(role => ({ role, count: counts[role] || 0 }))
        .filter(m => m.count > 0)
        .sort((a, b) => b.count - a.count);
      if (members.length === 0) continue;
      const total = members.reduce((s, m) => s + m.count, 0);
      visibleGroups.push({ ...group, members, total });
    }

    if (visibleGroups.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'focal-role-facet';

    const header = document.createElement('div');
    header.className = 'focal-role-facet-header';
    const title = document.createElement('span');
    title.className = 'focal-role-facet-title';
    title.textContent = this._i18n.focalRoleTitle;
    header.appendChild(title);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'focal-role-facet-clear';
    clearBtn.textContent = this._i18n.clearShort;
    clearBtn.style.display = this.focalRoleFilter.size > 0 ? '' : 'none';
    clearBtn.addEventListener('click', () => {
      this.focalRoleFilter = new Set();
      this._notifyFocalRoleFilter();
      // Re-render the facet so checkboxes reset
      const stale = wrap.parentElement;
      const fresh = this.renderFocalRoleFacet(this.focalShard);
      if (stale && fresh) stale.replaceChild(fresh, wrap);
    });
    header.appendChild(clearBtn);
    wrap.appendChild(header);

    for (const group of visibleGroups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'focal-role-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'focal-role-group-header';

      // Group-level checkbox: checked iff every visible member is active
      const allChecked = group.members.every(m => this.focalRoleFilter.has(m.role));
      const someChecked = group.members.some(m => this.focalRoleFilter.has(m.role));
      const groupCheckbox = document.createElement('input');
      groupCheckbox.type = 'checkbox';
      groupCheckbox.className = 'focal-role-group-checkbox';
      groupCheckbox.checked = allChecked;
      groupCheckbox.indeterminate = someChecked && !allChecked;
      groupCheckbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      groupCheckbox.addEventListener('change', () => {
        if (groupCheckbox.checked) {
          group.members.forEach(m => this.focalRoleFilter.add(m.role));
        } else {
          group.members.forEach(m => this.focalRoleFilter.delete(m.role));
        }
        this._notifyFocalRoleFilter();
        const stale = wrap.parentElement;
        const fresh = this.renderFocalRoleFacet(this.focalShard);
        if (stale && fresh) stale.replaceChild(fresh, wrap);
      });
      groupHeader.appendChild(groupCheckbox);

      const groupLabel = document.createElement('span');
      groupLabel.className = 'focal-role-group-label';
      groupLabel.textContent = this._roleGroupLabels[group.id] || group.id;
      groupHeader.appendChild(groupLabel);

      const groupCount = document.createElement('span');
      groupCount.className = 'focal-role-group-count';
      groupCount.textContent = `(${this._fmt.format(group.total)})`;
      groupHeader.appendChild(groupCount);

      const chevron = document.createElement('span');
      chevron.className = 'focal-role-group-chevron';
      const expanded = someChecked; // expand if anything in this group is checked
      chevron.textContent = expanded ? '\u2212' : '+';
      groupHeader.appendChild(chevron);

      groupHeader.addEventListener('click', () => {
        const isExpanded = groupEl.classList.toggle('is-expanded');
        chevron.textContent = isExpanded ? '\u2212' : '+';
      });
      if (expanded) groupEl.classList.add('is-expanded');

      groupEl.appendChild(groupHeader);

      const memberList = document.createElement('div');
      memberList.className = 'focal-role-group-members';
      for (const m of group.members) {
        const optLabel = document.createElement('label');
        optLabel.className = 'focal-role-option';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.role;
        cb.checked = this.focalRoleFilter.has(m.role);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            this.focalRoleFilter.add(m.role);
          } else {
            this.focalRoleFilter.delete(m.role);
          }
          this._notifyFocalRoleFilter();
          // Refresh group-level checkbox state and clear button visibility
          const stale = wrap.parentElement;
          const fresh = this.renderFocalRoleFacet(this.focalShard);
          if (stale && fresh) stale.replaceChild(fresh, wrap);
        });
        optLabel.appendChild(cb);

        const text = document.createElement('span');
        text.className = 'focal-role-option-label';
        text.textContent = this._roleLabels[m.role] || m.role;
        optLabel.appendChild(text);

        const cnt = document.createElement('span');
        cnt.className = 'focal-role-option-count';
        cnt.textContent = `(${this._fmt.format(m.count)})`;
        optLabel.appendChild(cnt);

        memberList.appendChild(optLabel);
      }
      groupEl.appendChild(memberList);

      wrap.appendChild(groupEl);
    }

    return wrap;
  }

  // Notify the graph that the focal-card role filter changed.
  _notifyFocalRoleFilter() {
    if (typeof this.onFocalRoleFilterChanged === 'function') {
      this.onFocalRoleFilterChanged(new Set(this.focalRoleFilter));
    }
  }

  // --- Sidebar facets (entity type, function, date) ---

  // Builds a `{ facetKey: { value: count } }` object from a Pagefind
  // search result by selecting each cell via the shared
  // `selectFacetCounts` helper. Preserves the existing
  // renderSidebarFacets / renderFacetGroup shape contract while
  // restoring correct per-facet counts after a click on /entidades/.
  /**
   * Adapter that collects the current entity-explorer filter state into
   * an activeByKey map and delegates to buildPivotScopedFiltersPure.
   * Returns a scopedFilters object with the same shape as
   * globalFilters, or null when no applicable pivot path exists
   * (0 or >=3 active pivot dims, sidecar absent, etc.) — caller
   * falls back to global counts.
   *
   * State shape for /entidades/ differs from /buscar/: we collect
   * entity_type and primary_function directly, and map dateFilter
   * onto either century (from the Roman-numeral label) or decade
   * (from the first year). Year-level dateFilter falls through to
   * globalFilters.year and is not pivot-scoped.
   */
  buildPivotScopedFilters() {
    const activeByKey = Object.create(null);
    if (this.state.entity_type && this.state.entity_type.length > 0) {
      activeByKey.entity_type = this.state.entity_type;
    }
    if (this.state.primary_function && this.state.primary_function.length > 0) {
      activeByKey.primary_function = this.state.primary_function;
    }
    // dateFilter → century / decade (same pattern as search.js).
    if (this.state.dateFilter) {
      const df = this.state.dateFilter;
      if (df.level === 'century') {
        // dateFilter.label is "Siglo XVII" — strip the prefix.
        const roman = (df.label || '').replace(/^Siglo\s+/, '');
        if (roman) activeByKey.century = [roman];
      } else if (df.level === 'decade') {
        // dateFilter.years is ['1850','1851',…'1859'] — the pivot key
        // emits a single decade-start value ('1850'); use years[0].
        const decadeStart = df.years && df.years[0];
        if (decadeStart) {
          activeByKey.decade = [String(Math.floor(parseInt(decadeStart, 10) / 10) * 10)];
        }
      }
    }
    return buildPivotScopedFiltersPure({
      activeByKey,
      pivots: this.pivots,
      triples: this.triples,
      // Null-guard: globalFilters may be null during the pre-warm
      // window (filters() now resolves async).
      globalFilters: this.globalFilters || {},
    });
  }

  // Returns globalFilters as a defensive fallback when Pagefind has
  // not yet produced any facet payloads.
  _buildScopedFacetCounts(searchResult) {
    const out = {};
    if (searchResult) {
      const facetKeys = new Set([
        ...Object.keys((searchResult.filters) || {}),
        ...Object.keys((searchResult.totalFilters) || {}),
      ]);
      for (const fk of facetKeys) {
        out[fk] = {};
        const allValues = new Set([
          ...Object.keys((searchResult.filters && searchResult.filters[fk]) || {}),
          ...Object.keys((searchResult.totalFilters && searchResult.totalFilters[fk]) || {}),
        ]);
        for (const v of allValues) {
          out[fk][v] = selectFacetCounts(searchResult, fk, v, this.state);
        }
      }
    }
    if (Object.keys(out).length === 0) {
      Object.assign(out, this.globalFilters || {});
    }
    return out;
  }

  renderSidebarFacets(containerEl, filtersArg) {
    if (!containerEl) return;
    // Null-guard: globalFilters may be null during the filters()
    // pre-warm window. If no filtersArg is supplied AND globalFilters
    // hasn't landed, bail — the warm chain (or the pivot sidecar
    // consumer) will re-trigger a render once counts are available.
    if (!filtersArg && !(this.globalFilters || false)) return;

    containerEl.innerHTML = '';

    // Use scoped filters from a recent search when available so the facet
    // counts narrow as the user applies filters (matching the descriptions
    // explorer behavior). Fall back to globalFilters on initial render.
    const filters = filtersArg || (this.globalFilters || {});

    if (filters.entity_type) {
      containerEl.appendChild(this.renderFacetGroup(
        this._i18n.facetEntityType,
        'entity_type',
        filters.entity_type,
        this.state.entity_type,
        (value) => this.entityTypeLabels[value] || value
      ));
    }

    if (filters.year && Object.values(filters.year).some(c => c > 0)) {
      containerEl.appendChild(this.renderDateTree(filters.year, filters.century || {}, filters.decade || {}));
    }

    if (filters.primary_function) {
      containerEl.appendChild(this.renderFacetGroup(
        this._i18n.facetPrimaryFunction,
        'primary_function',
        filters.primary_function,
        this.state.primary_function,
        (value) => value,
        null,
        10
      ));
    }
  }

  // --- Selected entity card (right column) ---
  // Renders into the #focal-entity-card host. Layout matches the
  // EntityExplorerRefinedPage Make spec: eyebrow + Cormorant name +
  // periwinkle type pill + big burgundy doc count + "Ver página completa"
  // link, with an X button that restores the stub state.

  highlightEntity(entityCode, entityMeta, shard) {
    this._currentFocalCode = entityCode;
    this._currentFocalMeta = entityMeta || {};

    // Reset focal-card role filter when focal entity changes
    if (entityCode !== this._lastFocalForRoleFilter) {
      this.focalRoleFilter = new Set();
      this._lastFocalForRoleFilter = entityCode;
    }
    this.focalShard = Array.isArray(shard) ? shard : [];

    const cardEl = document.getElementById('focal-entity-card');
    if (cardEl) {
      const typeLabel = this.entityTypeLabels[entityMeta.entity_type] || entityMeta.entity_type || '';

      cardEl.classList.remove('is-stub');
      cardEl.innerHTML = '';

      // Header row: eyebrow + close button
      const header = document.createElement('div');
      header.className = 'selected-entity-header';
      const eyebrow = document.createElement('div');
      eyebrow.className = 'selected-entity-eyebrow';
      eyebrow.textContent = this._i18n.cardEyebrow;
      header.appendChild(eyebrow);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'selected-entity-close';
      closeBtn.setAttribute('aria-label', this._i18n.deselect);
      closeBtn.textContent = '\u2715';
      closeBtn.addEventListener('click', () => {
        this.clearFocalCard();
        if (typeof this.onFocalCleared === 'function') this.onFocalCleared();
      });
      header.appendChild(closeBtn);
      cardEl.appendChild(header);

      const nameEl = document.createElement('div');
      nameEl.className = 'selected-entity-name';
      nameEl.textContent = entityMeta.label || entityCode;
      cardEl.appendChild(nameEl);

      if (typeLabel) {
        const badge = document.createElement('span');
        badge.className = 'selected-entity-badge selected-entity-badge--' + (
          entityMeta.entity_type === 'person' ? 'person'
          : (entityMeta.entity_type === 'corporate_body' || entityMeta.entity_type === 'corporate') ? 'corporate'
          : entityMeta.entity_type === 'family' ? 'family'
          : 'unknown'
        );
        badge.textContent = typeLabel;
        cardEl.appendChild(badge);
      }

      // Big doc count
      const count = entityMeta.linked_count || 0;
      const stat = document.createElement('div');
      stat.className = 'selected-entity-stat';
      const statNum = document.createElement('div');
      statNum.className = 'selected-entity-stat-num';
      statNum.textContent = this._fmt.format(Number(count));
      const statLbl = document.createElement('div');
      statLbl.className = 'selected-entity-stat-label';
      const _docDict = this._i18n.linkedDocLabel || {};
      statLbl.textContent = _docDict[this._pr.select(Number(count))] || _docDict.other || '';
      stat.appendChild(statNum);
      stat.appendChild(statLbl);
      cardEl.appendChild(stat);

      // Documentary-role facet (scoped to this entity's docs).
      // Hidden entirely if the shard has no roles to show.
      const roleFacet = this.renderFocalRoleFacet(this.focalShard);
      if (roleFacet) cardEl.appendChild(roleFacet);

      // Footer link
      const footer = document.createElement('div');
      footer.className = 'selected-entity-footer';
      const link = document.createElement('a');
      link.className = 'selected-entity-link';
      link.href = `/${entityCode}/`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = this._i18n.cardLink;
      footer.appendChild(link);
      cardEl.appendChild(footer);
    }

    // Highlight the entity in the result list if present
    const existingItem = this.container.querySelector(
      `.search-result-item a[href*="/${entityCode}/"]`
    );
    if (existingItem) {
      this.container.querySelectorAll('.search-result-item.graph-focused')
        .forEach(el => el.classList.remove('graph-focused'));
      const itemEl = existingItem.closest('.search-result-item');
      if (itemEl) {
        itemEl.classList.add('graph-focused');
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  clearFocalCard() {
    this._currentFocalCode = null;
    this._currentFocalMeta = null;
    const cardEl = document.getElementById('focal-entity-card');
    if (!cardEl) return;
    cardEl.classList.add('is-stub');
    cardEl.innerHTML = '<div class="selected-entity-stub">' + this.escapeHtml(this._i18n.selectPrompt) + '</div>';
    this.container.querySelectorAll('.search-result-item.graph-focused')
      .forEach(el => el.classList.remove('graph-focused'));
  }

  renderFacets(data) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'search-sidebar';

    // Mobile filter panel header
    const panelHeader = document.createElement('div');
    panelHeader.className = 'filter-panel-header';
    panelHeader.innerHTML =
      '<span class="filter-panel-title">' + this.escapeHtml(this._i18n.filtersHeader) + '</span>' +
      '<button class="filter-panel-close" type="button" aria-label="' + this.escapeHtml(this._i18n.closeFilters) + '">' +
      '<span class="material-symbols-outlined">close</span></button>';
    sidebar.appendChild(panelHeader);

    // Desktop heading
    const heading = document.createElement('h3');
    heading.className = 'search-sidebar-heading';
    heading.textContent = this._i18n.filtersHeader;
    sidebar.appendChild(heading);

    // Sidebar search input
    sidebar.appendChild(this.renderSidebarSearchInput());

    const filters = data.filters || {};

    // Facet: entity type
    if (filters.entity_type) {
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.facetEntityType,
        'entity_type',
        filters.entity_type,
        this.state.entity_type,
        (value) => this.entityTypeLabels[value] || value
      ));
    }

    // Facet: date drill-down tree
    if (filters.year && Object.values(filters.year).some(c => c > 0)) {
      sidebar.appendChild(this.renderDateTree(filters.year, filters.century || {}, filters.decade || {}));
    }

    // Facet: primary function
    if (filters.primary_function) {
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.facetPrimaryFunction,
        'primary_function',
        filters.primary_function,
        this.state.primary_function,
        (value) => value,
        null,
        10
      ));
    }

    // Mobile panel bottom close
    const panelBottom = document.createElement('div');
    panelBottom.className = 'filter-panel-bottom-close';
    panelBottom.innerHTML =
      '<button type="button">' +
      '<span class="material-symbols-outlined">expand_less</span> ' + this.escapeHtml(this._i18n.closeFilters) + '</button>';
    sidebar.appendChild(panelBottom);

    // Wire up close handlers
    const closePanel = () => {
      sidebar.classList.remove('sidebar-open');
      const toggle = this.container.querySelector('.mobile-filter-toggle');
      if (toggle) toggle.classList.remove('toggle-open');
    };
    panelHeader.querySelector('.filter-panel-close').addEventListener('click', closePanel);
    panelBottom.querySelector('button').addEventListener('click', closePanel);

    return sidebar;
  }

  renderSidebarSearchInput() {
    const wrap = document.createElement('div');
    wrap.className = 'search-refine-wrap';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'search-refine-input';
    input.placeholder = this._i18n.searchPlaceholder;
    input.value = this.state.q;
    input.setAttribute('aria-label', this._i18n.searchAria);

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.state.q = input.value.trim();
        this.state.page = 1;
        this.updateUrl();
        this.search();
      }, 300);
    });

    wrap.appendChild(input);
    return wrap;
  }

  renderFacetGroup(title, stateKey, facetData, activeValues, labelFn, sortFn, maxVisible) {
    const group = document.createElement('div');
    group.className = 'facet-group';

    const isOpen = this.facetGroupState[stateKey] !== false;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'facet-group-toggle';
    toggle.innerHTML = `<span class="facet-group-title">${this.escapeHtml(title)}</span><span class="facet-group-indicator">${isOpen ? '\u2212' : '+'}</span>`;
    toggle.addEventListener('click', () => {
      this.facetGroupState[stateKey] = !this.facetGroupState[stateKey];
      const content = group.querySelector('.facet-group-content');
      const indicator = toggle.querySelector('.facet-group-indicator');
      if (content) {
        content.style.display = this.facetGroupState[stateKey] ? '' : 'none';
        indicator.textContent = this.facetGroupState[stateKey] ? '\u2212' : '+';
      }
    });
    group.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'facet-group-content';
    content.style.display = isOpen ? '' : 'none';

    const entries = Object.entries(facetData).sort((a, b) => {
      const aActive = activeValues.includes(a[0]) ? 1 : 0;
      const bActive = activeValues.includes(b[0]) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (sortFn) return sortFn(a, b);
      return b[1] - a[1];
    });

    const hasActive = activeValues.length > 0;
    let rendered = 0;

    for (const [value, count] of entries) {
      if (hasActive && !activeValues.includes(value)) continue;
      if (count === 0 && !activeValues.includes(value)) continue;

      if (maxVisible && !hasActive && rendered >= maxVisible) break;

      const label = document.createElement('label');
      label.className = 'facet-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = value;
      checkbox.checked = activeValues.includes(value);
      checkbox.addEventListener('change', () => {
        this.handleFilterChange(stateKey, value, checkbox.checked);
      });
      label.appendChild(checkbox);

      const text = document.createElement('span');
      text.className = 'facet-label-text';
      text.textContent = labelFn(value);
      label.appendChild(text);

      const countSpan = document.createElement('span');
      countSpan.className = 'facet-count';
      countSpan.textContent = `(${this._fmt.format(Number(count))})`;
      label.appendChild(countSpan);

      content.appendChild(label);
      rendered++;
    }

    // "Ver todos" button when there are more items than maxVisible
    if (maxVisible && !hasActive && entries.length > maxVisible) {
      const showAllBtn = document.createElement('button');
      showAllBtn.type = 'button';
      showAllBtn.className = 'facet-show-all-btn';
      showAllBtn.textContent = `${this._i18n.viewAll} (${this._fmt.format(entries.length)})`;
      showAllBtn.addEventListener('click', () => {
        this.openFacetModal(title, stateKey, entries, activeValues, labelFn);
      });
      content.appendChild(showAllBtn);
    }

    group.appendChild(content);
    return group;
  }

  openFacetModal(title, stateKey, entries, activeValues, labelFn) {
    // Remove any existing modal
    var existing = document.getElementById('facet-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'facet-modal-overlay';
    overlay.className = 'facet-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'facet-modal';

    // Header
    var header = document.createElement('div');
    header.className = 'facet-modal-header';
    var titleEl = document.createElement('h3');
    titleEl.textContent = title;
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'facet-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Search input
    var searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'facet-modal-search';
    searchInput.placeholder = this._i18n.facetModalSearch;
    modal.appendChild(searchInput);

    // List container
    var list = document.createElement('div');
    list.className = 'facet-modal-list';

    var self = this;

    // Sort entries alphabetically by label for the modal
    var sortedEntries = entries.slice().sort(function(a, b) {
      return self._coll.compare(labelFn(a[0]), labelFn(b[0]));
    });

    function renderModalEntries(filter) {
      list.innerHTML = '';
      var filterLower = (filter || '').toLowerCase();
      var isFiltering = filterLower.length > 0;
      var shown = 0;
      var currentLetter = '';

      for (var i = 0; i < sortedEntries.length; i++) {
        var value = sortedEntries[i][0];
        var count = sortedEntries[i][1];
        if (count === 0) continue;
        var labelText = labelFn(value);
        if (isFiltering && labelText.toLowerCase().indexOf(filterLower) === -1) continue;

        // Letter header (skip when searching)
        if (!isFiltering) {
          var firstLetter = labelText[0].toUpperCase();
          if (firstLetter !== currentLetter) {
            currentLetter = firstLetter;
            var letterHeader = document.createElement('div');
            letterHeader.className = 'facet-modal-letter';
            letterHeader.textContent = currentLetter;
            list.appendChild(letterHeader);
          }
        }

        var label = document.createElement('label');
        label.className = 'facet-option';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = activeValues.includes(value);
        (function(v, cb) {
          cb.addEventListener('change', function() {
            self.handleFilterChange(stateKey, v, cb.checked);
            if (cb.checked && !activeValues.includes(v)) activeValues.push(v);
            else if (!cb.checked) {
              var idx = activeValues.indexOf(v);
              if (idx !== -1) activeValues.splice(idx, 1);
            }
          });
        })(value, checkbox);
        label.appendChild(checkbox);

        var text = document.createElement('span');
        text.className = 'facet-label-text';
        text.textContent = labelText;
        label.appendChild(text);

        var countSpan = document.createElement('span');
        countSpan.className = 'facet-count';
        countSpan.textContent = '(' + this._fmt.format(Number(count)) + ')';
        label.appendChild(countSpan);

        list.appendChild(label);
        shown++;
      }
      if (shown === 0) {
        var empty = document.createElement('p');
        empty.className = 'facet-modal-empty';
        empty.textContent = self._i18n.noResults;
        list.appendChild(empty);
      }
    }

    renderModalEntries('');

    searchInput.addEventListener('input', function() {
      renderModalEntries(searchInput.value);
    });

    modal.appendChild(list);
    overlay.appendChild(modal);

    // Close on overlay click (outside modal)
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    // Close on Escape
    var escHandler = function(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
    searchInput.focus();
  }

  renderDateTree(yearData, centuryFacet, decadeFacet) {
    // centuryFacet / decadeFacet: pagefind filter maps from dedicated
    // entity-level century/decade tags. Each entity contributes once per
    // century/decade it spans, so these counts represent unique entities.
    // The year-level data is unchanged (single year per entity per year).
    centuryFacet = centuryFacet || {};
    decadeFacet = decadeFacet || {};
    const group = document.createElement('div');
    group.className = 'facet-group';

    const isOpen = this.facetGroupState.date !== false;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'facet-group-toggle';
    toggle.innerHTML = '<span class="facet-group-title">Fecha</span><span class="facet-group-indicator">' + (isOpen ? '\u2212' : '+') + '</span>';
    toggle.addEventListener('click', () => {
      this.facetGroupState.date = !this.facetGroupState.date;
      const content = group.querySelector('.facet-group-content');
      const indicator = toggle.querySelector('.facet-group-indicator');
      if (content) {
        content.style.display = this.facetGroupState.date ? '' : 'none';
        indicator.textContent = this.facetGroupState.date ? '\u2212' : '+';
      }
    });
    group.appendChild(toggle);

    const content = document.createElement('div');
    content.className = 'facet-group-content';
    content.style.display = isOpen ? '' : 'none';

    // Build century → decade → year hierarchy from flat year data
    const centuries = new Map();
    for (const [yearStr, count] of Object.entries(yearData)) {
      const year = parseInt(yearStr, 10);
      if (isNaN(year)) continue;
      if (count === 0) continue;
      const centuryNum = Math.floor(year / 100) + 1;
      const decadeBase = Math.floor(year / 10) * 10;

      if (!centuries.has(centuryNum)) {
        centuries.set(centuryNum, { decades: new Map(), total: 0, years: [] });
      }
      const century = centuries.get(centuryNum);
      century.total += count;
      century.years.push(yearStr);

      if (!century.decades.has(decadeBase)) {
        century.decades.set(decadeBase, new Map());
      }
      century.decades.get(decadeBase).set(yearStr, count);
    }

    const df = this.state.dateFilter;
    const tree = document.createElement('ul');
    tree.className = 'date-tree';

    const sortedCenturies = Array.from(centuries.entries()).sort((a, b) => a[0] - b[0]);

    for (const [centuryNum, centuryData] of sortedCenturies) {
      const centuryLabel = this._i18n.centuryLabel.replace('{roman}', this.romanCentury(centuryNum));

      if (df && df.level === 'century' && df.label !== centuryLabel) continue;
      if (df && (df.level === 'decade' || df.level === 'year')) {
        const selectedYear = parseInt(df.years[0], 10);
        const selectedCentury = Math.floor(selectedYear / 100) + 1;
        if (selectedCentury !== centuryNum) continue;
      }

      const isCenturyActive = df && df.level === 'century' && df.label === centuryLabel;
      const existingYears = centuryData.years;

      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'date-tree-row';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'date-tree-toggle';
      const autoExpand = isCenturyActive || (df && (df.level === 'decade' || df.level === 'year'));
      toggleBtn.textContent = autoExpand ? '\u25BE' : '\u25B8';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'date-tree-checkbox';
      checkbox.checked = isCenturyActive;
      checkbox.addEventListener('change', () => {
        this.handleDateSelect(checkbox.checked ? {
          level: 'century', label: centuryLabel, years: existingYears
        } : null);
      });

      const label = document.createElement('span');
      label.className = 'date-tree-label';
      label.textContent = centuryLabel;

      const countSpan = document.createElement('span');
      countSpan.className = 'date-tree-count';
      const centuryEntityCount = centuryFacet[String(centuryNum)];
      const centuryDisplay = (centuryEntityCount != null ? centuryEntityCount : centuryData.total);
      countSpan.textContent = `(${this._fmt.format(Number(centuryDisplay))})`;

      row.appendChild(toggleBtn);
      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(countSpan);
      li.appendChild(row);

      // Decades
      const decadeList = document.createElement('ul');
      decadeList.className = 'date-tree-children' + (autoExpand ? '' : ' collapsed');

      const sortedDecades = Array.from(centuryData.decades.entries()).sort((a, b) => a[0] - b[0]);

      for (const [decadeBase, yearsMap] of sortedDecades) {
        const decadeLabel = `${decadeBase}s`;
        const decadeExistingYears = Array.from(yearsMap.keys());

        if (df && df.level === 'decade' && df.label !== decadeLabel) continue;
        if (df && df.level === 'year') {
          const selectedDecade = Math.floor(parseInt(df.years[0], 10) / 10) * 10;
          if (selectedDecade !== decadeBase) continue;
        }

        let decadeTotal = 0;
        for (const c of yearsMap.values()) decadeTotal += c;
        const decadeEntityCount = decadeFacet[String(decadeBase)];
        if (decadeEntityCount != null) decadeTotal = decadeEntityCount;

        const isDecadeActive = df && df.level === 'decade' && df.label === decadeLabel;
        const autoExpandDecade = isDecadeActive || (df && df.level === 'year');

        const decadeLi = document.createElement('li');
        const decadeRow = document.createElement('div');
        decadeRow.className = 'date-tree-row';

        const decadeToggle = document.createElement('button');
        decadeToggle.type = 'button';
        decadeToggle.className = 'date-tree-toggle';
        decadeToggle.textContent = autoExpandDecade ? '\u25BE' : '\u25B8';

        const decadeCb = document.createElement('input');
        decadeCb.type = 'checkbox';
        decadeCb.className = 'date-tree-checkbox';
        decadeCb.checked = isDecadeActive;
        decadeCb.addEventListener('change', () => {
          this.handleDateSelect(decadeCb.checked ? {
            level: 'decade', label: decadeLabel, years: decadeExistingYears
          } : null);
        });

        const decadeLabelSpan = document.createElement('span');
        decadeLabelSpan.className = 'date-tree-label';
        decadeLabelSpan.textContent = decadeLabel;

        const decadeCount = document.createElement('span');
        decadeCount.className = 'date-tree-count';
        decadeCount.textContent = `(${this._fmt.format(decadeTotal)})`;

        decadeRow.appendChild(decadeToggle);
        decadeRow.appendChild(decadeCb);
        decadeRow.appendChild(decadeLabelSpan);
        decadeRow.appendChild(decadeCount);
        decadeLi.appendChild(decadeRow);

        // Years
        const yearList = document.createElement('ul');
        yearList.className = 'date-tree-children' + (autoExpandDecade ? '' : ' collapsed');

        const sortedYears = Array.from(yearsMap.entries()).sort((a, b) => this._coll.compare(a[0], b[0]));

        for (const [yearStr, yearCount] of sortedYears) {
          if (df && df.level === 'year' && df.years[0] !== yearStr) continue;

          const isYearActive = df && df.level === 'year' && df.years[0] === yearStr;

          const yearLi = document.createElement('li');
          const yearRow = document.createElement('div');
          yearRow.className = 'date-tree-row';

          const spacer = document.createElement('span');
          spacer.className = 'date-tree-spacer';

          const yearCb = document.createElement('input');
          yearCb.type = 'checkbox';
          yearCb.className = 'date-tree-checkbox';
          yearCb.checked = isYearActive;
          yearCb.addEventListener('change', () => {
            this.handleDateSelect(yearCb.checked ? {
              level: 'year', label: yearStr, years: [yearStr]
            } : null);
          });

          const yearLabelSpan = document.createElement('span');
          yearLabelSpan.className = 'date-tree-label';
          yearLabelSpan.textContent = yearStr;

          const yearCountSpan = document.createElement('span');
          yearCountSpan.className = 'date-tree-count';
          yearCountSpan.textContent = `(${this._fmt.format(yearCount)})`;

          yearRow.appendChild(spacer);
          yearRow.appendChild(yearCb);
          yearRow.appendChild(yearLabelSpan);
          yearRow.appendChild(yearCountSpan);
          yearLi.appendChild(yearRow);
          yearList.appendChild(yearLi);
        }

        decadeLi.appendChild(yearList);

        decadeToggle.addEventListener('click', () => {
          const expanded = yearList.classList.contains('collapsed');
          yearList.classList.toggle('collapsed');
          decadeToggle.textContent = expanded ? '\u25BE' : '\u25B8';
        });

        decadeList.appendChild(decadeLi);
      }

      li.appendChild(decadeList);

      toggleBtn.addEventListener('click', () => {
        const expanded = decadeList.classList.contains('collapsed');
        decadeList.classList.toggle('collapsed');
        toggleBtn.textContent = expanded ? '\u25BE' : '\u25B8';
      });

      tree.appendChild(li);
    }

    content.appendChild(tree);
    group.appendChild(content);
    return group;
  }

  renderPills() {
    const hasFilters = this.state.q ||
      this.state.entity_type.length > 0 ||
      this.state.primary_function.length > 0 ||
      this.state.dateFilter !== null;

    if (!hasFilters) return null;

    const container = document.createElement('div');
    container.className = 'active-filters';

    // Query pill
    if (this.state.q) {
      container.appendChild(this.createPill(
        `\u201C${this.state.q}\u201D`,
        () => {
          this.state.q = '';
          this.state.page = 1;
          this.updateUrl();
          this.search();
        }
      ));
    }

    // Entity type pills
    for (const t of this.state.entity_type) {
      container.appendChild(this.createPill(
        this.entityTypeLabels[t] || t,
        () => this.handlePillRemove('entity_type', t)
      ));
    }

    // Primary function pills
    for (const f of this.state.primary_function) {
      container.appendChild(this.createPill(
        f,
        () => this.handlePillRemove('primary_function', f)
      ));
    }

    // Date filter pill
    if (this.state.dateFilter) {
      container.appendChild(this.createPill(
        this.state.dateFilter.label,
        () => {
          this.state.dateFilter = null;
          this.state.page = 1;
          this.updateUrl();
          this.search();
        }
      ));
    }

    // Clear all button
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'clear-filters-btn';
    clearBtn.textContent = this._i18n.clearFilters;
    clearBtn.addEventListener('click', () => this.handleClearAll());
    container.appendChild(clearBtn);

    return container;
  }

  createPill(label, onRemove) {
    const pill = document.createElement('span');
    pill.className = 'filter-pill';

    const text = document.createElement('span');
    text.textContent = label;
    pill.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'filter-pill-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.setAttribute('aria-label', this._i18n.removeFilter.replace('{label}', label));
    removeBtn.addEventListener('click', onRemove);
    pill.appendChild(removeBtn);

    return pill;
  }

  renderPagination(data) {
    const nav = document.createElement('nav');
    nav.className = 'search-pagination';
    nav.setAttribute('aria-label', this._i18n.pagination);

    const currentPage = data.page;
    const totalPages = data.total_pages;

    if (currentPage > 1) {
      nav.appendChild(this.createPageLink('\u00AB', currentPage - 1));
    } else {
      nav.appendChild(this.createPageSpan('\u00AB', true));
    }

    const pages = this.getPageRange(currentPage, totalPages);
    for (const p of pages) {
      if (p === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        nav.appendChild(ellipsis);
      } else if (p === currentPage) {
        nav.appendChild(this.createPageSpan(p, false, true));
      } else {
        nav.appendChild(this.createPageLink(p, p));
      }
    }

    if (currentPage < totalPages) {
      nav.appendChild(this.createPageLink('\u00BB', currentPage + 1));
    } else {
      nav.appendChild(this.createPageSpan('\u00BB', true));
    }

    return nav;
  }

  getPageRange(current, total) {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = [1];
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  createPageLink(label, page) {
    const a = document.createElement('a');
    a.className = 'pagination-link';
    a.href = '#';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      this.handlePageChange(page);
    });
    return a;
  }

  createPageSpan(label, disabled, active) {
    const span = document.createElement('span');
    span.className = 'pagination-link';
    if (disabled) span.classList.add('disabled');
    if (active) span.classList.add('active');
    span.textContent = label;
    return span;
  }

  renderNoResults() {
    const div = document.createElement('div');
    div.className = 'search-no-results';

    const msg = document.createElement('p');
    msg.textContent = this._i18n.entityNoResults;
    div.appendChild(msg);

    const suggestion = document.createElement('p');
    suggestion.className = 'no-results-suggestion';
    suggestion.textContent = this._i18n.entityNoResultsSuggestion;
    div.appendChild(suggestion);

    return div;
  }

  // --- State displays ---

  showLoading() {
    const existingResults = this.container.querySelector('.search-results');
    if (existingResults) {
      existingResults.classList.add('results-loading');
      if (!existingResults.querySelector('.search-loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'search-loading-overlay';
        overlay.innerHTML = '<div class="search-spinner" aria-busy="true"></div>';
        existingResults.appendChild(overlay);
      }
      return;
    }
    this.container.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'search-loading';
    div.innerHTML = '<div class="search-spinner" aria-busy="true"></div>';
    this.container.appendChild(div);
  }

  showError() {
    this.container.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'search-error';

    const msg = document.createElement('p');
    msg.textContent = this._i18n.errorTitle;
    div.appendChild(msg);

    const hint = document.createElement('p');
    hint.textContent = this._i18n.errorHint;
    div.appendChild(hint);

    const retry = document.createElement('a');
    retry.href = '#';
    retry.textContent = this._i18n.retry;
    retry.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.reload();
    });
    div.appendChild(retry);

    this.container.appendChild(div);
  }

  // --- Event handlers ---

  handleFilterChange(stateKey, value, checked) {
    this.state[stateKey] = checked ? [value] : [];
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  handlePillRemove(stateKey, value) {
    this.state[stateKey] = this.state[stateKey].filter(v => v !== value);
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  handleDateSelect(filter) {
    this.state.dateFilter = filter;
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  handleClearAll() {
    this.state.q = '';
    this.state.entity_type = [];
    this.state.primary_function = [];
    this.state.dateFilter = null;
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  handlePageChange(page) {
    this.state.page = page;
    this.updateUrl();
    this.search();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Utilities ---

  romanCentury(num) {
    const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX',
      'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX',
      'XX', 'XXI', 'XXII'];
    return romans[num] || String(num);
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Select the grammatical form from a {one, other} blob sub-table for
  // count `n` and substitute the formatted number into the {count}
  // token. Blob-only: the sub-table must be present in data-i18n;
  // there is no Spanish fallback.
  _plural(dict, n) {
    const form = this._pr.select(n);
    const tpl = (dict && (dict[form] || dict.other)) || '';
    return tpl.replace('{count}', this._fmt.format(n));
  }
}

// EntityExplorer is instantiated and initialised by the wiring script in
// entidades.njk, which controls initialization order relative to the graph.

// Conditional CommonJS export so `selectFacetCounts` can be unit-tested
// from `tests/pagefind-facets.test.js` under Node. The browser loads
// this file as a classic <script>; `typeof module` is undefined there,
// so the block is a no-op. Kept symmetric with the same footer in
// `static/js/search.js` and `static/js/place-explorer.js`.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selectFacetCounts, buildPivotScopedFiltersPure, PIVOT_KEYS };
}

// Version: v1.3.0
