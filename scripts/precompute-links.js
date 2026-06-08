'use strict';

/**
 * Precompute Entity and Place Link Shards
 *
 * Zasqua's archival records link to historical entities (people, organisations)
 * and places. Those links are stored in large JSON files as flat lists, but at
 * page-render time the site needs a fast reverse index: "given an entity code,
 * which descriptions link to it?" and "given a description reference, which
 * entities and places are mentioned, with what roles?". This script produces
 * those reverse indexes and writes per-code shards to disk so the Eleventy
 * build (later Hugo build) can pick them up without re-deriving on each run.
 *
 * Pipeline context: runs as Stage 1 of `build.sh`, before the static-site
 * build. Reads the contract exports under `exports/` and
 * writes per-entity/per-place shards plus enriched lookup files back into
 * `exports/` — never into Hugo's `data/` directory, which is reserved for
 * small UI strings.
 *
 * Reads:
 *   exports/{entities,places,entity_links,place_links}.json
 * Writes:
 *   exports/entity-links/{code}.json, exports/place-links/{code}.json
 *   exports/doc-entities/{code}.json (per-focal ref_code → [entity_codes] map,
 *     consumed by static/js/infinite-bipartite-explorer.js and static/js/entity.js
 *     for O(1) doc-node expandability resolution; replaces the per-doc
 *     Pagefind descriptions round-trips that stretched to 20–45 s on
 *     large-focal (Bolívar-class) graphs over CDN latency)
 *   exports/{entity-index,place-index,desc-entity-lookup,desc-place-lookup}.json
 *
 * Guarded reads: each optional-module input is gated on the capability
 * manifest loaded from `zasqua.manifest.toml` at the instance root.
 *
 *   Tier 1 — module disabled: skip the entire processing block (no read, no
 *     crash, no warning).
 *   Tier 2 — module enabled but file missing: throw an actionable Error
 *     naming the module and the missing path (belt-and-suspenders below the
 *     validator).
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so that exports/ resolves relative to
 *                    the instance when the engine lives in node_modules.
 *   DATA_DIR   — override the default exports directory (absolute or relative path)
 *   DEV_MODE   — "true" to limit output to DEV_LIMIT shards per type (faster local iteration)
 *   DEV_LIMIT  — integer shard cap when DEV_MODE is enabled (default 500)
 *
 * Output paths are parameterized so the engine and instance can live in
 * separate directories: instance-relative paths resolve from INSTANCE_ROOT
 * (or process.cwd() as a fallback) rather than from the script's own
 * location, which lets the engine run from inside node_modules.
 *
 * The enriched reverse-lookup files (Section 5 below) are gated on the same
 * module flags as the link shards in Sections 1 and 3. They were once written
 * unconditionally — using the empty arrays the disabled sections left behind —
 * which produced stale files that generate-content.js could silently consume
 * if the manifest was toggled between runs. Now both sides agree: the lookup
 * file is absent if and only if its module is disabled.
 *
 * @version v2.2.0
 */

const fs = require('fs');
const path = require('path');
const { loadManifest } = require('../lib/manifest.js');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');
const DEV_MODE = process.env.DEV_MODE === 'true';
const DEV_LIMIT = parseInt(process.env.DEV_LIMIT || '500', 10);

/**
 * Run the guarded main logic with an explicit instance root.
 * Exported for unit testing; called by the CLI entry-point below.
 *
 * @param {string} [instanceRoot] — absolute path to the instance root
 * @returns {Promise<void>}
 */
async function runGuardedMain(instanceRoot) {
  const root = instanceRoot || INSTANCE_ROOT;
  const dataDir = process.env.DATA_DIR || path.join(root, 'exports');
  const devMode = DEV_MODE;
  const devLimit = DEV_LIMIT;

  console.log(`[precompute-links] DATA_DIR: ${dataDir}`);
  if (devMode) {
    console.log(`[precompute-links] DEV_MODE enabled — limiting to ${devLimit} shards per type`);
  }

  const manifest = loadManifest(root);

  // -------------------------------------------------------------------------
  // 1. Entity links: read, group by entity_code, write shards
  //    Tier 1: entities=false → skip entirely
  //    Tier 2: entities=true but files missing → throw loudly
  // -------------------------------------------------------------------------

  // These variables are declared outside the if-block so Stage 5 (enriched
  // reverse lookup) can reference them regardless of whether the entity block
  // ran. When entities is disabled they remain empty, producing empty lookup
  // files — which is the correct graceful-degradation behaviour.
  let entityLinks = [];
  let entities = [];
  let byEntity = new Map();
  let refToEntities = new Map();
  let entityRoles = new Map();
  let entityShardCount = 0;
  let docEntitiesShardCount = 0;
  let entityCodesToWrite = [];
  let entityIndex = [];

  if (!manifest.modules.entities) {
    console.log('[precompute-links] entities module disabled — skipping entity link shards');
  } else {
    // Tier 2: entities enabled but input files missing
    const entityLinksPath = path.join(dataDir, 'entity_links.json');
    if (!fs.existsSync(entityLinksPath)) {
      throw new Error(
        `[entities] module enabled in manifest but ${entityLinksPath} not found — ` +
        'run zasqua validate to check your exports'
      );
    }

    console.log(`[precompute-links] Reading ${entityLinksPath}`);
    const entityLinksRaw = fs.readFileSync(entityLinksPath, 'utf8');
    entityLinks = JSON.parse(entityLinksRaw);
    console.log(`[precompute-links] entity_links.json: ${entityLinks.length} records`);

    // Group by entity_code, and simultaneously build a reference_code →
    // Set<entity_code> reverse map used by the doc-entities shard pass below.
    for (const link of entityLinks) {
      const code = link.entity_code;
      if (!byEntity.has(code)) {
        byEntity.set(code, []);
      }
      byEntity.get(code).push({
        reference_code: link.reference_code,
        title: link.title,
        date_expression: link.date_expression,
        // date_start: ISO YYYY-MM-DD, added by the backend so the client
        // can sort timelines chronologically instead of string-sorting the
        // freeform Spanish date_expression ("12 y 13 de junio de 1756",
        // "1500-1602", "-1587") which is not chronological. `|| null` is
        // defensive for older exports that predate the backend change.
        date_start: link.date_start || null,
        repository_code: link.repository_code,
        role: link.role,
      });
      const ref = link.reference_code;
      if (ref) {
        if (!refToEntities.has(ref)) refToEntities.set(ref, new Set());
        refToEntities.get(ref).add(code);
      }
    }

    // Write per-entity shards
    const entityShardsDir = path.join(dataDir, 'entity-links');
    fs.mkdirSync(entityShardsDir, { recursive: true });

    const entityCodes = Array.from(byEntity.keys());
    entityCodesToWrite = devMode ? entityCodes.slice(0, devLimit) : entityCodes;

    for (const code of entityCodesToWrite) {
      const shardPath = path.join(entityShardsDir, `${code}.json`);
      fs.writeFileSync(shardPath, JSON.stringify(byEntity.get(code)));
      entityShardCount++;
      if (entityShardCount % 10000 === 0) {
        console.log(`[precompute-links] Wrote ${entityShardCount} entity-links shards...`);
      }
    }
    console.log(`[precompute-links] Wrote ${entityShardCount} entity-links shards to ${entityShardsDir}`);

    // -----------------------------------------------------------------------
    // 1b. Doc-entities shards: per focal, write a map of
    //     reference_code → [entity_codes] for the docs linked to that focal.
    //
    // Consumed by static/js/infinite-bipartite-explorer.js and static/js/entity.js
    // to render doc nodes filled (expandable) vs hollow (leaf) without paying
    // per-doc Pagefind descriptions round-trips. Replaces the previous
    // pagefind.search(refCode) + .data() loop whose wall time scaled linearly
    // with CDN latency × focal doc count (20–45 s on Bolívar-class focals on
    // prod; invisible on localhost).
    // -----------------------------------------------------------------------

    const docEntitiesShardsDir = path.join(dataDir, 'doc-entities');
    fs.mkdirSync(docEntitiesShardsDir, { recursive: true });

    for (const code of entityCodesToWrite) {
      const focalLinks = byEntity.get(code) || [];
      const uniqueRefs = new Set();
      for (const l of focalLinks) uniqueRefs.add(l.reference_code);
      const docMap = {};
      for (const ref of uniqueRefs) {
        const ents = refToEntities.get(ref);
        if (ents && ents.size) docMap[ref] = Array.from(ents);
      }
      fs.writeFileSync(
        path.join(docEntitiesShardsDir, `${code}.json`),
        JSON.stringify(docMap)
      );
      docEntitiesShardCount++;
      if (docEntitiesShardCount % 10000 === 0) {
        console.log(`[precompute-links] Wrote ${docEntitiesShardCount} doc-entities shards...`);
      }
    }
    console.log(`[precompute-links] Wrote ${docEntitiesShardCount} doc-entities shards to ${docEntitiesShardsDir}`);

    // -----------------------------------------------------------------------
    // 2. Build entity-index.json (fields)
    // -----------------------------------------------------------------------

    // Compute per-entity roles from entity-link shards
    for (const link of entityLinks) {
      const code = link.entity_code;
      if (!entityRoles.has(code)) {
        entityRoles.set(code, new Set());
      }
      if (link.role) {
        entityRoles.get(code).add(link.role);
      }
    }
    console.log(`[precompute-links] Computed roles for ${entityRoles.size} entities`);

    const entitiesPath = path.join(dataDir, 'entities.json');
    if (!fs.existsSync(entitiesPath)) {
      throw new Error(
        `[entities] module enabled in manifest but ${entitiesPath} not found — ` +
        'run zasqua validate to check your exports'
      );
    }

    console.log(`[precompute-links] Reading ${entitiesPath}`);
    const entitiesRaw = fs.readFileSync(entitiesPath, 'utf8');
    entities = JSON.parse(entitiesRaw);
    console.log(`[precompute-links] entities.json: ${entities.length} records`);

    entityIndex = entities.map(e => ({
      entity_code: e.entity_code,
      display_name: e.display_name,
      sort_name: e.sort_name,
      entity_type: e.entity_type,
      date_earliest: e.date_earliest,
      date_latest: e.date_latest,
      primary_function: e.primary_function,
      linked_description_count: (byEntity.get(e.entity_code) || []).length,
      roles: Array.from(entityRoles.get(e.entity_code) || []),
    }));

    const entityIndexPath = path.join(dataDir, 'entity-index.json');
    fs.writeFileSync(entityIndexPath, JSON.stringify(entityIndex));
    console.log(`[precompute-links] Wrote entity-index.json with ${entityIndex.length} records`);
  }

  // -------------------------------------------------------------------------
  // 3. Place links: read, group by place_code, write shards
  //    Tier 1: places=false → skip entirely
  //    Tier 2: places=true but files missing → throw loudly
  // -------------------------------------------------------------------------

  let placeLinks = [];
  let places = [];
  let byPlace = new Map();
  let placeShardCount = 0;
  let placeCodesToWrite = [];
  let placeIndex = [];

  if (!manifest.modules.places) {
    console.log('[precompute-links] places module disabled — skipping place link shards');
  } else {
    // Tier 2: places enabled but input files missing
    const placeLinksPath = path.join(dataDir, 'place_links.json');
    if (!fs.existsSync(placeLinksPath)) {
      throw new Error(
        `[places] module enabled in manifest but ${placeLinksPath} not found — ` +
        'run zasqua validate to check your exports'
      );
    }

    console.log(`[precompute-links] Reading ${placeLinksPath}`);
    const placeLinksRaw = fs.readFileSync(placeLinksPath, 'utf8');
    placeLinks = JSON.parse(placeLinksRaw);
    console.log(`[precompute-links] place_links.json: ${placeLinks.length} records`);

    // Group by place_code
    let nullPlaceCount = 0;
    for (const link of placeLinks) {
      const code = link.place_code;
      if (code === null || code === undefined) {
        nullPlaceCount++;
        console.warn(`[precompute-links] WARNING: link with null/undefined place_code skipped (reference_code: ${link.reference_code})`);
        continue;
      }
      if (!byPlace.has(code)) {
        byPlace.set(code, []);
      }
      byPlace.get(code).push({
        reference_code: link.reference_code,
        title: link.title,
        date_expression: link.date_expression,
        date_start: link.date_start || null,
        repository_code: link.repository_code,
        role: link.role,
      });
    }
    if (nullPlaceCount > 0) {
      console.warn(`[precompute-links] WARNING: Skipped ${nullPlaceCount} place_links records with null/undefined place_code`);
    }

    // Write per-place shards
    const placeShardsDir = path.join(dataDir, 'place-links');
    fs.mkdirSync(placeShardsDir, { recursive: true });

    const placeCodes = Array.from(byPlace.keys());
    placeCodesToWrite = devMode ? placeCodes.slice(0, devLimit) : placeCodes;

    for (const code of placeCodesToWrite) {
      const shardPath = path.join(placeShardsDir, `${code}.json`);
      fs.writeFileSync(shardPath, JSON.stringify(byPlace.get(code)));
      placeShardCount++;
      if (placeShardCount % 5000 === 0) {
        console.log(`[precompute-links] Wrote ${placeShardCount} place-links shards...`);
      }
    }
    console.log(`[precompute-links] Wrote ${placeShardCount} place-links shards to ${placeShardsDir}`);

    // -----------------------------------------------------------------------
    // 4. Build place-index.json (fields — direct pass-through of latitude/longitude)
    // -----------------------------------------------------------------------

    const placesPath = path.join(dataDir, 'places.json');
    if (!fs.existsSync(placesPath)) {
      throw new Error(
        `[places] module enabled in manifest but ${placesPath} not found — ` +
        'run zasqua validate to check your exports'
      );
    }

    console.log(`[precompute-links] Reading ${placesPath}`);
    const placesRaw = fs.readFileSync(placesPath, 'utf8');
    places = JSON.parse(placesRaw);
    console.log(`[precompute-links] places.json: ${places.length} records`);

    const placeIndexAll = places.map(p => ({
      id: p.id,
      display_name: p.display_name,
      place_type: p.place_type,
      latitude: p.latitude,
      longitude: p.longitude,
      place_code: p.place_code,
      has_wikidata: !!p.wikidata_id,
      has_tgn: !!p.tgn_id,
      has_whg: !!p.whg_id,
      has_hgis: !!p.hgis_id,
      linked_description_count: (byPlace.get(p.place_code) || []).length,
    }));

    // Exclude coordinate-less singletons from the explorer index —
    // places without coordinates and with at most 1 linked document
    // add noise to the explorer without providing useful discovery.
    // The place pages still exist for direct linking.
    placeIndex = placeIndexAll.filter(p =>
      (p.latitude != null && p.longitude != null) || p.linked_description_count > 1
    );
    const excluded = placeIndexAll.length - placeIndex.length;
    if (excluded > 0) {
      console.log(`[precompute-links] Excluded ${excluded} coordinate-less singletons from place-index.json`);
    }

    const placeIndexPath = path.join(dataDir, 'place-index.json');
    fs.writeFileSync(placeIndexPath, JSON.stringify(placeIndex));
    console.log(`[precompute-links] Wrote place-index.json with ${placeIndex.length} records`);
  }

  // -------------------------------------------------------------------------
  // 5. Enriched reverse-lookup files
  //
  // Each lookup file (desc-entity-lookup.json, desc-place-lookup.json) is
  // gated on the same module flag as its upstream inputs. When a module is
  // disabled, the lookup file is not written — consistent with the Tier 1
  // skip above. This keeps the write and read sides of the two-tier guard
  // in agreement: generate-content.js reads these files only when the
  // module is enabled; precompute-links.js now writes them only when enabled.
  //
  // Before this fix (Section 5 ran unconditionally) the two sides could
  // diverge: precompute-links wrote an empty {} when disabled; generate-
  // content never read it (guard skipped it). Result: stale lookup files
  // from a prior enabled run remained on disk and would be silently
  // consumed if the manifest was toggled between runs against a reused
  // exports/ directory. Now both sides agree: file absent ↔ module disabled.
  // -------------------------------------------------------------------------

  // 5a. Entity enriched reverse lookup — only when entities module is enabled
  let descToEntitiesSize = 0;
  if (manifest.modules.entities) {
    const entityByCode = new Map(entities.map(e => [e.entity_code, e]));
    const descToEntities = new Map();

    for (const link of entityLinks) {
      const refCode = link.reference_code;
      const code = link.entity_code;
      if (!descToEntities.has(refCode)) descToEntities.set(refCode, new Map());
      const entMap = descToEntities.get(refCode);
      if (!entMap.has(code)) {
        const ent = entityByCode.get(code);
        entMap.set(code, {
          code,
          display_name: ent ? ent.display_name : code,
          entity_type: ent ? ent.entity_type : 'person',
          roles: [],
        });
      }
      if (link.role) {
        const entry = entMap.get(code);
        if (!entry.roles.includes(link.role)) {
          entry.roles.push(link.role);
        }
      }
    }

    const descEntityLookup = {};
    for (const [refCode, entMap] of descToEntities) {
      descEntityLookup[refCode] = Array.from(entMap.values());
    }

    const descEntityLookupPath = path.join(dataDir, 'desc-entity-lookup.json');
    fs.writeFileSync(descEntityLookupPath, JSON.stringify(descEntityLookup));
    descToEntitiesSize = descToEntities.size;
    console.log(`[precompute-links] Wrote enriched desc-entity-lookup.json with ${descToEntities.size} keys`);
  } else {
    console.log('[precompute-links] entities module disabled — skipping desc-entity-lookup.json');
  }

  // 5b. Place enriched reverse lookup — only when places module is enabled
  let descToPlacesSize = 0;
  if (manifest.modules.places) {
    const placeByCode = new Map(places.map(p => [p.place_code, p]));
    const descToPlaces = new Map();

    for (const link of placeLinks) {
      const code = link.place_code;
      if (code === null || code === undefined) continue;
      const refCode = link.reference_code;
      if (!descToPlaces.has(refCode)) descToPlaces.set(refCode, new Map());
      const placeMap = descToPlaces.get(refCode);
      if (!placeMap.has(code)) {
        const pl = placeByCode.get(code);
        placeMap.set(code, {
          place_code: code,
          display_name: pl ? pl.display_name : code,
        });
      }
    }

    const descPlaceLookup = {};
    for (const [refCode, placeMap] of descToPlaces) {
      descPlaceLookup[refCode] = Array.from(placeMap.values());
    }

    const descPlaceLookupPath = path.join(dataDir, 'desc-place-lookup.json');
    fs.writeFileSync(descPlaceLookupPath, JSON.stringify(descPlaceLookup));
    descToPlacesSize = descToPlaces.size;
    console.log(`[precompute-links] Wrote enriched desc-place-lookup.json with ${descToPlaces.size} keys`);
  } else {
    console.log('[precompute-links] places module disabled — skipping desc-place-lookup.json');
  }

  // -------------------------------------------------------------------------
  // 6. Summary
  // -------------------------------------------------------------------------

  console.log(`[precompute-links] Done.`);
  console.log(`  Entity shards written      : ${entityShardCount}`);
  console.log(`  Doc-entities shards written: ${docEntitiesShardCount}`);
  console.log(`  Place shards written       : ${placeShardCount}`);
  console.log(`  entity-index records       : ${entityIndex.length}`);
  console.log(`  place-index records        : ${placeIndex.length}`);
  console.log(`  desc-entity-lookup keys    : ${descToEntitiesSize}`);
  console.log(`  desc-place-lookup keys     : ${descToPlacesSize}`);
}

module.exports = { runGuardedMain };

// Version: v2.2.0

if (require.main === module) {
  runGuardedMain().catch(err => {
    console.error('[precompute-links] Fatal error:', err);
    process.exit(1);
  });
}
