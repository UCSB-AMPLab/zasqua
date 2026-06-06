/**
 * CollectiveAccess Import Adapter — CA Web-Services JSON Reference Adapter
 *
 * This module deals with converting a CollectiveAccess web-services JSON
 * export into the six-file JSON contract that `zasqua validate` and
 * `zasqua build` consume. It is the runnable proof for the database-mapping
 * contract documented at `docs/importers/collectiveaccess-mapping.md`.
 *
 * Scope: the adapter reads CollectiveAccess web-services JSON — there is no
 * live database connection. It pairs a documented database-mapping contract
 * with one runnable reference adapter exercised against a fixture.
 *
 * The CollectiveAccess data model is assumed rather than verified — the
 * fixture and this adapter are authored against the documented model. Verify
 * against a real CollectiveAccess export before relying on this adapter in
 * production. See the corresponding note in the mapping contract doc.
 *
 * All text fields are run through `sanitizeField` from `lib/sanitize.js` so
 * that imported markup cannot inject scripts into the published site. The
 * georeference string "lat,lng" is split and coerced to numeric
 * latitude/longitude; non-numeric values become null.
 *
 * Integer `id` fields for descriptions, repositories, and places are
 * auto-generated as sequential 1-based integers when the source lacks them.
 *
 * Public API:
 *
 *   run({ src, stagingDir, standard })
 *     Read the CA web-services JSON array from `src`, map each object record
 *     per the DB-mapping contract, collect unique entities and places,
 *     run all text through sanitizeField, and write six JSON contract files
 *     to `stagingDir`.
 *
 * Dependencies: sanitize.js.
 *
 * @version v0.1.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sanitizeField } = require('../sanitize');

// ---------------------------------------------------------------------------
// Vocabulary maps
// ---------------------------------------------------------------------------

/** CA object type → contract description_level */
const LEVEL_MAP = {
  fonds:     'fonds',
  subfonds:  'subfonds',
  series:    'series',
  subseries: 'subseries',
  file:      'file',
  item:      'item',
  collection:'collection',
};

/** CA entity type code → contract entity_type */
const ENTITY_TYPE_MAP = {
  ind: 'person',
  org: 'corporateBody',
  fam: 'family',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a CA type name to a contract description_level key.
 * Falls back to 'item' for unrecognised types.
 *
 * @param {string} caType
 * @returns {string}
 */
function mapLevel(caType) {
  return LEVEL_MAP[caType] || 'item';
}

/**
 * Map a CA entity type code to a contract entity_type value.
 * Falls back to 'person' for unrecognised types.
 *
 * @param {string} caType
 * @returns {string}
 */
function mapEntityType(caType) {
  return ENTITY_TYPE_MAP[caType] || 'person';
}

/**
 * Extract the preferred label name for the first label in the array.
 * Returns an empty string if no labels exist.
 *
 * @param {Array} preferredLabels - CA preferred_labels array
 * @returns {string}
 */
function extractLabel(preferredLabels) {
  if (!Array.isArray(preferredLabels) || preferredLabels.length === 0) return '';
  return sanitizeField(preferredLabels[0].name || '');
}

/**
 * Coerce a coordinate value to a finite, range-validated number or null.
 * Rejects NaN, Infinity, hex (0x…), scientific-notation (1e9), and values
 * outside the valid range (±90 for latitude, ±180 for longitude).
 *
 * @param {*}      v   — raw coordinate value
 * @param {number} max — valid absolute range (90 or 180)
 * @returns {number|null}
 */
function toCoord(v, max) {
  if (v === undefined || v === '' || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

/**
 * Parse a CA georeference string "lat,lng" into numeric latitude/longitude.
 * Non-numeric, non-finite, or out-of-range values become null.
 *
 * @param {string} georef - e.g. "4.7110,-74.0721"
 * @returns {{ latitude: number|null, longitude: number|null }}
 */
function parseGeoreference(georef) {
  if (typeof georef !== 'string' || georef.trim() === '') {
    return { latitude: null, longitude: null };
  }
  const commaIdx = georef.indexOf(',');
  if (commaIdx === -1) return { latitude: null, longitude: null };

  const latStr = georef.slice(0, commaIdx).trim();
  const lngStr = georef.slice(commaIdx + 1).trim();

  return {
    latitude:  toCoord(latStr,  90),
    longitude: toCoord(lngStr, 180),
  };
}

/**
 * Derive the entity_code for a CA entity.
 * Prefixes the integer entity_id with "ne-" to produce a string code.
 *
 * @param {number|string} entityId
 * @returns {string}
 */
function entityCode(entityId) {
  return `ne-${entityId}`;
}

/**
 * Derive the place_code for a CA place.
 * Prefixes the integer place_id with "nl-" to produce a string code.
 *
 * @param {number|string} placeId
 * @returns {string}
 */
function placeCode(placeId) {
  return `nl-${placeId}`;
}

// ---------------------------------------------------------------------------
// Record processors
// ---------------------------------------------------------------------------

/**
 * Convert a CA web-services object record into a contract description record.
 *
 * @param {object} obj   - CA object record
 * @param {number} index - 0-based position (used for auto-id)
 * @returns {object} contract description record
 */
function processObject(obj, index) {
  const parentCollection = Array.isArray(obj.ca_objects_x_collections) &&
    obj.ca_objects_x_collections.length > 0
    ? obj.ca_objects_x_collections[0].idno || null
    : null;

  const repoCode = (obj.repository && (obj.repository.code || obj.repository.idno)) || '';

  const iiifUrl = Array.isArray(obj.ca_object_representations) &&
    obj.ca_object_representations.length > 0 &&
    obj.ca_object_representations[0].iiif_manifest_url
    ? obj.ca_object_representations[0].iiif_manifest_url
    : '';

  return {
    id:                      index + 1,
    reference_code:          obj.idno || '',
    title:                   extractLabel(obj.preferred_labels),
    description_level:       mapLevel(obj.type || ''),
    parent_reference_code:   parentCollection,
    repository_code:         repoCode,
    date_expression:         sanitizeField(obj.date_expression || ''),
    date_start:              obj.date_start || '',
    scope_content:           sanitizeField(obj.scope_and_content || ''),
    extent:                  sanitizeField(obj.extent_and_medium || ''),
    arrangement:             sanitizeField(obj.arrangement || ''),
    access_conditions:       sanitizeField(obj.access_conditions || ''),
    reproduction_conditions: sanitizeField(obj.reproduction_conditions || ''),
    language:                obj.language || '',
    location_of_originals:   sanitizeField(obj.location_of_originals || ''),
    location_of_copies:      sanitizeField(obj.location_of_copies || ''),
    related_materials:       sanitizeField(obj.related_materials || ''),
    finding_aids:            sanitizeField(obj.finding_aids || ''),
    notes:                   sanitizeField(obj.notes || ''),
    iiif_manifest_url:       iiifUrl,
    ocr_text:                '',
  };
}

/**
 * Extract the unique repository record from CA object records.
 * Returns a single-element array since CA objects in a fixture
 * are expected to belong to the same repository.
 *
 * @param {object[]} objects - array of CA object records
 * @returns {object[]} array of contract repository records
 */
function extractRepositories(objects) {
  const seen = new Map();
  for (const obj of objects) {
    if (!obj.repository) continue;
    const code = obj.repository.code || obj.repository.idno || '';
    if (!code || seen.has(code)) continue;
    seen.set(code, {
      id:         seen.size + 1,
      code:       code,
      name:       sanitizeField(obj.repository.name || ''),
      short_name: sanitizeField(obj.repository.short_name || ''),
      country:    obj.repository.country || '',
      city:       sanitizeField(obj.repository.city || ''),
    });
  }
  return Array.from(seen.values());
}

/**
 * Collect unique entity records from all CA objects.
 * Deduplication is by entity_id.
 *
 * @param {object[]} objects - array of CA object records
 * @returns {object[]} array of contract entity records
 */
function extractEntities(objects) {
  const seen = new Map();
  for (const obj of objects) {
    if (!Array.isArray(obj.ca_entities)) continue;
    for (const ent of obj.ca_entities) {
      if (seen.has(ent.entity_id)) continue;
      seen.set(ent.entity_id, {
        entity_code:  entityCode(ent.entity_id),
        display_name: sanitizeField(ent.displayname || ''),
        entity_type:  mapEntityType(ent.type || ''),
        given_name:   sanitizeField(ent.forename || ''),
        surname:      sanitizeField(ent.surname || ''),
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Build entity_links from all CA objects.
 *
 * @param {object[]} objects - array of CA object records
 * @returns {object[]} array of contract entity_link records
 */
function extractEntityLinks(objects) {
  const links = [];
  for (const obj of objects) {
    if (!Array.isArray(obj.ca_entities)) continue;
    for (const ent of obj.ca_entities) {
      links.push({
        entity_code:    entityCode(ent.entity_id),
        reference_code: obj.idno || '',
        role:           sanitizeField(ent.relationship_typename || ''),
      });
    }
  }
  return links;
}

/**
 * Collect unique place records from all CA objects.
 * Deduplication is by place_id.
 *
 * @param {object[]} objects - array of CA object records
 * @returns {object[]} array of contract place records
 */
function extractPlaces(objects) {
  const seen = new Map();
  for (const obj of objects) {
    if (!Array.isArray(obj.ca_places)) continue;
    for (const pl of obj.ca_places) {
      if (seen.has(pl.place_id)) continue;
      const { latitude, longitude } = parseGeoreference(pl.georeference || '');
      seen.set(pl.place_id, {
        id:           seen.size + 1,
        place_code:   placeCode(pl.place_id),
        display_name: sanitizeField(pl.name || ''),
        place_type:   pl.type || '',
        latitude,
        longitude,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Build place_links from all CA objects.
 *
 * @param {object[]} objects - array of CA object records
 * @returns {object[]} array of contract place_link records
 */
function extractPlaceLinks(objects) {
  const links = [];
  for (const obj of objects) {
    if (!Array.isArray(obj.ca_places)) continue;
    for (const pl of obj.ca_places) {
      links.push({
        place_code:     placeCode(pl.place_id),
        reference_code: obj.idno || '',
        role:           sanitizeField(pl.relationship_typename || ''),
      });
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Convert a CA web-services JSON fixture into the six-file contract.
 *
 * @param {object} opts
 * @param {string} opts.src        — path to the CA JSON fixture file
 * @param {string} opts.stagingDir — directory to write JSON output into
 * @param {string} [opts.standard] — descriptive standard key (unused by this
 *                                   adapter; passed through for API symmetry)
 */
async function run({ src, stagingDir }) {
  const srcPath = path.resolve(src);
  const raw = fs.readFileSync(srcPath, 'utf8');
  const objects = JSON.parse(raw);

  if (!Array.isArray(objects)) {
    throw new Error(
      `[import collectiveaccess] expected a JSON array of CA object records in: ${srcPath}`
    );
  }

  // ---- Clean staging dir of any prior contract files ----------------------
  const CONTRACT_FILES = [
    'descriptions.json', 'repositories.json', 'entities.json',
    'entity_links.json', 'places.json', 'place_links.json',
  ];
  for (const f of CONTRACT_FILES) {
    const p = path.join(stagingDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  // ---- Map records ---------------------------------------------------------
  const descriptions = objects.map((obj, i) => processObject(obj, i));
  const repositories = extractRepositories(objects);
  const entities     = extractEntities(objects);
  const entity_links = extractEntityLinks(objects);
  const places       = extractPlaces(objects);
  const place_links  = extractPlaceLinks(objects);

  // ---- Write six contract files -------------------------------------------
  const write = (name, data) =>
    fs.writeFileSync(path.join(stagingDir, name), JSON.stringify(data, null, 2), 'utf8');

  write('descriptions.json',  descriptions);
  write('repositories.json',  repositories);
  write('entities.json',      entities);
  write('entity_links.json',  entity_links);
  write('places.json',        places);
  write('place_links.json',   place_links);
}

module.exports = { run };

// Version: v0.2.0
