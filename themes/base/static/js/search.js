/**
 * Search Page Controller (`/buscar/`)
 *
 * Drives the user-facing full-text search at `/buscar/` against
 * three Pagefind indices (descriptions, entities, places). Pagefind
 * is a client-side search engine that ships a small WebAssembly
 * bundle plus a JSON index produced at build time, so the search
 * runs entirely in the browser with no server round-trip. This
 * module is the controller the `/buscar/` template instantiates: it
 * parses the URL state, fires Pagefind queries against the
 * descriptions index with the active filter set, paginates the
 * results, and renders the facet sidebar.
 *
 * Cold-click performance is the feature the file spends the most
 * care on. Pagefind's WebAssembly runtime takes a noticeable moment
 * to load its filter chunks on first interaction; rendering the
 * sidebar off `pagefind.filters()` alone was a ~13-second stall on
 * deep links like `/buscar/?repository=Colombia`. The controller
 * therefore fetches three JSON sidecars emitted by the indexer at
 * build time — `/buscar-facets.json` (landing counts),
 * `/buscar-pivots.json` (pair-wise intersection counts for one
 * active filter), and `/buscar-triples.json` (triple-wise
 * intersection counts for two active filters) — and serves the
 * sidebar synchronously from those while Pagefind warms in the
 * background. Three or more active filters fall back to global
 * totals until Pagefind's filter cache lands.
 *
 * `selectFacetCounts` is the canonical facet-count selector. For
 * any facet the user has filtered on, badge counts come from
 * Pagefind's `result.totalFilters` (so OR-group siblings stay
 * visible at their real magnitude, and the active value shows its
 * restore count when deselected); for cross-facet keys they come
 * from `result.filters`. An active-single-value short-circuit
 * covers the degenerate case where a single filter value is
 * applied against its own facet — the count returns the result-set
 * size rather than querying the filter against itself and returning
 * zero. The helper is copy-pasted across `search.js`,
 * `entity-explorer.js`, and `place-explorer.js` because the three
 * explorer files are loaded as independent classic `<script>` tags,
 * not ES modules, so they cannot share an import. A unit-test
 * suite (`tests/pagefind-facets.test.js`) pins its behaviour across
 * all three copies.
 *
 * NOT-term handling, advanced filters, lazy Pagefind loading on
 * first real interaction, the browse-prompt short-circuit for
 * empty-query landings, and tokenisation of `-term` tokens typed
 * directly into the search box all live in this file too.
 *
 * @version v1.4.0
 */

/**
 * Pick the correct Pagefind facet count for a given (facetKey, value)
 * pair, given the user's currently active filter selections.
 *
 * Pagefind returns two parallel count maps on every `search()` payload:
 *
 *   result.filters       — counts constrained by every currently-active
 *                          filter (AND across keys). Correct for CROSS-
 *                          facet display (e.g. rendering `repository`
 *                          counts while a `level` filter is active).
 *                          Same-facet inactive values come back as 0
 *                          here, which is why reading only from
 *                          `filters` made the facet sidebar appear to
 *                          freeze on click — the original.
 *   result.totalFilters  — counts that ignore the active filter on the
 *                          facet key being asked about. Correct for
 *                          same-facet OR-group siblings (so they stay
 *                          visible at their true size) and for the
 *                          active value's own restore count (so the
 *                          de-select badge is informative).
 *
 * Selection rule:
 *
 *   - If the user has any active selection on `facetKey` (active value
 *     or sibling within the same facet) → return totalFilters[key][val]
 *     so the badge shows the full count, not the AND-constrained count.
 *   - Otherwise (cross-facet) → return filters[key][val] so the badge
 *     shows the post-filter potential count.
 *   - Missing payload, missing key, or missing value → return 0.
 *
 * The same-facet branch was designed around OR-group siblings — when the user picks
 *   two+ values inside a single facet, `totalFilters[key][sibling]`
 *   gives each sibling's true contribution to the union. In the
 *   single-active-value case (exactly one value active for this facet
 *   AND that value is the one being queried), Pagefind's `totalFilters`
 *   entry collapses to 0 because there is no OR-sibling to restore
 *   against — the "restore count" is mathematically the cardinality of
 *   the empty sibling set. That renders as "Archivo Histórico de
 *   Rionegro (0)" in the sidebar when AHR is the sole active filter
 *   and 55,359 records match, which is worse than uninformative. For
 *   this degenerate case we return `result.results.length` (the scoped
 *   total) so the active badge reflects the size of the current result
 *   set. Multi-value OR-group behaviour is preserved — only the exact
 *   shape `activeFilters[facetKey] === [value]` takes the short-circuit.
 *
 * The helper is intentionally inline and gets copy-pasted into
 * `entity-explorer.js` and `place-explorer.js`; keep the three
 * definitions byte-equivalent. The three explorer files load as
 * independent classic `<script>` tags, not ES modules, so they
 * cannot share an import.
 *
 * See `tests/pagefind-facets.test.js` for the five cases this covers
 * (four cases plus the single-active-value branch).
 *
 * @param {object|null} result Pagefind `search()` payload (may be null).
 * @param {string} facetKey The facet key the caller is asking about.
 * @param {string} value The facet value the caller is asking about.
 * @param {object|null} activeFilters Map of currently active filters,
 *                                    shape `{ key: [value, ...] }`.
 * @returns {number} The count to render against this facet value.
 */
// Pivot keys mirrored from the indexer's PIVOT_FACET_KEYS
// (scripts/generate-pagefind-indices.js). Keep in lockstep with the
// indexer — alphabetical ordering matters because
// buildPivotScopedFiltersPure uses canonical alphabetical ordering
// when walking the triples sidecar for the two-active-dimension branch.
const PIVOT_KEYS = ['century', 'country', 'decade', 'digital_status', 'level', 'repository'];

/**
 * Pure helper that computes a scoped filters object from the pivot /
 * triple sidecars, given a set of active filter dimensions and the
 * global facet counts. Extracted from the class method so
 * tests/pagefind-facets.test.js can exercise the full dispatch
 * (0, 1, 2, >=3 active dims) without constructing a SearchPage instance.
 *
 * @param {object} args
 * @param {object} args.activeByKey  Map of active pivot dim →
 *                                    non-empty array of active values
 *                                    (e.g. { repository: ['Popayán'],
 *                                    level: ['Unidad documental'] }).
 *                                    Keys outside PIVOT_KEYS are
 *                                    ignored.
 * @param {object|null} args.pivots       Pair-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object|null} args.triples      Triple-wise pivot sidecar
 *                                        (null if fetch failed).
 * @param {object} args.globalFilters     Global facet counts (the
 *                                        /buscar-facets.json sidecar
 *                                        payload) — used for the
 *                                        active-key pass-through and
 *                                        the year passthrough.
 * @returns {object|null} A scopedFilters object with the same shape
 *                        as globalFilters (`{ key: { value: count } }`),
 *                        or null if no applicable pivot path exists
 *                        (0 or >=3 active dims, sidecar missing,
 *                        etc.). Caller falls back to globalFilters
 *                        when null is returned.
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

class SearchPage {
  constructor(container) {
    this.container = container;
    this.pagefind = null;
    this.perPage = 20;

    // Locale-aware formatters (read from <html lang>; fallback es-CO)
    const _locale = document.documentElement.lang || 'es-CO';
    this._locale = _locale;
    this._fmt  = new Intl.NumberFormat(_locale);
    this._coll = new Intl.Collator(_locale);

    // App-label strings from data-i18n blob injected by the template
    this._i18n = {};
    try {
      this._i18n = JSON.parse(container.dataset.i18n || '{}');
    } catch (e) {
      console.warn('SearchPage: could not parse data-i18n');
    }

    this.levelLabels = {};
    try {
      this.levelLabels = JSON.parse(container.dataset.levelLabels || '{}');
    } catch (e) {
      console.warn('Could not parse level labels');
    }

    // Build reverse map: display label → internal code (for levelLabels pill display)
    this.levelLabelToCode = {};
    for (const [code, label] of Object.entries(this.levelLabels)) {
      this.levelLabelToCode[label] = code;
    }

    this.state = {
      q: '',
      textFilters: [],
      country: [],       // display names (e.g. "Colombia", "Perú")
      repository: [],   // display names (Pagefind filters use display text)
      level: [],         // canonical codes (e.g. "fonds", "series")
      digital_status: [],  // 'zasqua', 'external' (future), 'none'
      dateFilter: null,  // { level: 'century'|'decade'|'year', label, years: [...existing years only] }
      ancestor: [],
      sort: '',
      page: 1,
      entidad: [],
    };

    this.facetGroupState = { country: true, repository: true, digital_status: true, level: true, date: true };

    // lazy-Pagefind + advanced-filters state.
    this.pagefindLoadPromise = null;
    this.advancedFiltersActive = false;
    this.advancedGlobalFilters = null;

    this.init();
  }

  ensurePagefindLoaded() {
    if (this.pagefind) return Promise.resolve(this.pagefind);
    if (this.pagefindLoadPromise) return this.pagefindLoadPromise;
    this.pagefindLoadPromise = (async () => {
      try {
        const pf = await import('/pagefind/pagefind.js');
        await pf.init();
        this.pagefind = pf;
        return pf;
      } catch (e) {
        console.error('Failed to load Pagefind:', e);
        this.pagefindLoadPromise = null;
        throw e;
      }
    })();
    return this.pagefindLoadPromise;
  }

  async init() {
    this.parseUrlParams();

    // landing sidebar comes from a precomputed static
    // sidecar (~5 KB, ~10ms on localhost) so we never pay the ~13s
    // pagefind.filters() WASM tax on cold /buscar/ landing. Pagefind
    // itself is lazy-loaded on first user interaction via
    // ensurePagefindLoaded().
    //
    // Fetch /buscar-pivots.json in parallel. The pivot sidecar
    // (pair-wise cross-facet counts for the 6 pivot keys, including
    // century and decade) is consumed by the synchronous browse-prompt
    // path when exactly one filter dimension is active, so the sidebar
    // shows scoped intersection counts on cold first-click (before the
    // background pagefind.filters() pre-warm completes). Fetch failure
    // is non-fatal — this.pivots stays null and the browse prompt falls
    // back to global counts.
    //
    // A third fetch grabs /buscar-triples.json, the triple-wise
    // cross-facet sidecar consumed by buildPivotScopedFilters's
    // two-active-dimension branch. Same non-fatal fetch semantics —
    // this.triples stays null if the request fails and that branch
    // silently falls back to global counts.
    const [facetsRes, pivotsRes, triplesRes] = await Promise.allSettled([
      fetch('/buscar-facets.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      fetch('/buscar-pivots.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
      fetch('/buscar-triples.json', { cache: 'force-cache' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    ]);

    if (facetsRes.status === 'fulfilled') {
      this.globalFilters = facetsRes.value;
    } else {
      console.error('Failed to load /buscar-facets.json, falling back to pagefind.filters():', facetsRes.reason);
      try {
        await this.ensurePagefindLoaded();
        this.globalFilters = await this.pagefind.filters();
      } catch (e2) {
        this.showError();
        return;
      }
    }

    this.pivots = pivotsRes.status === 'fulfilled' ? pivotsRes.value : null;
    if (pivotsRes.status === 'rejected') {
      console.warn('Failed to load /buscar-pivots.json; sidebar will use global counts on single-filter cold clicks:', pivotsRes.reason);
    }

    this.triples = triplesRes.status === 'fulfilled' ? triplesRes.value : null;
    if (triplesRes.status === 'rejected') {
      console.warn('Failed to load /buscar-triples.json; sidebar will use global counts on two-filter cold clicks:', triplesRes.reason);
    }

    window.addEventListener('popstate', () => {
      this.parseUrlParams();
      this.search();
    });

    this.search();

    // Eagerly warm Pagefind AND its filter cache in the background
    // AFTER the landing sidebar has rendered from the static sidecar.
    // This hides both the WASM init cost and the filter-chunk fetch
    // (~13s combined cold) behind the user's natural orientation pause
    // on landing, so the first facet click returns cross-faceted counts
    // with no perceptible wait. The `await this.pagefind.filters()` call
    // is load-bearing for the cross-facet contract: without it,
    // `search.filters` / `search.totalFilters` silently narrow to
    // active-filter keys only and the sidebar's intersection counts
    // collapse to global totals. Fire-and-forget with a swallowed
    // `.catch` — failures surface on first user action.
    if (!this.pagefind && !this.pagefindLoadPromise) {
      this.ensurePagefindLoaded()
        .then(() => this.pagefind.filters())
        .catch(() => { /* swallowed; surfaces on first user action */ });
    }
  }

  tokenizeRawQuery(raw) {
    // Split on whitespace; tokens starting with '-' (and length > 1) become
    // NOT terms, rest rejoin as the positive query. This routes
    // '-tunja' typed in the header form into a NOT chip so Pagefind's
    // native query-level negation (`cacique -tunja`) is engaged instead of
    // treating '-tunja' as a positive search for 'tunja'.
    const positive = [];
    const notTerms = [];
    const parts = String(raw || '').split(/\s+/).filter(Boolean);
    for (const p of parts) {
      if (p.startsWith('-') && p.length > 1) notTerms.push(p.slice(1));
      else positive.push(p);
    }
    return { positive: positive.join(' '), notTerms };
  }

  parseUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const qValues = params.getAll('q');
    this.state.textFilters = qValues.slice(1).map(v => {
      if (v.startsWith('-')) {
        return { term: v.slice(1), op: 'NOT' };
      }
      return { term: v, op: 'AND' };
    });
    // Tokenize the main q so '-term' tokens typed in the
    // header search box (e.g. '/buscar/?q=-tunja' or '?q=cacique -tunja')
    // are promoted to NOT filters rather than treated as positive queries.
    const { positive, notTerms } = this.tokenizeRawQuery(qValues[0] || '');
    this.state.q = positive;
    for (const term of notTerms) {
      if (!this.state.textFilters.some(f => f.term === term && f.op === 'NOT')) {
        this.state.textFilters.push({ term, op: 'NOT' });
      }
    }
    this.state.country = params.getAll('country');
    this.state.repository = params.getAll('repository');
    this.state.level = params.getAll('level');
    this.state.digital_status = params.getAll('digital_status');
    // Parse date filter from URL (only one active at a time): year=1750, decade=1550, century=16
    this.state.dateFilter = null;
    const urlYear = params.get('year');
    const urlDecade = params.get('decade');
    const urlCentury = params.get('century');
    if (urlYear) {
      this.state.dateFilter = { level: 'year', label: urlYear, years: [urlYear] };
    } else if (urlDecade) {
      const base = parseInt(urlDecade, 10);
      const years = [];
      for (let i = base; i < base + 10; i++) years.push(String(i));
      this.state.dateFilter = { level: 'decade', label: this._i18n.decadeLabel.replace('{decade}', urlDecade), years };
    } else if (urlCentury) {
      const num = parseInt(urlCentury, 10);
      const base = (num - 1) * 100;
      const years = [];
      for (let i = base; i < base + 100; i++) years.push(String(i));
      this.state.dateFilter = { level: 'century', label: this._i18n.centuryLabel.replace('{roman}', this.romanCentury(num)), years };
    }
    this.state.ancestor = params.getAll('ancestor');
    this.state.entidad = params.getAll('entidad');
    this.state.sort = params.get('sort') || '';
    this.state.page = parseInt(params.get('page'), 10) || 1;
  }

  updateUrl() {
    const params = new URLSearchParams();
    if (this.state.q) params.append('q', this.state.q);
    for (const f of this.state.textFilters) {
      params.append('q', f.op === 'NOT' ? `-${f.term}` : f.term);
    }
    for (const c of this.state.country) {
      params.append('country', c);
    }
    for (const repo of this.state.repository) {
      params.append('repository', repo);
    }
    for (const level of this.state.level) {
      params.append('level', level);
    }
    for (const ds of this.state.digital_status) {
      params.append('digital_status', ds);
    }
    if (this.state.dateFilter) {
      const df = this.state.dateFilter;
      if (df.level === 'year') params.set('year', df.years[0]);
      else if (df.level === 'decade') params.set('decade', df.years[0]);
      else if (df.level === 'century') {
        const firstYear = parseInt(df.years[0], 10);
        params.set('century', String(Math.floor(firstYear / 100) + 1));
      }
    }
    for (const a of this.state.ancestor) {
      params.append('ancestor', a);
    }
    for (const e of this.state.entidad) params.append('entidad', e);
    if (this.state.sort) params.set('sort', this.state.sort);
    if (this.state.page > 1) params.set('page', this.state.page);

    const qs = params.toString();
    const url = qs ? `/buscar/?${qs}` : '/buscar/';
    history.pushState(null, '', url);
  }

  async search() {
    // Pagefind is lazy-loaded. init() no longer blocks on
    // pagefind.init(); the landing path uses static this.globalFilters
    // from /buscar-facets.json. Non-landing branches below call
    // ensurePagefindLoaded() before the first this.pagefind use.

    // Build combined query from main query + AND text filters + NOT text filters.
    // NOT terms are re-attached as `-term` so Pagefind's
    // native query-level exclusion engages (`cacique -tunja` → 84 vs 537).
    // Previously NOT was display-only, which made the reported count wrong.
    const andTerms = this.state.textFilters.filter(f => f.op === 'AND').map(f => f.term);
    const notTerms = this.state.textFilters.filter(f => f.op === 'NOT').map(f => f.term);
    const positiveQuery = [this.state.q, ...andTerms].filter(Boolean).join(' ');
    const notSuffix = notTerms.map(t => `-${t}`).join(' ');
    const combinedQuery = [positiveQuery, notSuffix].filter(Boolean).join(' ').trim();

    // Check if any filters are active
    const hasActiveFilters = this.state.country.length > 0 ||
      this.state.repository.length > 0 ||
      this.state.level.length > 0 ||
      this.state.digital_status.length > 0 ||
      this.state.dateFilter !== null ||
      this.state.ancestor.length > 0 ||
      this.state.entidad.length > 0 ||
      notTerms.length > 0;

    // Bare-NOT guard: NOT terms supplied without any positive query or
    // facet filter produces unreliable Pagefind output (bare '-tunja'
    // returns a non-intuitive 7002 matches rather than "everything
    // except Tunja"). Render an empty state with a UX hint.
    const onlyNotTerms = notTerms.length > 0 && !positiveQuery &&
      !this.state.country.length && !this.state.repository.length &&
      !this.state.level.length && !this.state.digital_status.length &&
      !this.state.dateFilter && !this.state.ancestor.length &&
      !this.state.entidad.length;
    if (onlyNotTerms) {
      const data = {
        hits: [],
        filters: this.globalFilters,
        total: 0,
        page: 1,
        total_pages: 0,
        query: combinedQuery,
        emptyReason: 'only-not',
      };
      this.renderSearchResults(data);
      return;
    }

    const isLanding = !combinedQuery && !hasActiveFilters;

    this.showLoading();
    // Force browser to paint the spinner before Pagefind's WASM blocks the main thread
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      if (isLanding) {
        // No query, no filters — show sidebar from static /buscar-facets.json.
        // No Pagefind load needed on this path.
        const data = {
          hits: [],
          filters: this.globalFilters,
          total: 0,
          page: 1,
          total_pages: 0,
          query: '',
          landing: true
        };
        this.renderSearchResults(data);
        return;
      }

      // Browse-prompt short-circuit.
      // Filter-only queries whose estimated result set exceeds the 10k
      // threshold render the browse-prompt synchronously from the static
      // sidecar (this.globalFilters), WITHOUT loading Pagefind.
      // estimateFilterCount (defined below in the utilities section)
      // takes the conservative min sum across active filter dimensions
      // against this.globalFilters. `this.skipBrowsePrompt` is set by the
      // "Ver todos" click handler so the user can force the full Pagefind
      // path on demand.
      if (!combinedQuery && hasActiveFilters && !this.skipBrowsePrompt &&
          this.estimateFilterCount() > 10000) {
        // Derive scoped intersection counts from the pivot sidecar when
        // exactly one filter dimension is active. Returns null for 0 or
        // 2+ active dimensions, in which case we fall back to
        // this.globalFilters (global totals).
        const pivotScoped = this.buildPivotScopedFilters();
        const data = {
          hits: [],
          filters: pivotScoped || this.globalFilters,
          total: this.estimateFilterCount(),
          page: 1,
          total_pages: 0,
          query: '',
          browsePrompt: true
        };
        this.renderSearchResults(data);
        return;
      }

      // Lazy-load Pagefind on first real interaction.
      // Previously Pagefind was eagerly loaded in init() which paid the
      // WASM tax (~13s cold on the descriptions bundle) even when users
      // just landed and scrolled.
      try {
        await this.ensurePagefindLoaded();
      } catch (e) {
        this.showError();
        return;
      }

      // Resolve dateFilter years against actual index data
      // (URL-loaded filters may contain years that don't exist in the index)
      if (this.state.dateFilter && this.globalFilters.year) {
        const indexYears = new Set(Object.keys(this.globalFilters.year));
        this.state.dateFilter.years = this.state.dateFilter.years.filter(y => indexYears.has(y));
      }

      // Capture the Ver-todos intent BEFORE the reset on the next line.
      // The post-Pagefind `shouldBrowsePrompt` predicate below reads this
      // captured copy so an explicit `Ver todos` click is not wiped
      // mid-flight by the reset — otherwise the user would pay the
      // Pagefind WASM tax and still be returned to the prompt they
      // tried to dismiss.
      const wasSkipBrowsePrompt = this.skipBrowsePrompt;

      // Reset the override so future filter changes re-evaluate the threshold
      this.skipBrowsePrompt = false;

      // Build Pagefind filters
      // Note: Pagefind arrays are AND (all must match). Use { any: [...] }
      // for OR (match any). Single values work either way.
      const pfFilters = {};
      if (this.state.country.length) pfFilters.country = { any: this.state.country };
      if (this.state.repository.length) pfFilters.repository = { any: this.state.repository };
      if (this.state.level.length) pfFilters.level = { any: this.state.level };
      if (this.state.digital_status.length) pfFilters.digital_status = { any: this.state.digital_status };
      if (this.state.dateFilter && this.state.dateFilter.years.length) {
        pfFilters.year = { any: this.state.dateFilter.years };
      }
      if (this.state.ancestor.length) pfFilters.ancestor = { any: this.state.ancestor };
      if (this.state.entidad.length) pfFilters.entidad = { any: this.state.entidad };

      // Build Pagefind sort
      const pfSort = {};
      if (this.state.sort) {
        const [field, dir] = this.state.sort.split(':');
        // Map our sort field names to Pagefind attribute names
        const pfField = field === 'date_start_year' ? 'date' : field;
        pfSort[pfField] = dir;
      }

      // Pass null when no query text (filter-only search)
      const search = await this.pagefind.search(combinedQuery || null, {
        filters: Object.keys(pfFilters).length ? pfFilters : undefined,
        sort: Object.keys(pfSort).length ? pfSort : undefined
      });

      const total = search.results.length;
      const totalPages = Math.ceil(total / this.perPage);

      // For filter-only queries with very large result sets, still
      // render the browse prompt UX but use the **scoped** facet
      // payloads from this search call for the sidebar,
      // so cross-faceting (e.g. País → narrows Repositorio) is honoured
      // without forcing the user to click "Ver todos" first. Only the
      // per-result fragment fetch (r.data() below) is skipped — the
      // Pagefind search itself has already run and computed facet counts.
      const shouldBrowsePrompt = !combinedQuery && hasActiveFilters &&
        total > 10000 && !wasSkipBrowsePrompt;

      // Lazy-load the current page of result fragments (skipped when
      // browsing-prompt defers materialization).
      const pageResults = shouldBrowsePrompt
        ? []
        : search.results.slice((this.state.page - 1) * this.perPage,
                               (this.state.page - 1) * this.perPage + this.perPage);
      const hits = await Promise.all(pageResults.map(r => r.data()));

      // Per-value selection via selectFacetCounts: facet keys with NO
      // active filter read from `search.filters` (cross-facet narrowing);
      // facet keys WITH an active filter read from `search.totalFilters`
      // (same-facet OR-group siblings and the active value's own restore
      // count). An earlier single-source `search.filters ||
      // this.globalFilters` flatten was the visible cause of the sidebar
      // appearing to freeze on click.
      const scopedFilters = {};
      if (search) {
        const facetKeys = new Set([
          ...Object.keys((search.filters) || {}),
          ...Object.keys((search.totalFilters) || {}),
        ]);
        for (const fk of facetKeys) {
          scopedFilters[fk] = {};
          const allValues = new Set([
            ...Object.keys((search.filters && search.filters[fk]) || {}),
            ...Object.keys((search.totalFilters && search.totalFilters[fk]) || {}),
          ]);
          for (const v of allValues) {
            scopedFilters[fk][v] = selectFacetCounts(search, fk, v, this.state);
          }
        }
      }
      // Defensive fallback if Pagefind returned no facet payloads at all.
      if (Object.keys(scopedFilters).length === 0) {
        Object.assign(scopedFilters, this.globalFilters || {});
      }

      // Normalise into the shape renderSearchResults expects
      const data = {
        hits,
        filters: scopedFilters,
        total,
        page: shouldBrowsePrompt ? 1 : this.state.page,
        total_pages: shouldBrowsePrompt ? 0 : totalPages,
        query: combinedQuery,
        browsePrompt: shouldBrowsePrompt
      };

      this.renderSearchResults(data);
    } catch (error) {
      console.error('Search error:', error);
      this.showError();
    }
  }

  // --- Rendering ---

  renderSearchResults(data) {
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
    mobileToggle.innerHTML = this._i18n.filterToggle + ' <span class="toggle-chevron">&#9660;</span>';
    mobileToggle.addEventListener('click', () => {
      const sidebar = this.container.querySelector('.search-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('sidebar-open');
        mobileToggle.classList.toggle('toggle-open');
      }
    });
    resultsCol.appendChild(mobileToggle);

    // Landing state: show search prompt in results column
    if (data.landing) {
      const landing = document.createElement('div');
      landing.className = 'search-empty-query';

      const logo = document.createElement('img');
      logo.src = '/img/zasqua-3-burgundy-sm.svg';
      logo.alt = 'Zasqua';
      logo.className = 'search-landing-logo';
      landing.appendChild(logo);

      const hints = document.createElement('div');
      hints.className = 'search-landing-hints';
      hints.innerHTML =
        '<p>' + this._i18n.landingP1 + '</p>' +
        '<p>' + this._i18n.landingP2 + '</p>';
      landing.appendChild(hints);

      resultsCol.appendChild(landing);

      // Sidebar + results
      const sidebar = this.renderFacets(data);
      layout.appendChild(sidebar);
      layout.appendChild(resultsCol);
      this.container.appendChild(layout);
      return;
    }

    // Browse prompt: filter-only query with too many results for Pagefind
    if (data.browsePrompt) {
      const pills = this.renderPills();
      if (pills) resultsCol.appendChild(pills);

      const prompt = document.createElement('div');
      prompt.className = 'search-browse-prompt';

      const countText = document.createElement('p');
      countText.className = 'browse-prompt-count';
      countText.innerHTML = this._i18n.browsePromptCount.replace('{count}', `<strong>${this._fmt.format(data.total)}</strong>`);
      prompt.appendChild(countText);

      const hint = document.createElement('p');
      hint.className = 'browse-prompt-hint';
      hint.textContent = this._i18n.browsePromptHint;
      prompt.appendChild(hint);

      const continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'browse-prompt-btn';
      continueBtn.textContent = this._i18n.viewAll;
      continueBtn.addEventListener('click', () => {
        this.skipBrowsePrompt = true;
        this.search();
      });
      prompt.appendChild(continueBtn);

      const warning = document.createElement('p');
      warning.className = 'browse-prompt-warning';
      warning.textContent = this._i18n.browsePromptWarning;
      prompt.appendChild(warning);

      resultsCol.appendChild(prompt);

      const sidebar = this.renderFacets(data);
      layout.appendChild(sidebar);
      layout.appendChild(resultsCol);
      this.container.appendChild(layout);
      return;
    }

    // Results info bar
    resultsCol.appendChild(this.renderResultsInfo(data));

    // Active filter pills
    const pills = this.renderPills();
    if (pills) resultsCol.appendChild(pills);

    // Result items
    if (data.hits.length === 0) {
      resultsCol.appendChild(this.renderNoResults(data));
    } else {
      const resultsList = document.createElement('div');
      resultsList.className = 'search-results-list';
      // NOT terms are now applied at the Pagefind query level
      // (see search() — `-term` suffix in combinedQuery). The display-side
      // filter below is a safety net; Pagefind has already excluded matches.
      const notTerms = this.state.textFilters
        .filter(f => f.op === 'NOT')
        .map(f => f.term.toLowerCase());
      for (const hit of data.hits) {
        const card = this.renderResultCard(hit, data.query);
        if (notTerms.length > 0) {
          const text = card.textContent.toLowerCase();
          if (notTerms.some(t => text.includes(t))) {
            card.style.display = 'none';
          }
        }
        resultsList.appendChild(card);
      }
      resultsCol.appendChild(resultsList);
    }

    // Pagination
    if (data.total_pages > 1) {
      resultsCol.appendChild(this.renderPagination(data));
    }

    // Sidebar
    const sidebar = this.renderFacets(data);
    layout.appendChild(sidebar);

    layout.appendChild(resultsCol);

    this.container.appendChild(layout);
  }

  renderResultsInfo(data) {
    const info = document.createElement('div');
    info.className = 'results-info search-results-info';

    const count = document.createElement('span');
    count.className = 'results-count';
    count.textContent = this._i18n.resultsCount.replace('{count}', this._fmt.format(data.total));
    info.appendChild(count);

    // Sort buttons
    const sortWrap = document.createElement('div');
    sortWrap.className = 'sort-wrap';

    const sortLabel = document.createElement('span');
    sortLabel.className = 'sort-label';
    sortLabel.textContent = this._i18n.sortBy;
    sortWrap.appendChild(sortLabel);

    const sortOptions = [
      { field: 'date_start_year', label: this._i18n.sortDate },
      { field: 'title', label: this._i18n.sortTitle },
      { field: 'reference_code', label: this._i18n.sortCode },
      { field: '', label: this._i18n.sortRelevance }
    ];

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

      const currentField = this.state.sort ? this.state.sort.split(':')[0] : '';
      const currentDir = this.state.sort ? this.state.sort.split(':')[1] : '';
      const isActive = opt.field === '' ? !this.state.sort : currentField === opt.field;

      if (isActive) btn.classList.add('active');

      btn.textContent = opt.label;

      if (opt.field) {
        const arrow = document.createElement('span');
        arrow.className = 'sort-arrow';
        if (isActive) {
          arrow.textContent = currentDir === 'desc' ? ' \u2193' : ' \u2191';
        } else {
          arrow.textContent = ' \u2191';
        }
        btn.appendChild(arrow);
      }

      btn.addEventListener('click', () => {
        if (opt.field === '') {
          this.handleSort('');
        } else if (isActive) {
          const newDir = currentDir === 'asc' ? 'desc' : 'asc';
          this.handleSort(`${opt.field}:${newDir}`);
        } else {
          this.handleSort(`${opt.field}:asc`);
        }
      });

      sortWrap.appendChild(btn);
    });

    info.appendChild(sortWrap);

    return info;
  }

  renderRefineInput() {
    const wrap = document.createElement('div');
    wrap.className = 'refine-search';

    let currentOp = 'AND';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this._i18n.refinePlaceholder;

    const addTerm = () => {
      const term = input.value.trim();
      if (!term) return;
      const exists = this.state.textFilters.some(f => f.term === term && f.op === currentOp);
      if (!exists) {
        this.state.textFilters.push({ term, op: currentOp });
        this.state.page = 1;
        input.value = '';
        this.updateUrl();
        this.search();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTerm();
      }
    });
    wrap.appendChild(input);

    // Divider
    const divider = document.createElement('span');
    divider.className = 'refine-divider';
    wrap.appendChild(divider);

    // Operator selector
    const opWrap = document.createElement('div');
    opWrap.className = 'refine-op';

    const opBtn = document.createElement('button');
    opBtn.type = 'button';
    opBtn.className = 'refine-op-btn';
    opBtn.innerHTML = this._i18n.opYes + ' <span class="refine-op-caret">\u25BE</span>';

    const opMenu = document.createElement('div');
    opMenu.className = 'refine-op-menu';
    opMenu.style.display = 'none';

    const options = [
      { value: 'AND', label: this._i18n.opYes },
      { value: 'NOT', label: this._i18n.opNo }
    ];
    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'refine-op-option';
      item.textContent = opt.label;
      item.addEventListener('click', () => {
        currentOp = opt.value;
        opBtn.innerHTML = `${opt.label} <span class="refine-op-caret">\u25BE</span>`;
        opMenu.style.display = 'none';
      });
      opMenu.appendChild(item);
    }

    opBtn.addEventListener('click', () => {
      opMenu.style.display = opMenu.style.display === 'none' ? '' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!opWrap.contains(e.target)) {
        opMenu.style.display = 'none';
      }
    });

    opWrap.appendChild(opBtn);
    opWrap.appendChild(opMenu);
    wrap.appendChild(opWrap);

    // Divider
    const divider2 = document.createElement('span');
    divider2.className = 'refine-divider';
    wrap.appendChild(divider2);

    // Add button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'refine-add-btn';
    addBtn.innerHTML = '+';
    addBtn.setAttribute('aria-label', this._i18n.addTextFilter);
    addBtn.addEventListener('click', addTerm);
    wrap.appendChild(addBtn);

    return wrap;
  }

  renderResultCard(hit, query) {
    const item = document.createElement('div');
    item.className = 'result-item';

    // Title — Pagefind auto-captures from h1 as hit.meta.title
    const title = document.createElement('h3');
    title.className = 'result-title';
    const link = document.createElement('a');
    link.href = hit.url;
    link.innerHTML = this.highlightTerms(this.escapeHtml(hit.meta.title || ''), query);
    title.appendChild(link);
    item.appendChild(title);

    // Meta line: level badge + reference code + date
    const meta = document.createElement('div');
    meta.className = 'result-meta';

    const descLevel = hit.meta.description_level || '';
    const levelLabel = this.levelLabels[descLevel] || descLevel;
    const badge = document.createElement('span');
    badge.className = 'level-badge';
    badge.textContent = levelLabel;
    meta.appendChild(badge);

    if (hit.meta.reference_code) {
      const sep1 = document.createTextNode(' \u00B7 ');
      meta.appendChild(sep1);
      const refCode = document.createElement('span');
      refCode.textContent = hit.meta.reference_code;
      meta.appendChild(refCode);
    }

    if (hit.meta.date_formatted) {
      const sep2 = document.createTextNode(' \u00B7 ');
      meta.appendChild(sep2);
      const date = document.createElement('span');
      date.textContent = hit.meta.date_formatted;
      meta.appendChild(date);
    }

    item.appendChild(meta);

    // Snippet — Pagefind provides highlighted excerpt
    if (hit.excerpt) {
      const snippet = document.createElement('div');
      snippet.className = 'result-snippet';
      snippet.innerHTML = this.truncateHtml(hit.excerpt, 200);
      item.appendChild(snippet);
    }

    // Repository name
    if (hit.meta.repository_name) {
      const repo = document.createElement('div');
      repo.className = 'result-repo';
      repo.textContent = hit.meta.repository_name;
      item.appendChild(repo);
    }

    return item;
  }

  renderFacets(data) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'search-sidebar';

    // Mobile filter panel header (hidden on desktop via CSS)
    const panelHeader = document.createElement('div');
    panelHeader.className = 'filter-panel-header';
    panelHeader.innerHTML =
      '<span class="filter-panel-title">' + this._i18n.sidebarHeading + '</span>' +
      '<button class="filter-panel-close" type="button" aria-label="' + this._i18n.closeFilters + '">' +
      '<span class="material-symbols-outlined">close</span></button>';
    sidebar.appendChild(panelHeader);

    // Heading (visible on desktop, hidden on mobile when panel is open)
    const heading = document.createElement('h3');
    heading.className = 'search-sidebar-heading';
    heading.textContent = this._i18n.sidebarHeading;
    sidebar.appendChild(heading);

    // Activar filtros avanzados toggle. Only renders when
    // the user arrived via an ancestor/entidad deep-link (from /repository/,
    // /descripcion/, or /entidad/ pages) or has already activated advanced
    // mode this session. Returns null otherwise; fresh /buscar/ visits
    // don't see this prompt.
    const advancedToggle = this.renderAdvancedFiltersToggle();
    if (advancedToggle) sidebar.appendChild(advancedToggle);

    // Refine search input
    sidebar.appendChild(this.renderRefineInput());

    const filters = data.filters || {};

    // Country facet
    if (filters.country) {
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.facetCountry,
        'country',
        filters.country,
        this.state.country,
        (name) => name
      ));
    }

    // Repository facet — keyed by display name, no mapping needed
    if (filters.repository) {
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.facetRepository,
        'repository',
        filters.repository,
        this.state.repository,
        (name) => name  // already display names
      ));
    }

    // Digital status facet
    if (filters.digital_status) {
      const digitalLabels = {
        'zasqua': this._i18n.digitalStatusInZasqua,
        'external': this._i18n.digitalStatusExternal,
        'none': this._i18n.digitalStatusNone
      };
      const digitalOrder = ['zasqua', 'external', 'none'];
      const digitalSort = (a, b) => {
        const ai = digitalOrder.indexOf(a[0]);
        const bi = digitalOrder.indexOf(b[0]);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b[1] - a[1];
      };
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.digitalStatusGroup,
        'digital_status',
        filters.digital_status,
        this.state.digital_status,
        (value) => digitalLabels[value] || value,
        digitalSort
      ));
    }

    // Level facet — keyed by canonical code, sorted by archival hierarchy.
    // Display labels resolve from this.levelLabels (data-level-labels blob, code→label).
    if (filters.level) {
      const levelOrder = ['fonds', 'subfonds', 'collection', 'section', 'series', 'subseries', 'file', 'volume', 'item'];
      const levelSort = (a, b) => {
        const ai = levelOrder.indexOf(a[0]);
        const bi = levelOrder.indexOf(b[0]);
        // Known levels first in hierarchy order, unknown levels last by count
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b[1] - a[1];
      };
      const levelLabels = this.levelLabels;
      sidebar.appendChild(this.renderFacetGroup(
        this._i18n.facetLevel,
        'level',
        filters.level,
        this.state.level,
        (code) => levelLabels[code] || code,
        levelSort
      ));
    }

    // Date tree (century → decade → year) — only show if any years have results
    if (filters.year && Object.values(filters.year).some(c => c > 0)) {
      sidebar.appendChild(this.renderDateTree(filters.year));
    }

    // advanced facet groups (ancestor + entidad). Rendered
    // only when the user has opted into advanced mode via the toggle above.
    // Capped at TOP_N=20 by count plus any active values — ancestor alone
    // has ~400K distinct values; the sidebar is not a browsable catalogue.
    // Count source priority: scoped `filters.*` from the current search
    // (cross-faceted against active filters), then `advancedGlobalFilters`
    // from the initial pagefind.filters() call.
    if (this.advancedFiltersActive) {
      const TOP_N_ADVANCED = 20;
      const topN = (counts, active) => {
        if (!counts) return {};
        const entries = Object.entries(counts);
        entries.sort((a, b) => b[1] - a[1]);
        const top = new Map(entries.slice(0, TOP_N_ADVANCED));
        for (const v of active) {
          if (!top.has(v) && counts[v] != null) top.set(v, counts[v]);
        }
        return Object.fromEntries(top);
      };

      const ancestorCounts = (filters.ancestor && Object.keys(filters.ancestor).length)
        ? filters.ancestor
        : (this.advancedGlobalFilters && this.advancedGlobalFilters.ancestor) || {};
      const ancestorTop = topN(ancestorCounts, this.state.ancestor);
      if (Object.keys(ancestorTop).length > 0) {
        sidebar.appendChild(this.renderFacetGroup(
          this._i18n.facetAncestor,
          'ancestor',
          ancestorTop,
          this.state.ancestor,
          (code) => code
        ));
      }

      const entidadCounts = (filters.entidad && Object.keys(filters.entidad).length)
        ? filters.entidad
        : (this.advancedGlobalFilters && this.advancedGlobalFilters.entidad) || {};
      const entidadTop = topN(entidadCounts, this.state.entidad);
      if (Object.keys(entidadTop).length > 0) {
        sidebar.appendChild(this.renderFacetGroup(
          this._i18n.facetEntity,
          'entidad',
          entidadTop,
          this.state.entidad,
          (code) => code
        ));
      }
    }

    // Mobile filter panel bottom close (hidden on desktop via CSS)
    const panelBottom = document.createElement('div');
    panelBottom.className = 'filter-panel-bottom-close';
    panelBottom.innerHTML =
      '<button type="button">' +
      '<span class="material-symbols-outlined">expand_less</span> ' + this._i18n.closeFilters + '</button>';
    sidebar.appendChild(panelBottom);

    // Wire up panel close handlers
    const closePanel = () => {
      sidebar.classList.remove('sidebar-open');
      const toggle = this.container.querySelector('.mobile-filter-toggle');
      if (toggle) toggle.classList.remove('toggle-open');
    };
    panelHeader.querySelector('.filter-panel-close').addEventListener('click', closePanel);
    panelBottom.querySelector('button').addEventListener('click', closePanel);

    return sidebar;
  }

  renderAdvancedFiltersToggle() {
    // Only render the toggle when the user arrived via a deep-link that
    // uses the advanced filter keys (ancestor / entidad) OR already opted
    // into advanced mode this session. A fresh /buscar/ visit shows no
    // toggle — composing by ancestor/entidad is not a general affordance,
    // only a follow-through for users who arrived from a
    // /repository/, /descripcion/, or /entidad/ page.
    const deepLinkActive = this.state.ancestor.length > 0 || this.state.entidad.length > 0;
    if (!deepLinkActive && !this.advancedFiltersActive) return null;

    const wrap = document.createElement('div');
    wrap.className = 'advanced-filters-toggle';

    if (this.advancedFiltersActive) {
      const label = document.createElement('span');
      label.className = 'advanced-filters-status';
      label.textContent = this._i18n.advancedActive;
      wrap.appendChild(label);

      const disable = document.createElement('button');
      disable.type = 'button';
      disable.className = 'advanced-filters-disable';
      disable.textContent = this._i18n.advancedDisable;
      disable.addEventListener('click', () => {
        this.advancedFiltersActive = false;
        this.advancedGlobalFilters = null;
        this.search();
      });
      wrap.appendChild(disable);
      return wrap;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'advanced-filters-activate';
    btn.textContent = this._i18n.advancedActivate;

    const note = document.createElement('span');
    note.className = 'advanced-filters-note';
    note.textContent = this._i18n.advancedActivateNote;
    btn.appendChild(note);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = this._i18n.loadingFilters;
      try {
        await this.ensurePagefindLoaded();
        this.advancedGlobalFilters = await this.pagefind.filters();
        this.advancedFiltersActive = true;
        this.facetGroupState.ancestor = true;
        this.facetGroupState.entidad = true;
        this.search();
      } catch (e) {
        console.error('Advanced filters load failed:', e);
        btn.disabled = false;
        btn.textContent = this._i18n.advancedActivate;
        btn.appendChild(note);
      }
    });

    wrap.appendChild(btn);
    return wrap;
  }

  renderFacetGroup(title, stateKey, facetData, activeValues, labelFn, sortFn) {
    const group = document.createElement('div');
    group.className = 'facet-group';

    const isOpen = this.facetGroupState[stateKey] !== false;

    // Toggle button
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

    // Content
    const content = document.createElement('div');
    content.className = 'facet-group-content';
    content.style.display = isOpen ? '' : 'none';

    // Sort facet entries: active first, then custom sort or count descending
    const entries = Object.entries(facetData).sort((a, b) => {
      const aActive = activeValues.includes(a[0]) ? 1 : 0;
      const bActive = activeValues.includes(b[0]) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (sortFn) return sortFn(a, b);
      return b[1] - a[1];
    });

    // Exclusive drill-down: when a value is selected, hide the rest
    const hasActive = activeValues.length > 0;

    for (const [value, count] of entries) {
      if (hasActive && !activeValues.includes(value)) continue;
      // Hide values with zero results (unless currently active)
      if (count === 0 && !activeValues.includes(value)) continue;
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
    }

    group.appendChild(content);
    return group;
  }

  renderDateTree(yearData) {
    const group = document.createElement('div');
    group.className = 'facet-group';

    const isOpen = this.facetGroupState.date !== false;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'facet-group-toggle';
    toggle.innerHTML = '<span class="facet-group-title">' + this._i18n.dateInitial + '</span><span class="facet-group-indicator">' + (isOpen ? '\u2212' : '+') + '</span>';
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

    // Build hierarchy from flat year data: { "1622": 1, "1750": 45, ... }
    const centuries = new Map();

    for (const [yearStr, count] of Object.entries(yearData)) {
      const year = parseInt(yearStr, 10);
      if (isNaN(year)) continue;
      if (count === 0) continue;  // Hide years with zero results
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

      // Drill-down: if a century is selected, only show that century
      if (df && df.level === 'century' && df.label !== centuryLabel) continue;
      if (df && (df.level === 'decade' || df.level === 'year')) {
        // Check if this century contains the selected decade/year
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
      // Auto-expand when selected or when a child is selected
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
      countSpan.textContent = `(${this._fmt.format(centuryData.total)})`;

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
        const decadeLabel = this._i18n.decadeLabel.replace('{decade}', decadeBase);
        const decadeExistingYears = Array.from(yearsMap.keys());

        // Drill-down: if a decade is selected, only show that decade
        if (df && df.level === 'decade' && df.label !== decadeLabel) continue;
        if (df && df.level === 'year') {
          const selectedDecade = Math.floor(parseInt(df.years[0], 10) / 10) * 10;
          if (selectedDecade !== decadeBase) continue;
        }

        let decadeTotal = 0;
        for (const c of yearsMap.values()) decadeTotal += c;

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
          // Drill-down: if a year is selected, only show that year
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

  handleDateSelect(filter) {
    this.state.dateFilter = filter;
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  romanCentury(num) {
    const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX',
      'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX',
      'XX', 'XXI', 'XXII'];
    return romans[num] || String(num);
  }

  renderPills() {
    const hasFilters = this.state.q ||
      this.state.textFilters.length > 0 ||
      this.state.country.length > 0 ||
      this.state.repository.length > 0 ||
      this.state.level.length > 0 ||
      this.state.digital_status.length > 0 ||
      this.state.dateFilter !== null ||
      this.state.ancestor.length > 0 ||
      this.state.entidad.length > 0;

    if (!hasFilters) return null;

    const container = document.createElement('div');
    container.className = 'active-filters';

    // Main query pill
    if (this.state.q) {
      container.appendChild(this.createPill(
        `\u201C${this.state.q}\u201D`,
        () => {
          // Promote the first AND text filter to main query, if any
          const nextAnd = this.state.textFilters.find(f => f.op === 'AND');
          if (nextAnd) {
            this.state.q = nextAnd.term;
            this.state.textFilters = this.state.textFilters.filter(t => t !== nextAnd);
          } else {
            this.state.q = '';
          }
          this.state.page = 1;
          this.updateUrl();
          this.search();
        }
      ));
    }

    // Text filter chips
    for (const f of this.state.textFilters) {
      const prefix = f.op === 'NOT' ? this._i18n.notPrefix : '';
      container.appendChild(this.createPill(
        `${prefix}\u201C${f.term}\u201D`,
        () => {
          this.state.textFilters = this.state.textFilters.filter(t => t !== f);
          this.state.page = 1;
          this.updateUrl();
          this.search();
        }
      ));
    }

    // Country pills
    for (const c of this.state.country) {
      container.appendChild(this.createPill(
        c,
        () => this.handlePillRemove('country', c)
      ));
    }

    // Repository pills — display names directly
    for (const repo of this.state.repository) {
      container.appendChild(this.createPill(
        repo,
        () => this.handlePillRemove('repository', repo)
      ));
    }

    // Level pills — resolve display label from canonical code via levelLabels blob
    for (const level of this.state.level) {
      const levelPillLabel = this.levelLabels[level] || level;
      container.appendChild(this.createPill(
        levelPillLabel,
        () => this.handlePillRemove('level', level)
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

    // Ancestor filter pills
    for (const a of this.state.ancestor) {
      container.appendChild(this.createPill(
        a,
        () => this.handlePillRemove('ancestor', a)
      ));
    }

    // Entidad filter pills
    for (const e of this.state.entidad) {
      container.appendChild(this.createPill(
        e,
        () => this.handlePillRemove('entidad', e)
      ));
    }

    // Digital status pills
    const digitalPillLabels = {
      'zasqua': this._i18n.digitalPillInZasqua,
      'external': this._i18n.digitalPillExternal,
      'none': this._i18n.digitalPillNone
    };
    for (const ds of this.state.digital_status) {
      container.appendChild(this.createPill(
        digitalPillLabels[ds] || ds,
        () => this.handlePillRemove('digital_status', ds)
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

    // Previous
    if (currentPage > 1) {
      nav.appendChild(this.createPageLink('\u00AB', currentPage - 1));
    } else {
      nav.appendChild(this.createPageSpan('\u00AB', true));
    }

    // Page numbers with ellipsis
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

    // Next
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

    const pages = [];
    pages.push(1);

    if (current > 3) {
      pages.push('...');
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (current < total - 2) {
      pages.push('...');
    }

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

  renderNoResults(data) {
    const div = document.createElement('div');
    div.className = 'search-no-results';

    const msg = document.createElement('p');
    // Tailored message when the user typed only NOT terms.
    if (data && data.emptyReason === 'only-not') {
      msg.textContent = this._i18n.onlyNotMessage;
    } else {
      msg.textContent = this._i18n.noResults;
    }
    div.appendChild(msg);

    const hasFilters = this.state.country.length > 0 ||
      this.state.repository.length > 0 ||
      this.state.level.length > 0 ||
      this.state.digital_status.length > 0;

    if (hasFilters) {
      const suggestion = document.createElement('p');
      suggestion.className = 'no-results-suggestion';
      suggestion.textContent = this._i18n.noResultsSuggestion;
      div.appendChild(suggestion);

      const clearLink = document.createElement('a');
      clearLink.href = '#';
      clearLink.textContent = this._i18n.clearFilters;
      clearLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleClearAll();
      });
      div.appendChild(clearLink);
    }

    return div;
  }

  // --- State displays ---

  showLoading() {
    // If results already rendered, overlay a loading state without wiping the layout
    const existingResults = this.container.querySelector('.search-results');
    if (existingResults) {
      existingResults.classList.add('results-loading');
      // Add or reuse a spinner overlay
      if (!existingResults.querySelector('.search-loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'search-loading-overlay';
        overlay.innerHTML = '<div class="search-spinner" aria-busy="true"></div>';
        existingResults.appendChild(overlay);
      }
      return;
    }
    // First load: show centered spinner
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
    msg.textContent = this._i18n.error;
    div.appendChild(msg);

    const retry = document.createElement('a');
    retry.href = '#';
    retry.textContent = this._i18n.searchRetry;
    retry.addEventListener('click', (e) => {
      e.preventDefault();
      this.search();
    });
    div.appendChild(retry);

    this.container.appendChild(div);
  }




  // --- Event handlers ---

  handleFilterChange(stateKey, value, checked) {
    // Exclusive drill-down: selecting a value hides all others
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

  handleClearAll() {
    this.state.textFilters = [];
    this.state.country = [];
    this.state.repository = [];
    this.state.level = [];
    this.state.digital_status = [];
    this.state.dateFilter = null;
    this.state.ancestor = [];
    this.state.entidad = [];
    this.state.page = 1;
    this.updateUrl();
    this.search();
  }

  handleSort(value) {
    this.state.sort = value;
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

  /**
   * Estimate the result count for the current filters using global filter counts.
   * Takes the minimum sum across active filter dimensions (conservative estimate,
   * since filters are AND'd across facets).
   */
  estimateFilterCount() {
    const counts = [];

    if (this.state.country.length && this.globalFilters.country) {
      let sum = 0;
      for (const name of this.state.country) {
        sum += this.globalFilters.country[name] || 0;
      }
      counts.push(sum);
    }

    if (this.state.repository.length && this.globalFilters.repository) {
      let sum = 0;
      for (const name of this.state.repository) {
        sum += this.globalFilters.repository[name] || 0;
      }
      counts.push(sum);
    }

    if (this.state.level.length && this.globalFilters.level) {
      let sum = 0;
      for (const name of this.state.level) {
        sum += this.globalFilters.level[name] || 0;
      }
      counts.push(sum);
    }

    if (this.state.digital_status.length && this.globalFilters.digital_status) {
      let sum = 0;
      for (const val of this.state.digital_status) {
        sum += this.globalFilters.digital_status[val] || 0;
      }
      counts.push(sum);
    }

    if (this.state.dateFilter && this.state.dateFilter.years.length && this.globalFilters.year) {
      let sum = 0;
      for (const y of this.state.dateFilter.years) {
        sum += this.globalFilters.year[y] || 0;
      }
      counts.push(sum);
    }

    if (this.state.ancestor.length && this.globalFilters.ancestor) {
      let sum = 0;
      for (const a of this.state.ancestor) {
        sum += this.globalFilters.ancestor[a] || 0;
      }
      counts.push(sum);
    }

    return counts.length ? Math.min(...counts) : 0;
  }

  /**
   * Build a scoped filters object for the synchronous browse-prompt
   * render. Delegates to the pure module-level
   * `buildPivotScopedFiltersPure` helper (exported for unit tests at
   * `tests/pagefind-facets.test.js`) so the method below stays a thin
   * adapter over `this.state / this.pivots / this.triples /
   * this.globalFilters`.
   *
   * Dispatch by number of active pivot dimensions:
   *   - 0 active → null (isLanding branch handles it).
   *   - 1 active → pair-wise pivot lookup in this.pivots.
   *   - 2 active → triple-wise pivot lookup in this.triples using
   *                canonical alphabetical key ordering, which resolves
   *                the two-dimension sidebar-vs-main self-contradiction
   *                on deep links like Popayán + Unidad documental.
   *   - ≥3 active → null (fall back to global totals; quad-pivot
   *                 deferred to the wishlist).
   * Caller must fall back to this.globalFilters when null is
   * returned.
   *
   * Year is passed through from globalFilters as-is on the one- and
   * two-dimension paths. The date-tree widget consumes year via a
   * separate rendering path; century and decade are in the pivot
   * sidecars so date-tree chips get scoped cold counts.
   */
  buildPivotScopedFilters() {
    const activeByKey = Object.create(null);
    for (const key of PIVOT_KEYS) {
      if (this.state[key] && this.state[key].length > 0) {
        activeByKey[key] = this.state[key];
      }
    }
    // Date filter acts as an active pivot dim too: it maps onto either
    // `century` (derived from the dateFilter level) or `decade`, both
    // of which are in PIVOT_KEYS. Year-level filters fall through to
    // globalFilters.year and are not pivot-scoped.
    if (this.state.dateFilter) {
      const df = this.state.dateFilter;
      if (df.level === 'century') {
        // dateFilter.label is "Siglo XVII" — strip the prefix.
        const roman = (df.label || '').replace(/^Siglo\s+/, '');
        if (roman) activeByKey.century = [roman];
      } else if (df.level === 'decade') {
        // dateFilter.years is ['1600','1601',…'1609'] — the pivot key
        // emits a single decade-start value ('1600'); use years[0].
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
      globalFilters: this.globalFilters,
    });
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Highlight query terms in text with <mark> tags.
   * Accent-insensitive: "Garcia" highlights "García".
   */
  highlightTerms(html, query) {
    if (!query) return html;

    const terms = query.split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return html;

    // Normalise for accent-insensitive comparison
    const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    let result = html;
    for (const term of terms) {
      const normalizedTerm = normalize(term);
      // Build a regex that matches each character with optional diacritics
      const pattern = normalizedTerm.split('').map(ch => {
        const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped + '[\u0300-\u036f]*';
      }).join('');

      try {
        const regex = new RegExp(`(${pattern})`, 'gi');
        // Only match outside existing tags
        result = result.replace(/(<[^>]*>)|([^<]+)/g, (match, tag, text) => {
          if (tag) return tag;
          return text.replace(regex, '<mark>$1</mark>');
        });
      } catch (e) {
        // If regex fails, skip this term
      }
    }

    return result;
  }

  truncateHtml(html, maxLength) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || '';

    if (text.length <= maxLength) return html;

    let charCount = 0;
    let result = '';
    let inTag = false;
    let tagBuffer = '';

    for (let i = 0; i < html.length; i++) {
      const ch = html[i];

      if (ch === '<') {
        inTag = true;
        tagBuffer = '<';
        continue;
      }

      if (inTag) {
        tagBuffer += ch;
        if (ch === '>') {
          inTag = false;
          result += tagBuffer;
          tagBuffer = '';
        }
        continue;
      }

      charCount++;
      result += ch;

      if (charCount >= maxLength) {
        result += '...';
        break;
      }
    }

    // Close any unclosed <mark> tags
    const openMarks = (result.match(/<mark>/gi) || []).length;
    const closeMarks = (result.match(/<\/mark>/gi) || []).length;
    for (let i = 0; i < openMarks - closeMarks; i++) {
      result += '</mark>';
    }

    return result;
  }
}

// Initialize when DOM is ready. Wrapped in a `typeof document` guard so
// the file can be loaded under Node/Vitest (which has no DOM) without
// throwing. In the browser `document` is always defined, so the listener
// still binds exactly as before.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('search-page');
    if (container) {
      new SearchPage(container);
    }
  });
}

// Conditional CommonJS export so `selectFacetCounts` can be unit-tested
// from `tests/pagefind-facets.test.js` under Node. The browser loads
// this file as a classic <script>; `typeof module` is undefined there,
// so the block is a no-op.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selectFacetCounts, buildPivotScopedFiltersPure, PIVOT_KEYS };
}

// Version: v1.4.0
