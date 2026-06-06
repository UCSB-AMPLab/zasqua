#!/usr/bin/env node
/**
 * Generate Hugo Content JSON
 *
 * This script does the heavy lifting between the raw Zasqua archival
 * exports and the Hugo static-site build. It reads the canonical B2
 * downloads under `exports/`, attaches every piece of computed context
 * each Hugo template will need (breadcrumb chains, pre-formatted dates,
 * inline repository objects, translated role labels, linked-document
 * counts), and writes three denormalised JSON files to `assets/hugo-
 * data/` — one for descriptions, one for entities, one for places.
 *
 * Why pre-enrich: Hugo's Go template language is capable but slow at
 * repeated lookups over large arrays; doing the work once here in Node
 * (where all the existing logic already lives) saves minutes per build
 * at the Zasqua scale (192K pages).
 * It also means every byte of date formatting, cycle protection, and
 * role translation is covered by the vitest suite — not buried in Go
 * templates where it would be untestable in isolation.
 *
 * Pipeline context:
 *   Runs in `build.sh` AFTER `scripts/precompute-links.js` and BEFORE
 *   the `hugo` command. Reads `exports/*.json` plus the reverse-lookup
 *   files from precompute-links; writes `assets/hugo-data/*.json`.
 *
 * Inputs (all under exports/):
 *   descriptions.json, entities.json, places.json, repositories.json
 *   desc-entity-lookup.json, desc-place-lookup.json
 *   entity-links/{code}.json (one file per entity, length = _linked_count)
 *   place-links/{code}.json  (same for places)
 *
 * Outputs (under assets/hugo-data/):
 *   descriptions/NNN.json — enriched records for one fixed-size shard
 *                        (SHARD_SIZE = 20,000); every record carries
 *                        ancestor_chain, date_formatted, repository
 *                        (inline), entity_links, place_links, plus
 *                        pass-through ISAD(G) fields. Fixed record-count
 *                        sharding is universal — any corpus, any repo
 *                        distribution, always under V8's 512 MiB max-
 *                        string limit. Records are sorted by
 *                        (repository_code, reference_code) before
 *                        sharding so shards remain locally browsable.
 *   descriptions-index.json — { reference_code: shard_filename } lookup
 *                        so templates and tests can locate any record's
 *                        shard in O(1).
 *   entities.json     — display_name, date_formatted range, _linked_count,
 *                        and pass-through ISAAR CPF fields.
 *   places.json       — display_name, _linked_count, pass-through fields.
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI before invoking this script so that
 *                    instance-relative output paths (exports/, assets/hugo-data/)
 *                    resolve correctly when the engine lives in node_modules.
 *   DATA_DIR       — override the default `exports/` directory
 *   HUGO_DATA_DIR  — override the default `assets/hugo-data/` output directory
 *   DEV_LIMIT  — integer cap on each output array (fast local iteration);
 *                the ancestor-chain index is still built from the FULL set
 *                so truncated subsets don't lose their breadcrumbs.
 *
 * Exits 0 on success, 1 on any IO error, 2 on an ancestor-chain cycle
 * (a backend data bug — fail loudly so it gets fixed upstream).
 *
 * Side-step: copies repositories.json verbatim from exports/ to
 * assets/hugo-data/ so the Hugo home-page template can load it via
 * `resources.Get` and render description counts identical to what
 * Eleventy emits.
 *
 * Guarded reads: the optional-module input files (entities.json,
 * places.json, desc-entity-lookup.json, desc-place-lookup.json) are loaded
 * only when the corresponding module is enabled in the capability manifest.
 * When disabled, the variable defaults to an empty array or object so that
 * the enrichment functions receive an empty collection and the rest of the
 * pipeline proceeds without error. Core files (descriptions.json,
 * repositories.json) remain unguarded — they are always required.
 *
 * Output paths are parameterized so the engine and the instance can live in
 * separate directories: instance-relative paths resolve from INSTANCE_ROOT
 * (or process.cwd() as a fallback) rather than from the script's own
 * location, which lets the engine run from inside node_modules.
 *
 * The optional-module reads use a two-tier guard, the same pattern as
 * precompute-links.js: when a module is disabled the read is skipped and an
 * empty collection returned; when a module is enabled but its file is absent,
 * the script throws an actionable Error naming the module and the missing
 * path rather than letting a raw ENOENT stack escape.
 *
 * @version v2.2.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { formatDateNarrative, SPANISH_MONTHS } = require('./enrichment/date-format.js');
const { numberFormat } = require('./enrichment/number-format.js');
const { buildAncestorChain } = require('./enrichment/ancestor-chain.js');
const { enrichEntityLinks, enrichPlaceLinks } = require('./enrichment/link-enrichment.js');
const { loadManifest } = require('../lib/manifest.js');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');
const OUT_DIR = process.env.HUGO_DATA_DIR || path.join(INSTANCE_ROOT, 'assets', 'hugo-data');
const DEV_LIMIT = process.env.DEV_LIMIT ? Number(process.env.DEV_LIMIT) : null;

function readJSON(relPath) {
  const full = path.join(DATA_DIR, relPath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function writeJSON(name, data) {
  const full = path.join(OUT_DIR, name);
  if (DEV_LIMIT) {
    fs.writeFileSync(full, JSON.stringify(data, null, 2));
    return;
  }
  // Stream the output. The enriched descriptions.json exceeds V8's 512 MB
  // max string length on the full dataset, so JSON.stringify on the whole
  // array crashes with "Invalid string length". Write record-by-record.
  if (!Array.isArray(data)) {
    fs.writeFileSync(full, JSON.stringify(data));
    return;
  }
  const fd = fs.openSync(full, 'w');
  try {
    fs.writeSync(fd, '[');
    for (let i = 0; i < data.length; i++) {
      fs.writeSync(fd, (i > 0 ? ',' : '') + JSON.stringify(data[i]));
    }
    fs.writeSync(fd, ']');
  } finally {
    fs.closeSync(fd);
  }
}

function entityDisplayName(entity) {
  if (entity.display_name) return entity.display_name;
  const parts = [entity.given_name, entity.surname].filter(Boolean);
  return parts.length ? parts.join(' ') : entity.entity_code;
}

function loadLinkedCounts(indexFile, keyField) {
  const map = new Map();
  try {
    const index = readJSON(indexFile);
    for (const entry of index) {
      map.set(entry[keyField], entry.linked_description_count || 0);
    }
  } catch {
    // Index missing — caller treats unset codes as 0
  }
  return map;
}

function enrichDescriptions(descriptions, byRefCode, reposByCode, descEntityLookup, descPlaceLookup, rolesMap) {
  return descriptions.map(desc => ({
    ...desc,
    ancestor_chain: buildAncestorChain(desc, byRefCode),
    repository: reposByCode.get(desc.repository_code) || null,
    date_formatted: formatDateNarrative(desc.date_expression),
    entity_links: enrichEntityLinks(desc.reference_code, descEntityLookup, rolesMap),
    place_links: enrichPlaceLinks(desc.reference_code, descPlaceLookup),
  }));
}

function enrichEntities(entities, countByCode) {
  return entities.map(entity => ({
    ...entity,
    display_name: entityDisplayName(entity),
    date_formatted: formatDateNarrative(entity.dates_of_existence) || entity.dates_of_existence || '',
    _linked_count: countByCode.get(entity.entity_code) || 0,
  }));
}

function enrichPlaces(places, countById) {
  return places.map(place => ({
    ...place,
    display_name: place.display_name || place.place_code,
    _linked_count: countById.get(place.id) || 0,
  }));
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[generate-content] DATA_DIR=${DATA_DIR}`);
  if (DEV_LIMIT) console.log(`[generate-content] DEV_LIMIT=${DEV_LIMIT}`);

  // Copy repositories.json verbatim to assets/hugo-data/ so the Hugo
  // home-page template can load it via `resources.Get` and keep
  // description counts identical to the Eleventy build's behaviour.
  const repositoriesSrc = path.join(DATA_DIR, 'repositories.json');
  const repositoriesDst = path.join(OUT_DIR, 'repositories.json');
  if (fs.existsSync(repositoriesSrc)) {
    fs.copyFileSync(repositoriesSrc, repositoriesDst);
    console.log(`[generate-content] repositories.json copied (${fs.statSync(repositoriesDst).size.toLocaleString()} bytes)`);
  } else {
    console.warn(`[generate-content] WARN: ${repositoriesSrc} not found — home page repo grid will fail until this file exists`);
  }

  const manifest = loadManifest(INSTANCE_ROOT);

  // Core reads — always required, never guarded
  const descriptions = readJSON('descriptions.json');
  const repositories = readJSON('repositories.json');

  // Optional-module reads — gated on the capability manifest.
  //
  // Two-tier guard pattern (consistent with precompute-links.js):
  //   Tier 1 — module disabled: skip the read entirely, return empty collection.
  //   Tier 2 — module enabled but file absent: throw an actionable Error naming
  //     the module and the missing path. A raw ENOENT here would hide which
  //     pipeline step was supposed to produce the file.
  //
  // When a module is disabled, the empty default means the enrichment functions
  // downstream receive [] / {} and produce no entity/place links on enriched
  // records.

  function readOptionalModule(moduleName, fileName, defaultValue) {
    if (!manifest.modules[moduleName]) return defaultValue;
    const full = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(full)) {
      throw new Error(
        `[${moduleName}] module enabled in manifest but ${full} not found — ` +
        'run zasqua build (zasqua fetch + precompute-links) to generate this file, ' +
        'or run zasqua validate to check your exports'
      );
    }
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  }

  const entities = readOptionalModule('entities', 'entities.json', []);
  const places = readOptionalModule('places', 'places.json', []);
  const descEntityLookup = readOptionalModule('entities', 'desc-entity-lookup.json', {});
  const descPlaceLookup = readOptionalModule('places', 'desc-place-lookup.json', {});

  const ui = require(path.join(__dirname, 'enrichment', 'ui-data.js'));
  const rolesMap = ui.roles || {};

  const byRefCode = new Map();
  for (const d of descriptions) byRefCode.set(d.reference_code, d);
  const reposByCode = new Map();
  for (const r of repositories) reposByCode.set(r.code, r);

  const descSlice = DEV_LIMIT ? descriptions.slice(0, DEV_LIMIT) : descriptions;
  const entitySlice = DEV_LIMIT ? entities.slice(0, DEV_LIMIT) : entities;
  const placeSlice = DEV_LIMIT ? places.slice(0, DEV_LIMIT) : places;

  const descStart = Date.now();
  const enrichedDescs = enrichDescriptions(descSlice, byRefCode, reposByCode, descEntityLookup, descPlaceLookup, rolesMap);
  // Shard by a fixed record count. One unified descriptions.json at the
  // full scale would weigh ~610 MB — over V8's 512 MiB max-string limit,
  // which means no Node consumer could JSON.parse it. Sharding by
  // `repository_code` happens to work on the current corpus (biggest
  // repo 302 MB) but is data-dependent and fragile: a future lopsided
  // ingest could produce a single 650 MB repo and re-break everything.
  //
  // A fixed record-count shard is universal — it's bounded by design
  // regardless of how records are distributed across repositories.
  // SHARD_SIZE is chosen so the compressed-output size stays well
  // under 512 MiB with comfortable headroom: at ~6 KB per enriched
  // record, 20,000 records ≈ 120 MB. Records are sorted by
  // `(repository_code, reference_code)` first so each shard is locally
  // browsable (same-repo records cluster together) — the shard filename
  // itself carries no semantic meaning.
  //
  // The companion descriptions-index.json maps every reference_code to
  // its shard filename so the Hugo adapter (or any consumer)
  // can locate a record in O(1) without iterating shards.
  const SHARD_SIZE = 20000;
  fs.mkdirSync(path.join(OUT_DIR, 'descriptions'), { recursive: true });
  const sortedDescs = [...enrichedDescs].sort((a, b) => {
    const ra = a.repository_code || '_unknown';
    const rb = b.repository_code || '_unknown';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.reference_code < b.reference_code ? -1 : a.reference_code > b.reference_code ? 1 : 0;
  });
  const shardCount = Math.max(1, Math.ceil(sortedDescs.length / SHARD_SIZE));
  const padWidth = Math.max(3, String(shardCount - 1).length);
  const descIndex = {};
  const shardSizes = [];
  for (let i = 0; i < shardCount; i++) {
    const chunk = sortedDescs.slice(i * SHARD_SIZE, (i + 1) * SHARD_SIZE);
    const shardName = `${String(i).padStart(padWidth, '0')}.json`;
    writeJSON(path.join('descriptions', shardName), chunk);
    for (const d of chunk) descIndex[d.reference_code] = shardName;
    shardSizes.push(`${shardName}=${numberFormat(chunk.length)}`);
  }
  writeJSON('descriptions-index.json', descIndex);
  console.log(`[generate-content] descriptions: ${numberFormat(enrichedDescs.length)} enriched in ${((Date.now() - descStart) / 1000).toFixed(1)}s (${shardCount} shard${shardCount === 1 ? '' : 's'} × ${numberFormat(SHARD_SIZE)}/shard: ${shardSizes.join(', ')})`);

  const entStart = Date.now();
  const entityCounts = loadLinkedCounts('entity-index.json', 'entity_code');
  const enrichedEntities = enrichEntities(entitySlice, entityCounts);
  writeJSON('entities.json', enrichedEntities);
  console.log(`[generate-content] entities: ${numberFormat(enrichedEntities.length)} enriched in ${((Date.now() - entStart) / 1000).toFixed(1)}s`);

  const placeStart = Date.now();
  const placeCounts = loadLinkedCounts('place-index.json', 'id');
  const enrichedPlaces = enrichPlaces(placeSlice, placeCounts);
  writeJSON('places.json', enrichedPlaces);
  console.log(`[generate-content] places: ${numberFormat(enrichedPlaces.length)} enriched in ${((Date.now() - placeStart) / 1000).toFixed(1)}s`);

  console.log(`[generate-content] total: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

module.exports = {
  formatDateNarrative,
  SPANISH_MONTHS,
  numberFormat,
  buildAncestorChain,
  enrichEntityLinks,
  enrichPlaceLinks,
  entityDisplayName,
};

if (require.main === module) {
  main().catch(err => {
    console.error('[generate-content] Fatal error:', (err && err.stack) || err);
    const isCycle = err && err.message && err.message.includes('ancestor cycle');
    process.exit(isCycle ? 2 : 1);
  });
}

// Version: v2.2.0
