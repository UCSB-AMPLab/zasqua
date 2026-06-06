#!/usr/bin/env node
/**
 * Generate Pagefind Indices (Node API)
 *
 * Builds Zasqua's three client-side search bundles — descriptions,
 * entities, and places — using Pagefind's Node API rather than the
 * default HTML-scan mode. Pagefind is a client-side search engine
 * that ships a small WebAssembly runtime plus a JSON index produced
 * at build time; HTML-scan indexing would require Hugo to render all
 * 192,000 pages to disk first, then Pagefind to walk them with a
 * second pass. The Node-API approach reads the same enriched JSON
 * Hugo reads, so the JSON becomes the single source of truth and
 * template markup stops implicitly coupling to search correctness (a
 * forgotten `data-pagefind-filter` attribute used to be a silent
 * search regression).
 *
 * Alongside each corpus's Pagefind bundle, the script also emits
 * three classes of JSON sidecars consumed by the browser-side
 * explorers on their cold first-click: a landing-facets sidecar
 * (global counts by facet value), a pair-wise pivot sidecar
 * (intersection counts when one facet filter is active), and a
 * triple-wise pivot sidecar (intersection counts when two are
 * active). Each sidecar carries a 50 KB gzipped size budget; if any
 * drifts over, the build logs a warning and the CI workflow surfaces
 * it as a yellow annotation without blocking the deploy.
 *
 * Facet auto-suppression: after the per-record tally loop completes,
 * `suppressSingleValuedFacets` removes any facet key whose distinct-value
 * count is 0 or 1 before the sidecar is written — a facet that offers only
 * one choice (or none) is dead weight in the UI. The same suppressed keys
 * are excluded from the pivot and triple sidecars. A `[facets] force_keep`
 * list in zasqua.manifest.toml can re-include a suppressed key for deployers
 * who intentionally run a single-valued facet. On the Neogranadina corpus
 * every facet has multiple distinct values so nothing is suppressed.
 *
 * Module gating: the entities and places index builds are gated on
 * `manifest.modules.entities` and `manifest.modules.places` respectively.
 * When a module is disabled, its data is not loaded and its Pagefind bundle
 * and sidecars are not produced. The descriptions index is core and always
 * built.
 *
 * Pipeline context:
 *   Runs in `build.sh` after `hugo --minify`, reading
 *   `assets/hugo-data/*.json` (sharded descriptions, single-file
 *   entities and places). Writes three Pagefind bundles and their
 *   associated sidecars into `public/`. Each bundle is written to a
 *   PID-scoped temp directory and `fs.renameSync`d into place on
 *   success — a mid-build parse failure leaves no half-written
 *   bundle for the next run to pick up.
 *
 * Pagefind v1.5.2 is ESM-only; this script stays CommonJS and
 * consumes Pagefind via dynamic `import()` inside `main()`.
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so that assets/hugo-data/ and public/
 *                    resolve relative to the instance when the engine lives in
 *                    node_modules.
 *   HUGO_DATA_DIR  — override the default `assets/hugo-data/` input directory
 *   DEV_LIMIT — propagates through the enriched JSON (the upstream content
 *               step caps the shards); DEV_LIMIT bundles are smoke-test only
 *               and not valid inputs to parity tests.
 *
 * Exits 0 on success; 1 on any IO or parse error, with the failing
 * corpus, record ID, and field prefixed to stderr.
 *
 * Output paths are parameterized so the engine and instance can live in
 * separate directories: instance-relative paths resolve from INSTANCE_ROOT
 * (or process.cwd() as a fallback) rather than from the script's own
 * location.
 *
 * @version v2.2.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadManifest } = require('../lib/manifest');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
// PROJECT_ROOT is the base used only to render readable relative paths in
// the structured log lines below (path.relative(PROJECT_ROOT, …)). The build
// runs from the instance root, so it aliases INSTANCE_ROOT. It has no effect
// on index contents — only on how paths are displayed in the logs.
const PROJECT_ROOT = INSTANCE_ROOT;
const DATA_DIR = process.env.HUGO_DATA_DIR || path.join(INSTANCE_ROOT, 'assets', 'hugo-data');
const OUT_DIR = path.join(INSTANCE_ROOT, 'public');
const DEV_LIMIT = process.env.DEV_LIMIT ? Number(process.env.DEV_LIMIT) : null;

// ---------------------------------------------------------------------------
// Pure helpers — year/century/decade derivation. Side-effect-free, unit-
// testable in isolation if a future test ever wants to import them.
// ---------------------------------------------------------------------------

function yearsInRange(startYear, endYear) {
  const s = Number(startYear);
  const e = Number(endYear);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return [];
  // Defensive cap — a malformed record with e=9999 would otherwise pin
  // ~8,000 filter values per entity. Mirrors the layouts/entidad/single.html
  // `if gt $e (add $s 500)` clamp.
  const cappedEnd = e > s + 500 ? s + 500 : e;
  const out = [];
  for (let y = s; y <= cappedEnd; y++) out.push(y);
  return out;
}

const ROMAN = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'
];

function romanCentury(year) {
  // Year 1..100 → century I, 101..200 → II, etc. Matches the
  // entity template's `add (int (math.Floor (div (sub $s 1) 100))) 1`.
  const c = Math.floor((year - 1) / 100) + 1;
  return ROMAN[c] || String(c);
}

function centuriesInRange(startYear, endYear) {
  const set = new Set(yearsInRange(startYear, endYear).map(romanCentury));
  return Array.from(set);
}

function decadesInRange(startYear, endYear) {
  const set = new Set(
    yearsInRange(startYear, endYear).map(y => String(Math.floor(y / 10) * 10))
  );
  return Array.from(set);
}

// Description year derivation. Enriched JSON does NOT carry
// `date_start_year`/`date_end_year` — derive from `date_start`
// (ISO YYYY-MM-DD) when present, otherwise scrape years from
// `date_expression` (e.g. "1780.. 1822", "1620 - 1623", "fl. 1911").
function descriptionYearRange(record) {
  let s = null;
  let e = null;
  if (record.date_start && typeof record.date_start === 'string') {
    const m = record.date_start.match(/^(\d{4})/);
    if (m) s = Number(m[1]);
  }
  if (record.date_expression && typeof record.date_expression === 'string') {
    const matches = record.date_expression.match(/\d{4}/g);
    if (matches && matches.length) {
      if (s == null) s = Number(matches[0]);
      e = Number(matches[matches.length - 1]);
    }
  }
  if (s != null && e == null) e = s;
  if (s == null && e != null) s = e;
  return { startYear: s, endYear: e };
}

// ---------------------------------------------------------------------------
// FIELD_MAP — the contract between assets/hugo-data/*.json and the
// Pagefind bundles. Inline `//` comments document the `why` for each
// non-obvious slot. This table is the canonical source of truth for
// what Pagefind sees.
// ---------------------------------------------------------------------------

// The level filter indexes the canonical code directly.
// description_level is already a canonical code ('fonds', 'series', etc.) —
// no inline label map needed. Display labels resolve client-side via the
// data-level-labels blob injected by buscar/list.html from the active standard profile.

// Display-name overrides for repositories whose upstream `name`/`short_name`
// in exports/repositories.json is unsuitable for user-facing facet display.
// Preferred over `short_name` (too abbreviated, e.g. "CIHJML") and the raw
// `name` (sometimes ends with institutional affiliation instead of city).
// The upstream source of truth should be corrected when possible; this map
// is the bridge until that happens.
const REPO_NAME_OVERRIDES = {
  'co-cihjml': 'Centro de Investigaciones Históricas José María Arboleda Llorente, Popayán',
};

function repoDisplayName(r) {
  return (
    REPO_NAME_OVERRIDES[r.repository_code] ||
    (r.repository && (r.repository.short_name || r.repository.name)) ||
    r.repository_code ||
    ''
  );
}

// Sidebar-facet tally written alongside the descriptions
// Pagefind bundle as public/buscar-facets.json. Consumed by search.js
// so the /buscar/ landing page renders its sidebar in <100ms
// without calling pagefind.filters() (the ~13s WASM tax on cold load).
// Keys MUST match search.js's 5 sidebar facet dimensions and use the
// exact label strings the Pagefind filter index emits, so sidebar
// clicks stay routable through the existing URL-param + filter
// machinery without a code↔label translation layer.
const SIDEBAR_FACET_KEYS = ['country', 'digital_status', 'level', 'repository', 'year'];

// Pair-wise and triple-wise cross-facet pivot keys for the
// public/buscar-pivots.json and public/buscar-triples.json sidecars.
// Alphabetical order matters — tallyCorpusTriples and the search.js
// consumer both rely on canonical alphabetical key ordering when
// walking the triple tree, so the same three active+inactive keys
// always resolve to the same nested path regardless of which two
// dimensions the user activated. Year is deliberately excluded: its
// 430 distinct bucket values would inflate the sidecars far past the
// 50 KB gzipped budget, and the date-tree widget consumes year via a
// different rendering path. Century and decade are included so the
// date-tree chips also get scoped cold counts on N=1 and N=2 deep
// links.
const PIVOT_FACET_KEYS = ['century', 'country', 'decade', 'digital_status', 'level', 'repository'];

// 4-key pivot set for entities. Year is excluded (turned into a
// record-scalar — pivoting on 78K distinct values is size-prohibitive
// and adds no UX lift because century + decade cover the date-tree
// sidebar). Role is excluded (FIELD_MAP gap). Alphabetical order
// matters for the canonical triples walk — see tallyCorpusTriples
// and the search.js / entity-explorer.js consumers.
const ENTITY_PIVOT_FACET_KEYS = ['century', 'decade', 'entity_type', 'primary_function'];

// 3-key pivot set for places. The places adapter emits exactly these
// three filter dimensions and the place-explorer sidebar exposes
// exactly these three groups. Alphabetical order matters for the
// canonical triples walk (see tallyCorpusTriples); C(3,2)=3 pairs,
// C(3,3)=1 triple. Cardinalities (2026-04-19 build): has_authority=2,
// has_coordinates=2, place_type=~10-20.
const PLACE_PIVOT_FACET_KEYS = ['has_authority', 'has_coordinates', 'place_type'];

// Landing-sidecar facet keys for public/lugares-facets.json,
// mirroring SIDEBAR_FACET_KEYS for /buscar/. Same key set as
// PLACE_PIVOT_FACET_KEYS — places sidebar has no key (like
// /buscar/'s `year`) excluded from the pivot set, so the two
// constants happen to be byte-identical. They stay separate decls
// because the contracts are independent — landing sidecar covers the
// cold-landing render; pivot sidecar covers the cold-first-click
// render.
const PLACE_SIDEBAR_FACET_KEYS = ['has_authority', 'has_coordinates', 'place_type'];

// Per-sidecar gzipped size budget for the pagefind-sidecar CI log
// line emitted by checkSidecarSize(). 51200 bytes = 50 KB. Overflow
// triggers a GitHub Actions::warning:: annotation only; the build
// never fails on a sidecar size regression (warn-but-don't-block).
// The constant is emitted verbatim in the log line so CI consumers
// and future audits can reason about which budget version was in
// effect at build time.
const SIDECAR_GZIPPED_BUDGET = 51200;

// Warn-but-don't-block sidecar size check. Reads the just-renamed
// sidecar, gzips it in memory via Node stdlib (no new dep), and
// emits a single grep-able `pagefind-sidecar <name> bytes=<raw>
// gzipped=<gz> budget=51200 status=<ok|over>` line per call. When
// running under GitHub Actions AND the gzipped size exceeds
// SIDECAR_GZIPPED_BUDGET, emits a second `::warning file=<relPath>::...`
// workflow command on stdout — this surfaces as a yellow annotation
// on the run page but does NOT fail the step (the blocking gate is
// deliberately relaxed at CI level). Never throws, never exits,
// never returns non-zero. Idempotent — called once per sidecar write
// site.
function checkSidecarSize(absPath, name) {
  const raw = fs.statSync(absPath).size;
  const gzipped = zlib.gzipSync(fs.readFileSync(absPath)).length;
  const status = gzipped > SIDECAR_GZIPPED_BUDGET ? 'over' : 'ok';
  const relPath = path.relative(PROJECT_ROOT, absPath);
  console.log(
    `pagefind-sidecar ${name} bytes=${raw} gzipped=${gzipped} budget=${SIDECAR_GZIPPED_BUDGET} status=${status}`
  );
  if (process.env.GITHUB_ACTIONS === 'true' && gzipped > SIDECAR_GZIPPED_BUDGET) {
    console.log(
      `::warning file=${relPath}::Sidecar ${name} exceeds 50 KB gzipped budget (gzipped=${gzipped}, budget=${SIDECAR_GZIPPED_BUDGET})`
    );
  }
}

// Generalised tally: the `keys` parameter replaces the former
// close-over on SIDEBAR_FACET_KEYS so the same helper serves both
// SIDEBAR_FACET_KEYS (descriptions) and PLACE_SIDEBAR_FACET_KEYS
// (places). Tally shape is unchanged.
function tallyCorpusFacets(filters, tally, keys) {
  for (const key of keys) {
    const values = filters[key];
    if (!Array.isArray(values)) continue;
    if (!tally[key]) tally[key] = Object.create(null);
    for (const v of values) {
      if (v == null) continue;
      const k = String(v);
      tally[key][k] = (tally[key][k] || 0) + 1;
    }
  }
}

// Accumulate pair-wise cross-facet intersection counts for a pivot
// sidecar. For each record, walks every ordered pair (keyA, keyB) in
// `keys` with keyA != keyB and increments
// pivots[keyA][valueA][keyB][valueB] by 1. Symmetric by construction:
// A×B sum matches B×A. Consumed by the synchronous browse-prompt path
// (search.js on /buscar/, entity-explorer.js on /entidades/) when
// exactly one filter dimension is active on cold first-click.
//
// The `keys` parameter lets the same helper serve both
// PIVOT_FACET_KEYS (descriptions, 6 keys) and
// ENTITY_PIVOT_FACET_KEYS (entities, 4 keys).
function tallyCorpusPivots(filters, pivots, keys) {
  for (const keyA of keys) {
    const valuesA = filters[keyA];
    if (!Array.isArray(valuesA) || valuesA.length === 0) continue;
    if (!pivots[keyA]) pivots[keyA] = Object.create(null);
    for (const a of valuesA) {
      if (a == null) continue;
      const sa = String(a);
      if (!pivots[keyA][sa]) pivots[keyA][sa] = Object.create(null);
      for (const keyB of keys) {
        if (keyB === keyA) continue;
        const valuesB = filters[keyB];
        if (!Array.isArray(valuesB) || valuesB.length === 0) continue;
        if (!pivots[keyA][sa][keyB]) pivots[keyA][sa][keyB] = Object.create(null);
        for (const b of valuesB) {
          if (b == null) continue;
          const sb = String(b);
          pivots[keyA][sa][keyB][sb] = (pivots[keyA][sa][keyB][sb] || 0) + 1;
        }
      }
    }
  }
}

// accumulate triple-wise
// cross-facet intersection counts for a triples sidecar. For every
// unordered triple (keyA, keyB, keyC) of DISTINCT keys from `keys`,
// increments triples[keyA][valA][keyB][valB][keyC][valC] by 1 for
// each (valA x valB x valC) combination carried by the record. Keys
// in the nested path are sorted alphabetically — the outer walk
// iterates ordered combinations (i < j < k on `keys`, which must be
// supplied in alphabetical order), so the consumer's canonical-
// order lookup always resolves to the same path regardless of which
// two dimensions the user activated. Consumed by search.js /
// entity-explorer.js's generalised buildPivotScopedFilters when
// exactly two filter dimensions are active on cold first-click.
// Three or more active dims fall back to global counts (quad-pivot
// deferred).
//
// generalisation: the `keys` parameter replaces the
// former close-over on PIVOT_FACET_KEYS so the same helper serves
// both PIVOT_FACET_KEYS (descriptions, 6 keys → C(6,3)=20 triples)
// and ENTITY_PIVOT_FACET_KEYS (entities, 4 keys → C(4,3)=4 triples).
function tallyCorpusTriples(filters, triples, keys) {
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const keyA = keys[i];
    const valuesA = filters[keyA];
    if (!Array.isArray(valuesA) || valuesA.length === 0) continue;
    for (let j = i + 1; j < n; j++) {
      const keyB = keys[j];
      const valuesB = filters[keyB];
      if (!Array.isArray(valuesB) || valuesB.length === 0) continue;
      for (let k = j + 1; k < n; k++) {
        const keyC = keys[k];
        const valuesC = filters[keyC];
        if (!Array.isArray(valuesC) || valuesC.length === 0) continue;
        if (!triples[keyA]) triples[keyA] = Object.create(null);
        for (const a of valuesA) {
          if (a == null) continue;
          const sa = String(a);
          if (!triples[keyA][sa]) triples[keyA][sa] = Object.create(null);
          if (!triples[keyA][sa][keyB]) triples[keyA][sa][keyB] = Object.create(null);
          for (const b of valuesB) {
            if (b == null) continue;
            const sb = String(b);
            if (!triples[keyA][sa][keyB][sb]) triples[keyA][sa][keyB][sb] = Object.create(null);
            if (!triples[keyA][sa][keyB][sb][keyC]) triples[keyA][sa][keyB][sb][keyC] = Object.create(null);
            for (const c of valuesC) {
              if (c == null) continue;
              const sc = String(c);
              triples[keyA][sa][keyB][sb][keyC][sc] =
                (triples[keyA][sa][keyB][sb][keyC][sc] || 0) + 1;
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Facet auto-suppression.
//
// Called at the sidecar write seam (after tallyCorpusFacets/Pivots/Triples
// completes, before the sidecar JSON is written). Removes any key whose
// distinct-value count is 0 or 1 unless the key appears in `forceKeep`
// (from manifest.facets.force_keep). A suppressed key is completely absent
// from the output — not present as an empty object.
//
// On the Neogranadina corpus all facets are multi-valued so the function
// returns the tally unchanged.
// ---------------------------------------------------------------------------

/**
 * Remove facet keys with 0 or 1 distinct values from a tally object.
 *
 * @param {Object} tally     — the facet tally map (key → {value: count})
 * @param {string[]|null} forceKeep — keys to preserve regardless of count
 * @returns {Object} new object with suppressed keys absent
 */
function suppressSingleValuedFacets(tally, forceKeep) {
  const keep = Array.isArray(forceKeep) ? forceKeep : [];
  const result = Object.create(null);
  for (const [key, values] of Object.entries(tally)) {
    const distinctCount = Object.keys(values).length;
    if (distinctCount <= 1 && !keep.includes(key)) {
      console.log(
        `[generate-pagefind-indices] Suppressing facet '${key}' (${distinctCount} distinct values)`
      );
      continue;
    }
    result[key] = values;
  }
  return result;
}

const FIELD_MAP = {
  // ENTITIES — strict parity with layouts/entidad/single.html.
  entities: {
    url: r => `/${r.entity_code}/`,
    // Search-ranking text: display name plus any name variants so a
    // search for an alternate spelling still surfaces the entity.
    content: r => [r.display_name, ...(r.name_variants || [])].filter(Boolean).join(' '),
    language: () => 'es',
    filters: r => {
      const f = {};
      // Single-value filters wrapped in arrays per Pagefind contract
      // (filters are always Record<string, string[]>).
      if (r.entity_type) f.entity_type = [r.entity_type];
      if (r.primary_function) f.primary_function = [r.primary_function];
      // Emit a single startYear — not the full yearsInRange(...). Binding
      // every year in the range made the date facet show hundreds of
      // thousands of items against a 78,245-entity corpus. Century and
      // decade stay as bucket-granularity emissions (they drive the
      // date-tree widget on /entidades/ and do not explode the
      // filter-chunk index the way per-year bindings do).
      if (r.date_earliest != null) {
        f.year = [String(r.date_earliest)];
        const e = r.date_latest != null ? r.date_latest : r.date_earliest;
        const centuries = centuriesInRange(r.date_earliest, e);
        if (centuries.length) f.century = centuries;
        const decades = decadesInRange(r.date_earliest, e);
        if (decades.length) f.decade = decades;
      }
      // role filter omitted — the enriched JSON does not yet carry the
      // field, so emitting it is deferred until the data exists.
      return f;
    },
    sort: r => ({
      name: r.sort_name || r.display_name || '',
      date: String(r.date_earliest || ''),
      count: String(r._linked_count || 0),
    }),
    meta: r => {
      const m = {
        // `title` is highly recommended by Pagefind for result rendering.
        title: r.display_name || r.entity_code || '',
        entity_type: r.entity_type || '',
        date_earliest: r.date_earliest != null ? String(r.date_earliest) : '',
        date_latest: r.date_latest != null ? String(r.date_latest) : '',
        primary_function: r.primary_function || '',
        linked_count: String(r._linked_count || 0),
      };
      if (Array.isArray(r.name_variants) && r.name_variants.length) {
        m.name_variants = r.name_variants.join(' | ');
      }
      return m;
    },
  },

  // PLACES — strict parity with layouts/lugar/single.html.
  // Note the JSON uses `latitude`/`longitude`, not `lat`/`lon`; the
  // template uses `tgn_id` as part of `has_authority`, included here.
  places: {
    url: r => `/${r.place_code}/`,
    content: r => [r.display_name, ...(r.name_variants || [])].filter(Boolean).join(' '),
    language: () => 'es',
    filters: r => {
      const hasCoords = r.latitude != null && r.longitude != null;
      const hasAuthority = !!(r.wikidata_id || r.whg_id || r.tgn_id || r.hgis_id);
      const f = {
        has_coordinates: [hasCoords ? 'true' : 'false'],
        has_authority: [hasAuthority ? 'true' : 'false'],
      };
      if (r.place_type) f.place_type = [r.place_type];
      return f;
    },
    // Adds `count` so pagefind.search({ sort: { count: 'desc' } })
    // is honoured. Without this, only `name` was registered and
    // Pagefind silently fell back to alphabetical. Mirrors the
    // entities adapter. The client passes { count: 'desc' } when
    // state.sort === 'linked'.
    sort: r => ({
      name: r.display_name || '',
      count: String(r._linked_count || 0),
    }),
    meta: r => {
      const hasCoords = r.latitude != null && r.longitude != null;
      const m = {
        title: r.display_name || r.place_code || '',
        place_type: r.place_type || '',
        has_coordinates: hasCoords ? 'true' : 'false',
        linked_count: String(r._linked_count || 0),
      };
      if (Array.isArray(r.name_variants) && r.name_variants.length) {
        m.name_variants = r.name_variants.join(' | ');
      }
      return m;
    },
  },

  // DESCRIPTIONS — pre-computed filter and meta fields that the old
  // HTML-scan mode could not cheaply surface. Where the enriched JSON does
  // not yet carry a field this map expected, the closest available analog is
  // substituted rather than a value synthesised.
  descriptions: {
    url: r => `/${r.reference_code}/`,
    // Full OCR retained. Title and reference_code are prepended
    // so users searching for a series name (e.g. "Encomiendas") or a
    // reference code rank those hits first — HTML-scan picked these up
    // from the rendered <h1>; Node-API needs them in `content` because
    // Pagefind only full-text-indexes `content` (meta is for display).
    content: r => [r.title, r.reference_code, r.scope_content, r.ocr_text].filter(Boolean).join('\n'),
    language: () => 'es',
    filters: r => {
      const f = {};

      // The repository filter value is the display name, not the code.
      // short_name falls back to name (never the code). REPO_NAME_OVERRIDES
      // takes precedence for repositories whose upstream short_name/name is
      // unsuitable for user-facing display.
      const repoName = repoDisplayName(r);
      if (repoName) f.repository = [repoName];

      // The level filter is the canonical code. description_level is already
      // a canonical code ('fonds', 'series', etc.), so there is no label
      // translation here — display labels resolve client-side via the
      // data-level-labels blob injected by buscar/list.html.
      if (r.description_level) f.level = [r.description_level];

      // Country filter (Spanish display name already on the record).
      if (r.country) f.country = [r.country];

      // Digital-status filter (raw token, not localised).
      f.digital_status = [r.has_digital ? 'zasqua' : 'none'];

      // A SINGLE startYear, not the full yearsInRange. Binding every year in
      // the range was the roughly 30x blow-up behind multi-second faceted
      // query latency.
      const { startYear, endYear } = descriptionYearRange(r);
      if (startYear != null) f.year = [String(startYear)];

      // Century + decade emission, derived from the same (startYear, endYear)
      // range descriptionYearRange() returns. Mirrors the entities FIELD_MAP
      // pattern above. These are consumed by the buscar-pivots.json and
      // buscar-triples.json sidecar tallies so the date-tree sidebar chips
      // (Siglo XVII, 1780s, etc.) get scoped cross-facet counts on cold
      // first-click. Kept separate from the `year` emission so pair-wise and
      // triple-wise joins at century and decade granularity stay affordable
      // even though the underlying year filter stays collapsed to a single
      // startYear.
      if (startYear != null && endYear != null) {
        const centuries = centuriesInRange(startYear, endYear);
        if (centuries.length) f.century = centuries;
        const decades = decadesInRange(startYear, endYear);
        if (decades.length) f.decade = decades;
      }

      // `parent_reference_code` dropped. No template or JS produces
      // /buscar/?parent=<ref_code> links, so the filter chunk was a dead
      // 538 KB load.

      // Emitted as `ancestor` for parity with the Eleventy template.
      const ancestors = [];
      if (r.repository_code) ancestors.push(r.repository_code);
      if (Array.isArray(r.ancestor_chain)) {
        for (const a of r.ancestor_chain) {
          if (a && a.reference_code) ancestors.push(a.reference_code);
        }
      }
      if (r.reference_code) ancestors.push(r.reference_code);
      if (ancestors.length) f.ancestor = ancestors;

      // Emitted as `entidad` for parity with the Eleventy template.
      if (Array.isArray(r.entity_links) && r.entity_links.length) {
        const codes = r.entity_links.map(l => l && l.entity_code).filter(Boolean);
        if (codes.length) f.entidad = codes;
      }

      // `lugar` dropped. /lugar/:code/ pages render their own
      // linked-description lists from static/data/place-links/*.json; no
      // /buscar/?lugar=<code> link exists.

      return f;
    },
    sort: r => {
      const { startYear } = descriptionYearRange(r);
      return {
        title: r.title || '',
        date: startYear != null ? String(startYear) : '',
        reference_code: r.reference_code || '',  // restores the "Código" sort option
      };
    },
    meta: r => {
      const repoName = repoDisplayName(r);
      const m = {
        title: r.title || '',
        reference_code: r.reference_code || '',
        // Kept as a hook for future deep links.
        repository_code: r.repository_code || '',
        // RENAMED from `repository` → `repository_name` (search.js:771 reads this).
        repository_name: repoName,
        // RENAMED from `level` → `description_level` (search.js:638 reads this).
        description_level: r.description_level || '',
        // Pre-computed Spanish narrative.
        date_formatted: r.date_formatted || '',
        // Retained for future sidebar localisation (not read by search.js today).
        digital_status: r.has_digital ? 'zasqua' : 'none',
      };
      if (Array.isArray(r.ancestor_chain) && r.ancestor_chain.length) {
        m.ancestor_chain = r.ancestor_chain
          .map(a => a && a.title)
          .filter(Boolean)
          .join(' \u2192 ');
      }
      return m;
    },
  },
};

// ---------------------------------------------------------------------------
// Loaders. The descriptions corpus is sharded (per generate-content.js
// SHARD_SIZE=20,000); entities and places are single-file. DEV_LIMIT
// propagates through the JSON itself — no slicing here.
// ---------------------------------------------------------------------------

function loadDescriptionShards() {
  const dir = path.join(DATA_DIR, 'descriptions');
  if (!fs.existsSync(dir)) {
    throw new Error(`descriptions shard directory missing: ${dir}`);
  }
  const records = [];
  const shards = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  for (const file of shards) {
    const batch = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!Array.isArray(batch)) {
      throw new Error(`description shard is not an array: ${file}`);
    }
    records.push(...batch);
  }
  return records;
}

function loadJSON(relPath) {
  const full = path.join(DATA_DIR, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`required input missing: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function pagefindCheck(label, response) {
  if (response && Array.isArray(response.errors) && response.errors.length) {
    throw new Error(`pagefind ${label} returned errors: ${response.errors.join(' | ')}`);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Indexer. Writes to `public/.pagefind-tmp.{pid}.{corpus}/` first and
// `fs.renameSync`s into place on success — no half-written bundles
// for the next parity run to pick up if a record fails mid-loop.
// ---------------------------------------------------------------------------

async function buildIndex(pagefind, corpus, records, outputSubdir, forceKeep) {
  const started = Date.now();
  const finalOut = path.join(OUT_DIR, outputSubdir);
  const tmpOut = path.join(OUT_DIR, `.pagefind-tmp.${process.pid}.${corpus}`);

  // Clean any stale tmp dir from a previous interrupted run.
  if (fs.existsSync(tmpOut)) {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }

  const createResp = pagefindCheck('createIndex', await pagefind.createIndex());
  const index = createResp.index;
  if (!index) {
    throw new Error(`pagefind createIndex did not return an index for corpus=${corpus}`);
  }
  const map = FIELD_MAP[corpus];

  // tally for the buscar-facets.json sidecar. Only
  // populated when corpus === 'descriptions'; cheap no-op otherwise.
  const tally = Object.create(null);

  // pair-wise cross-facet tally for the
  // buscar-pivots.json sidecar. Same descriptions-only restriction.
  const pivots = Object.create(null);

  // triple-wise cross-facet tally for the
  // buscar-triples.json sidecar. Same descriptions-only restriction.
  // Consumed by static/js/search.js when exactly two filter
  // dimensions are active on cold first-click.
  const triples = Object.create(null);

  let currentField = null;
  let currentId = null;
  try {
    for (const r of records) {
      currentId = r.reference_code || r.entity_code || r.place_code || '(unknown)';
      currentField = 'url';      const url = map.url(r);
      currentField = 'content';  const content = map.content(r);
      currentField = 'language'; const language = map.language(r);
      currentField = 'filters';  const filters = map.filters(r);
      if (corpus === 'descriptions') tallyCorpusFacets(filters, tally, SIDEBAR_FACET_KEYS);
      if (corpus === 'descriptions') tallyCorpusPivots(filters, pivots, PIVOT_FACET_KEYS);
      if (corpus === 'descriptions') tallyCorpusTriples(filters, triples, PIVOT_FACET_KEYS);
      if (corpus === 'entities') tallyCorpusPivots(filters, pivots, ENTITY_PIVOT_FACET_KEYS);
      if (corpus === 'entities') tallyCorpusTriples(filters, triples, ENTITY_PIVOT_FACET_KEYS);
      if (corpus === 'places') tallyCorpusFacets(filters, tally, PLACE_SIDEBAR_FACET_KEYS);
      if (corpus === 'places') tallyCorpusPivots(filters, pivots, PLACE_PIVOT_FACET_KEYS);
      if (corpus === 'places') tallyCorpusTriples(filters, triples, PLACE_PIVOT_FACET_KEYS);
      currentField = 'sort';     const sort = map.sort(r);
      currentField = 'meta';     const meta = map.meta(r);

      pagefindCheck(
        `addCustomRecord(${currentId})`,
        await index.addCustomRecord({ url, content, language, filters, meta, sort })
      );
    }
  } catch (err) {
    console.error(
      `[generate-pagefind-indices] FATAL corpus=${corpus} record=${currentId} field=${currentField}:`,
      (err && err.stack) || err
    );
    process.exit(1);
  }

  pagefindCheck(`writeFiles(${corpus})`, await index.writeFiles({ outputPath: tmpOut }));

  // Atomic swap. rename overwrites would fail on a non-empty directory,
  // so wipe the destination first — same trade-off as `cp -rT --remove-destination`.
  if (fs.existsSync(finalOut)) {
    fs.rmSync(finalOut, { recursive: true, force: true });
  }
  fs.renameSync(tmpOut, finalOut);

  // write sidebar-facet sidecar alongside the descriptions
  // bundle. Atomic via temp-file + rename — same pattern as the bundle
  // write above. Only runs for the descriptions corpus.
  if (corpus === 'descriptions') {
    // Apply facet suppression before writing any sidecar. Keys with 0 or 1
    // distinct values are removed unless they appear in forceKeep. The same
    // set of surviving keys gates the pivot and triple sidecars so suppressed
    // facets are absent from all three sidecar files.
    const rawTally = Object.create(null);
    for (const key of SIDEBAR_FACET_KEYS) {
      rawTally[key] = tally[key] || {};
    }
    const suppressed = suppressSingleValuedFacets(rawTally, forceKeep);
    const survivingKeys = new Set(Object.keys(suppressed));

    const facetsJsonPath = path.join(OUT_DIR, 'buscar-facets.json');
    const tmpFacetsPath = path.join(OUT_DIR, `.buscar-facets.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpFacetsPath, JSON.stringify(suppressed));
    fs.renameSync(tmpFacetsPath, facetsJsonPath);
    console.log(
      `pagefind-index descriptions-facets bundle=${path.relative(PROJECT_ROOT, facetsJsonPath)} keys=${[...survivingKeys].join(',')}`
    );
    checkSidecarSize(facetsJsonPath, 'buscar-facets');

    // pair-wise cross-facet pivot sidecar. Same atomic
    // temp + rename pattern as the facets sidecar above. Consumed by
    // static/js/search.js's H2 synchronous browse-prompt path when
    // exactly one filter dimension is active on cold first-click.
    // Only pivot keys that survived suppression are written.
    const orderedPivots = Object.create(null);
    for (const key of PIVOT_FACET_KEYS) {
      if (survivingKeys.has(key) || forceKeep.includes(key)) {
        orderedPivots[key] = pivots[key] || {};
      }
    }
    const pivotsJsonPath = path.join(OUT_DIR, 'buscar-pivots.json');
    const tmpPivotsPath = path.join(OUT_DIR, `.buscar-pivots.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpPivotsPath, JSON.stringify(orderedPivots));
    fs.renameSync(tmpPivotsPath, pivotsJsonPath);
    const pivotsSize = fs.statSync(pivotsJsonPath).size;
    console.log(
      `pagefind-index descriptions-pivots bundle=${path.relative(PROJECT_ROOT, pivotsJsonPath)} size_bytes=${pivotsSize} keys=${PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(pivotsJsonPath, 'buscar-pivots');

    // triple-wise cross-facet sidecar. Same atomic
    // temp + rename pattern as the pivots sidecar. Outer keys are
    // canonical-alphabetical across PIVOT_FACET_KEYS; the consumer
    // sorts the (active_a, active_b, inactive_c) triple alphabetically
    // before walking, so every (A,B,C) maps to exactly one path here
    // regardless of which two dims the user activated.
    // Only triple keys that survived suppression are written.
    const orderedTriples = Object.create(null);
    for (const key of PIVOT_FACET_KEYS) {
      if (survivingKeys.has(key) || forceKeep.includes(key)) {
        orderedTriples[key] = triples[key] || {};
      }
    }
    const triplesJsonPath = path.join(OUT_DIR, 'buscar-triples.json');
    const tmpTriplesPath = path.join(OUT_DIR, `.buscar-triples.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpTriplesPath, JSON.stringify(orderedTriples));
    fs.renameSync(tmpTriplesPath, triplesJsonPath);
    const triplesSize = fs.statSync(triplesJsonPath).size;
    console.log(
      `pagefind-index descriptions-triples bundle=${path.relative(PROJECT_ROOT, triplesJsonPath)} size_bytes=${triplesSize} keys=${PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(triplesJsonPath, 'buscar-triples');
  }

  // Pair-wise and triple-wise cross-facet pivot sidecars for /entidades/.
  // Atomic tmp+rename mirroring the descriptions write blocks above. 4 pivot
  // keys give 6 pairs and C(4,3)=4 triples. Consumed by the entity-explorer:
  // a single active filter dimension resolves against the pivots sidecar; two
  // active dimensions resolve against the triples sidecar. Size budget is
  // 50 KB gzipped per sidecar on the full 78,245-entity corpus.
  if (corpus === 'entities') {
    // Apply suppression to the entity pivot and triples sidecars. Entities
    // have no landing-facets sidecar (entidades-facets.json does not exist),
    // so suppression applies only to pivot and triple keys.
    const rawEntityTally = Object.create(null);
    for (const key of ENTITY_PIVOT_FACET_KEYS) {
      rawEntityTally[key] = pivots[key] ? Object.fromEntries(
        Object.entries(pivots[key]).flatMap(([v, innerObj]) =>
          Object.keys(innerObj).map(k => [k, 1])
        )
      ) : {};
    }
    // For entities, suppression is computed from the per-facet distinct values
    // across the tally (same filter map). Build a simplified tally for suppression
    // by counting distinct values from the filters object (accumulated in pivots
    // outer keys). Use the pivot keys themselves as a proxy.
    const entitySurvivingKeys = new Set(
      ENTITY_PIVOT_FACET_KEYS.filter(key => {
        // Count distinct values: the outer key of pivots[key] holds the distinct values
        const distinctCount = pivots[key] ? Object.keys(pivots[key]).length : 0;
        return distinctCount > 1 || (forceKeep || []).includes(key);
      })
    );

    const orderedEntityPivots = Object.create(null);
    for (const key of ENTITY_PIVOT_FACET_KEYS) {
      if (entitySurvivingKeys.has(key)) {
        orderedEntityPivots[key] = pivots[key] || {};
      }
    }
    const entityPivotsJsonPath = path.join(OUT_DIR, 'entidades-pivots.json');
    const tmpEntityPivotsPath = path.join(OUT_DIR, `.entidades-pivots.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpEntityPivotsPath, JSON.stringify(orderedEntityPivots));
    fs.renameSync(tmpEntityPivotsPath, entityPivotsJsonPath);
    const entityPivotsSize = fs.statSync(entityPivotsJsonPath).size;
    console.log(
      `pagefind-index entities-pivots bundle=${path.relative(PROJECT_ROOT, entityPivotsJsonPath)} size_bytes=${entityPivotsSize} keys=${ENTITY_PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(entityPivotsJsonPath, 'entidades-pivots');

    const orderedEntityTriples = Object.create(null);
    for (const key of ENTITY_PIVOT_FACET_KEYS) {
      if (entitySurvivingKeys.has(key)) {
        orderedEntityTriples[key] = triples[key] || {};
      }
    }
    const entityTriplesJsonPath = path.join(OUT_DIR, 'entidades-triples.json');
    const tmpEntityTriplesPath = path.join(OUT_DIR, `.entidades-triples.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpEntityTriplesPath, JSON.stringify(orderedEntityTriples));
    fs.renameSync(tmpEntityTriplesPath, entityTriplesJsonPath);
    const entityTriplesSize = fs.statSync(entityTriplesJsonPath).size;
    console.log(
      `pagefind-index entities-triples bundle=${path.relative(PROJECT_ROOT, entityTriplesJsonPath)} size_bytes=${entityTriplesSize} keys=${ENTITY_PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(entityTriplesJsonPath, 'entidades-triples');
  }

  // Landing facets plus pair-wise and triple-wise cross-facet pivot sidecars
  // for /lugares/. Atomic tmp+rename mirroring the descriptions and entities
  // write blocks above. 3 pivot keys give 3 pairs (C(3,2)=3) and 1 triple
  // (C(3,3)=1). Consumed by static/js/place-explorer.js: the landing render
  // reads lugares-facets.json before the user clicks; one active filter
  // dimension resolves against lugares-pivots.json; two active dimensions
  // resolve against lugares-triples.json. Size budget is 50 KB gzipped per
  // sidecar.
  if (corpus === 'places') {
    // Apply suppression to the places landing-facet, pivot, and triple
    // sidecars. The same forceKeep list applies.
    const rawLugarTally = Object.create(null);
    for (const key of PLACE_SIDEBAR_FACET_KEYS) {
      rawLugarTally[key] = tally[key] || {};
    }
    const suppressedLugar = suppressSingleValuedFacets(rawLugarTally, forceKeep);
    const lugarSurvivingKeys = new Set(Object.keys(suppressedLugar));

    // Landing-sidecar facets — mirror buscar-facets.json shape.
    const lugarFacetsJsonPath = path.join(OUT_DIR, 'lugares-facets.json');
    const tmpLugarFacetsPath = path.join(OUT_DIR, `.lugares-facets.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpLugarFacetsPath, JSON.stringify(suppressedLugar));
    fs.renameSync(tmpLugarFacetsPath, lugarFacetsJsonPath);
    console.log(
      `pagefind-index places-facets bundle=${path.relative(PROJECT_ROOT, lugarFacetsJsonPath)} keys=${[...lugarSurvivingKeys].join(',')}`
    );
    checkSidecarSize(lugarFacetsJsonPath, 'lugares-facets');

    // Pair-wise pivots — mirror entidades-pivots.json shape.
    // Only surviving keys written.
    const orderedLugarPivots = Object.create(null);
    for (const key of PLACE_PIVOT_FACET_KEYS) {
      if (lugarSurvivingKeys.has(key) || forceKeep.includes(key)) {
        orderedLugarPivots[key] = pivots[key] || {};
      }
    }
    const lugarPivotsJsonPath = path.join(OUT_DIR, 'lugares-pivots.json');
    const tmpLugarPivotsPath = path.join(OUT_DIR, `.lugares-pivots.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpLugarPivotsPath, JSON.stringify(orderedLugarPivots));
    fs.renameSync(tmpLugarPivotsPath, lugarPivotsJsonPath);
    const lugarPivotsSize = fs.statSync(lugarPivotsJsonPath).size;
    console.log(
      `pagefind-index places-pivots bundle=${path.relative(PROJECT_ROOT, lugarPivotsJsonPath)} size_bytes=${lugarPivotsSize} keys=${PLACE_PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(lugarPivotsJsonPath, 'lugares-pivots');

    // Triple-wise pivots — mirror entidades-triples.json shape.
    // Only surviving keys written.
    const orderedLugarTriples = Object.create(null);
    for (const key of PLACE_PIVOT_FACET_KEYS) {
      if (lugarSurvivingKeys.has(key) || forceKeep.includes(key)) {
        orderedLugarTriples[key] = triples[key] || {};
      }
    }
    const lugarTriplesJsonPath = path.join(OUT_DIR, 'lugares-triples.json');
    const tmpLugarTriplesPath = path.join(OUT_DIR, `.lugares-triples.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpLugarTriplesPath, JSON.stringify(orderedLugarTriples));
    fs.renameSync(tmpLugarTriplesPath, lugarTriplesJsonPath);
    const lugarTriplesSize = fs.statSync(lugarTriplesJsonPath).size;
    console.log(
      `pagefind-index places-triples bundle=${path.relative(PROJECT_ROOT, lugarTriplesJsonPath)} size_bytes=${lugarTriplesSize} keys=${PLACE_PIVOT_FACET_KEYS.join(',')}`
    );
    checkSidecarSize(lugarTriplesJsonPath, 'lugares-triples');
  }

  const elapsed = Date.now() - started;
  // structured log line — CI log scraping depends on
  // this exact shape. Do NOT reformat without coordinating with CI.
  console.log(
    `pagefind-index ${corpus} records=${records.length} bundle=${path.relative(PROJECT_ROOT, finalOut)} elapsed_ms=${elapsed}`
  );
}

// ---------------------------------------------------------------------------
// Orchestrator — builds the corpora sequentially. Promote to parallel only
// if a future wall-clock measurement shows the sequential build regressing
// materially.
// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();
  console.log(
    `[generate-pagefind-indices] DATA_DIR=${path.relative(PROJECT_ROOT, DATA_DIR)}`
  );
  if (DEV_LIMIT) {
    console.log(
      `[generate-pagefind-indices] DEV_LIMIT=${DEV_LIMIT} (propagated via hugo-data JSON; bundles are smoke-test-only)`
    );
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load the capability manifest once. The entities and places index builds
  // are gated on manifest.modules.entities / .places, and
  // manifest.facets.force_keep lists facet keys to keep even when they have
  // 0 or 1 distinct values.
  const manifest = loadManifest(INSTANCE_ROOT);
  const forceKeep = (manifest.facets && Array.isArray(manifest.facets.force_keep))
    ? manifest.facets.force_keep
    : [];
  if (forceKeep.length) {
    console.log(
      `[generate-pagefind-indices] Facet force_keep: ${forceKeep.join(', ')}`
    );
  }

  // Pagefind v1.5.2 is ESM-only; load via dynamic import from this CommonJS
  // script so it can stay shaped like generate-content.js.
  const pagefind = await import('pagefind');

  // The descriptions index is core and always built.
  const descriptions = loadDescriptionShards();
  await buildIndex(pagefind, 'descriptions', descriptions, 'pagefind', forceKeep);

  // Entities index gated on manifest.modules.entities.
  if (manifest.modules.entities) {
    const entities = loadJSON('entities.json');
    await buildIndex(pagefind, 'entities', entities, 'pagefind-entities', forceKeep);
  } else {
    console.log('[generate-pagefind-indices] entities module disabled — skipping entity index');
  }

  // Places index gated on manifest.modules.places.
  if (manifest.modules.places) {
    // Only index a place in the explorer if it has coordinates OR is
    // linked to more than one description. This excludes coordinate-less
    // "singleton" authority records — the `$inExplorer := hasCoords OR
    // linked>1` gate in layouts/lugar/single.html that this mirrors.
    // Detail pages for excluded places still render (direct links keep
    // working with a "no coordinates" placeholder); they are just
    // absent from the explorer's search surface.
    const places = loadJSON('places.json').filter((p) => {
      const hasCoords = p.latitude != null && p.longitude != null;
      const hasLinks = (p._linked_count || 0) > 1;
      return hasCoords || hasLinks;
    });
    await buildIndex(pagefind, 'places', places, 'pagefind-places', forceKeep);
  } else {
    console.log('[generate-pagefind-indices] places module disabled — skipping places index');
  }

  // Tear down the persistent Pagefind service so the Node process can
  // exit cleanly. Without this, `pagefind` keeps a child process alive
  // and `node script.js` hangs after the last bundle is written.
  if (typeof pagefind.close === 'function') {
    await pagefind.close();
  }

  console.log(
    `[generate-pagefind-indices] total: ${((Date.now() - started) / 1000).toFixed(1)}s`
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(
      '[generate-pagefind-indices] Fatal error:',
      (err && err.stack) || err
    );
    process.exit(1);
  });
}

module.exports = {
  FIELD_MAP,
  yearsInRange,
  centuriesInRange,
  decadesInRange,
  romanCentury,
  descriptionYearRange,
  suppressSingleValuedFacets,
};

// Version: v2.2.0
