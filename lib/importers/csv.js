/**
 * CSV Import Adapter
 *
 * This module deals with converting an archivist's model-CSV dataset
 * (descriptions.csv plus optional repositories.csv, entities.csv, places.csv,
 * entity_links.csv, place_links.csv) into the six-file JSON contract that
 * `zasqua validate` and `zasqua build` consume.
 *
 * Column headers in every CSV must match canonical contract field names
 * exactly. Unrecognised column names emit a warning to stderr but do not
 * abort the import — a typo'd header should not silently lose data, but it
 * also should not stop a large dataset from importing. The adapter
 * auto-generates sequential integer `id` fields for descriptions,
 * repositories, and places when the source CSV does not supply one. Every
 * text field is run through `sanitizeField` from `lib/sanitize.js` at import
 * time so that imported markup cannot inject scripts into the published site.
 *
 * The `@file:` convention for `ocr_text`: if a cell value begins with
 * `@file:`, the adapter resolves the trailing path relative to the CSV
 * directory and reads the referenced file's content as the field value. Paths
 * containing `..` segments or that resolve to an absolute path outside the CSV
 * directory are rejected with an error — an import dataset must never be able
 * to read arbitrary files off the importing machine.
 *
 * Public API:
 *
 *   run({ src, stagingDir, standard })
 *     Read up to six CSV sheets from `src` (path to the CSV directory),
 *     sanitise every text field, resolve any @file: ocr_text references,
 *     and write six JSON files to `stagingDir`.
 *
 * Dependencies: csv-parse 6.2.1 (MIT, adaltas/node-csv), sanitize.js.
 *
 * @version v0.1.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse }         = require('csv-parse/sync');
const { sanitizeField } = require('../sanitize');

// ---------------------------------------------------------------------------
// Contract field sets — used for header validation
// ---------------------------------------------------------------------------

/**
 * Canonical contract column names for each sheet. Columns outside these sets
 * are unrecognised and warrant a warning.
 */
const CONTRACT_FIELDS = {
  descriptions: new Set([
    'id', 'reference_code', 'title', 'description_level',
    'parent_reference_code', 'repository_code',
    'date_expression', 'date_start', 'scope_content', 'extent',
    'arrangement', 'access_conditions', 'reproduction_conditions',
    'language', 'location_of_originals', 'location_of_copies',
    'related_materials', 'finding_aids', 'notes',
    'iiif_manifest_url', 'mets_url', 'ocr_text',
    'country', 'descriptive_standard',
  ]),
  repositories: new Set([
    'id', 'code', 'name', 'short_name', 'country', 'city',
    'url', 'descriptive_standard',
  ]),
  entities: new Set([
    'entity_code', 'display_name', 'entity_type', 'sort_name',
    'given_name', 'surname', 'honorific',
    'date_earliest', 'date_latest', 'dates_of_existence',
    'primary_function', 'history', 'viaf_id', 'dbe_id', 'name_variants',
  ]),
  entity_links: new Set([
    'entity_code', 'reference_code', 'role', 'title',
    'date_expression', 'repository_code', 'role_raw',
  ]),
  places: new Set([
    'id', 'place_code', 'display_name', 'place_type', 'country_code',
    'latitude', 'longitude', 'wikidata_id', 'tgn_id', 'whg_id', 'hgis_id',
    'name_variants',
  ]),
  place_links: new Set([
    'place_code', 'reference_code', 'role',
  ]),
};

// ---------------------------------------------------------------------------
// csv-parse configuration
// ---------------------------------------------------------------------------

/** Options used for every parse() call across all sheets. */
const PARSE_OPTS = {
  columns:             true,
  skip_empty_lines:    true,
  bom:                 true,
  trim:                true,
  relax_column_count:  true,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Coerce a coordinate string/number to a finite, range-validated number.
 * Returns null for any value that is NaN, non-finite, or outside the valid
 * range for the given axis (±90 for latitude, ±180 for longitude).
 *
 * Number() accepts hex (0x4A), scientific notation (1e9), and Infinity —
 * all of which would pass a bare isNaN() guard and produce coordinates far
 * outside the valid lat/lon range.
 *
 * @param {*}      v   — raw coordinate value
 * @param {number} max — upper bound of the valid absolute range (90 or 180)
 * @returns {number|null}
 */
function toCoord(v, max) {
  if (v === undefined || v === '' || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return n;
}

/**
 * Emit a warning for each column name not in the canonical set for a sheet.
 *
 * @param {string}   sheetName — e.g. 'descriptions'
 * @param {string[]} headers   — column names found in the CSV
 */
function warnUnknownColumns(sheetName, headers) {
  const known = CONTRACT_FIELDS[sheetName] || new Set();
  for (const col of headers) {
    if (!known.has(col)) {
      process.stderr.write(
        `[import csv] warning: column "${col}" in ${sheetName}.csv is not a canonical ` +
        `contract field name. Check your column headers match the contract specification.\n`
      );
    }
  }
}

/**
 * Resolve an @file: ocr_text reference to the file's content.
 *
 * Rejects absolute paths and paths containing `..` segments. After resolving,
 * uses `fs.realpathSync` on both the target and csvDir to follow any symlinks
 * and re-asserts the real target path still starts with the real csvDir +
 * path.sep — this blocks symlink escape where a symlink inside the CSV
 * directory points outside it.
 *
 * @param {string} csvDir — absolute path to the CSV directory
 * @param {string} ref    — the cell value, e.g. `@file:ocr/page1.txt`
 * @returns {string} file content
 * @throws  {Error}  if the path is unsafe or the file does not exist
 */
function resolveFileRef(csvDir, ref) {
  const relativePart = ref.slice('@file:'.length);

  // Reject absolute paths — an @file: reference must stay inside the CSV dir
  if (path.isAbsolute(relativePart)) {
    throw new Error(
      `[import csv] @file: path must be relative (absolute path rejected): "${relativePart}"`
    );
  }

  // Reject paths containing .. segments — block directory traversal
  const normalized = path.normalize(relativePart);
  if (normalized.startsWith('..') || normalized.includes(path.sep + '..')) {
    throw new Error(
      `[import csv] @file: path must not escape the CSV directory (.. rejected): "${relativePart}"`
    );
  }

  const resolvedPath = path.join(csvDir, relativePart);

  // Lexical safety check: resolved path must remain inside csvDir
  if (!resolvedPath.startsWith(csvDir + path.sep) && resolvedPath !== csvDir) {
    throw new Error(
      `[import csv] @file: resolved path is outside the CSV directory: "${resolvedPath}"`
    );
  }

  // Symlink-escape guard: resolve real paths (following any symlinks) and
  // re-assert the real target still starts with real csvDir.
  // Without this check, a symlink inside csvDir (e.g. ocr/leak -> /etc/passwd)
  // passes the lexical checks above but reads outside the directory at runtime.
  const realCsvDir  = fs.realpathSync(csvDir);
  let   realTarget;
  try {
    realTarget = fs.realpathSync(resolvedPath);
  } catch (_) {
    // realpathSync throws if the path doesn't exist — let readFileSync report
    // the proper error below.
    realTarget = resolvedPath;
  }
  if (!realTarget.startsWith(realCsvDir + path.sep) && realTarget !== realCsvDir) {
    throw new Error(
      `[import csv] @file: resolved real path escapes the CSV directory (symlink?): "${realTarget}"`
    );
  }

  return fs.readFileSync(realTarget, 'utf8');
}

/**
 * Parse a single CSV sheet file from `csvDir` (if it exists) and return an
 * array of raw row objects. If the file does not exist, returns null.
 *
 * @param {string} csvDir    — absolute path to the CSV directory
 * @param {string} fileName  — e.g. 'entities.csv'
 * @returns {object[]|null}
 */
function readSheet(csvDir, fileName) {
  const filePath = path.join(csvDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return parse(content, PARSE_OPTS);
}

/**
 * Sanitise every string value in a raw row object and return a new object.
 * Non-string values are returned as-is (they come from CSV, so practically
 * everything is a string, but explicit id coercion is handled separately).
 *
 * @param {object} row
 * @returns {object}
 */
function sanitizeRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === 'string') {
      out[key] = sanitizeField(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Coerce an `id` field from a sanitised row to a number, or generate a
 * sequential integer if the row lacks one or the value is empty.
 *
 * @param {object} row   — sanitised row
 * @param {number} index — 0-based position in the array (used for auto-id)
 * @returns {number}
 */
function coerceId(row, index) {
  if (row.id !== undefined && row.id !== '' && row.id !== null) {
    const n = Number(row.id);
    // Restrict to plain finite integers only. Number() accepts hex (0x10),
    // scientific notation (1e3), and Infinity — none of which are valid id
    // values. Number.isInteger rejects floats and Infinity; Number.isFinite
    // rejects Infinity and NaN. Hex and scientific-notation strings that
    // happen to parse as non-integers (e.g. 1e3 = 1000) are also caught
    // because 1000 IS an integer — but a CSV literal `1e3` should never
    // silently become id 1000. We guard that by also requiring the string
    // representation to not contain 'e', 'E', 'x', or 'X'.
    const raw = String(row.id).trim();
    if (
      Number.isInteger(n) &&
      Number.isFinite(n) &&
      !/[eExX]/.test(raw)
    ) return n;
  }
  return index + 1; // 1-based auto-id when the source row supplies none
}

/**
 * Handle the @file: ocr_text convention: if `val` starts with `@file:`,
 * read the referenced file. Otherwise return `val` unchanged.
 *
 * @param {string} csvDir — absolute path to the CSV directory
 * @param {string} val    — field value (already sanitised — but @file: refs
 *                          are resolved BEFORE sanitisation; see run())
 * @returns {string}
 */
function resolveOcrText(csvDir, val) {
  if (typeof val === 'string' && val.startsWith('@file:')) {
    return resolveFileRef(csvDir, val);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Sheet processors
// ---------------------------------------------------------------------------

/**
 * Process descriptions.csv rows into contract records.
 * - Auto-generates integer id when the source row supplies none
 * - Resolves @file: ocr_text references before sanitising the cell value
 * - Sanitises every string field
 * - Coerces empty parent_reference_code to null
 *
 * @param {object[]} rows
 * @param {string}   csvDir
 * @returns {object[]}
 */
function processDescriptions(rows, csvDir) {
  return rows.map((row, i) => {
    // Resolve @file: BEFORE sanitising so the raw path is inspected intact
    const rawOcr = row.ocr_text !== undefined ? row.ocr_text : '';
    let resolvedOcr = rawOcr;
    if (typeof rawOcr === 'string' && rawOcr.startsWith('@file:')) {
      resolvedOcr = resolveFileRef(csvDir, rawOcr);
    }
    // Replace the raw ocr_text with the resolved value before sanitising
    const rowWithOcr = { ...row, ocr_text: resolvedOcr };

    const sanitised = sanitizeRow(rowWithOcr);
    const id = coerceId(sanitised, i);

    // Coerce empty parent_reference_code to null (contract: string|null)
    const parent = sanitised.parent_reference_code;
    const parentVal = (parent === undefined || parent === '' || parent === null) ? null : parent;

    return { ...sanitised, id, parent_reference_code: parentVal };
  });
}

/**
 * Process repositories.csv rows.
 * - Auto-generates integer id if absent
 * - Sanitises every string field
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function processRepositories(rows) {
  return rows.map((row, i) => {
    const sanitised = sanitizeRow(row);
    const id = coerceId(sanitised, i);
    return { ...sanitised, id };
  });
}

/**
 * Process entities.csv rows.
 * No id auto-generation (entities use entity_code, not numeric id).
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function processEntities(rows) {
  return rows.map(row => sanitizeRow(row));
}

/**
 * Process entity_links.csv rows.
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function processEntityLinks(rows) {
  return rows.map(row => sanitizeRow(row));
}

/**
 * Process places.csv rows.
 * - Auto-generates integer id if absent
 * - Coerces latitude/longitude to numbers (or null if empty)
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function processPlaces(rows) {
  return rows.map((row, i) => {
    const sanitised = sanitizeRow(row);
    const id = coerceId(sanitised, i);

    // Coerce lat/lon to range-validated numbers or null.
    // toCoord rejects non-finite, hex, scientific-notation, and out-of-range
    // values that isNaN() alone would silently pass through.
    const out = { ...sanitised, id };
    if (sanitised.latitude !== undefined)  out.latitude  = toCoord(sanitised.latitude,  90);
    if (sanitised.longitude !== undefined) out.longitude = toCoord(sanitised.longitude, 180);
    return out;
  });
}

/**
 * Process place_links.csv rows.
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function processPlaceLinks(rows) {
  return rows.map(row => sanitizeRow(row));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Convert a model-CSV dataset into the six-file contract.
 *
 * @param {object} opts
 * @param {string} opts.src        — path to the CSV directory
 * @param {string} opts.stagingDir — directory to write JSON output into
 * @param {string} [opts.standard] — descriptive standard key (unused by this
 *                                   adapter; passed through for API symmetry)
 */
async function run({ src, stagingDir }) {
  const csvDir = path.resolve(src);

  // ---- descriptions.csv (required) ----------------------------------------
  const descPath = path.join(csvDir, 'descriptions.csv');
  if (!fs.existsSync(descPath)) {
    throw new Error(`[import csv] descriptions.csv not found in: ${csvDir}`);
  }
  const descRaw  = parse(fs.readFileSync(descPath, 'utf8'), PARSE_OPTS);
  if (descRaw.length > 0) {
    warnUnknownColumns('descriptions', Object.keys(descRaw[0]));
  }
  const descriptions = processDescriptions(descRaw, csvDir);

  // ---- repositories.csv (optional — write empty array if absent) ----------
  const repoRaw = readSheet(csvDir, 'repositories.csv');
  let repositories = [];
  if (repoRaw !== null) {
    if (repoRaw.length > 0) warnUnknownColumns('repositories', Object.keys(repoRaw[0]));
    repositories = processRepositories(repoRaw);
  }

  // ---- entities.csv (optional) --------------------------------------------
  const entityRaw = readSheet(csvDir, 'entities.csv');
  let entities = [];
  if (entityRaw !== null) {
    if (entityRaw.length > 0) warnUnknownColumns('entities', Object.keys(entityRaw[0]));
    entities = processEntities(entityRaw);
  }

  // ---- entity_links.csv (optional) ----------------------------------------
  const entityLinkRaw = readSheet(csvDir, 'entity_links.csv');
  let entity_links = [];
  if (entityLinkRaw !== null) {
    if (entityLinkRaw.length > 0) warnUnknownColumns('entity_links', Object.keys(entityLinkRaw[0]));
    entity_links = processEntityLinks(entityLinkRaw);
  }

  // ---- places.csv (optional) ----------------------------------------------
  const placeRaw = readSheet(csvDir, 'places.csv');
  let places = [];
  if (placeRaw !== null) {
    if (placeRaw.length > 0) warnUnknownColumns('places', Object.keys(placeRaw[0]));
    places = processPlaces(placeRaw);
  }

  // ---- place_links.csv (optional) -----------------------------------------
  const placeLinkRaw = readSheet(csvDir, 'place_links.csv');
  let place_links = [];
  if (placeLinkRaw !== null) {
    if (placeLinkRaw.length > 0) warnUnknownColumns('place_links', Object.keys(placeLinkRaw[0]));
    place_links = processPlaceLinks(placeLinkRaw);
  }

  // ---- write six contract files -------------------------------------------
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
