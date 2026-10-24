'use strict';

/**
 * Generate Linked Places Records from the Place Contract
 *
 * Every place page's reuse section carries a Linked Places slot. This script
 * provides the records that slot will link to: it writes, from inside the
 * engine, one Linked Places Format (LPF v1.3) record per place, so the places
 * named in the descriptions can be reused by gazetteers and mapping tools,
 * and so the whole corpus can be offered to the World Historical Gazetteer
 * (WHG), which ingests LPF directly.
 *
 * LPF is GeoJSON-LD: each place is a GeoJSON Feature with an @id, a title,
 * one or more feature classes (the GeoNames letters A H L P R S T), at least
 * one name with a citation, and a geometry, which is null when the location
 * is unknown. The builder returns a plain object whose keys are in a fixed
 * order, so the JSON written from it is the same on every run. No timestamps.
 *
 * Deployment-agnostic by construction: the @id is the place page on the
 * caller's site (/{place_code}/, the flat URL the place pages use), and the
 * name citation is the caller's site title. No institution name, URL or code
 * is baked into the engine.
 *
 * A place's `when` is the span of years in which the archive attests it: the
 * earliest and latest year of the dated descriptions linked to it in
 * place_links.json. A place with no dated linked description carries no
 * `when`, and neither does any place when place_links.json or
 * descriptions.json is absent.
 *
 * Output location is wrapper-specified (PLACES_DIR), as EAC_DIR is for
 * EAC-CPF. Each place is written as its own one-feature collection, and
 * index.json holds, in one collection, every written feature that carries a
 * when: the LPF-conformant corpus, in the form WHG takes for a bulk upload.
 * LPF requires a record-level when or a citation year on a name; a place no
 * dated description mentions has neither, so its own file is LPF-shaped but
 * not a conformant record, and it is left out of index.json. A record that
 * cannot be built (a contract
 * violation: a blank or malformed place_code, a blank display_name, an
 * unknown fclass, or coordinates that are not a valid pair) makes
 * buildPlaceFeature throw, naming the record; main() skips it with a warning
 * and the run continues. So is a record whose filename is already taken by
 * an earlier record, or would be index.json.
 *
 * Reads:
 *   exports/places.json         — the place contract (one object per place)
 *   exports/place_links.json    — place mentions in descriptions (optional)
 *   exports/descriptions.json   — the descriptions, for their dates (optional)
 *   hugo.toml                   — site and places config (see readPlacesConfig)
 * Writes:
 *   {PLACES_DIR}/{slug}.json    — one LPF FeatureCollection per place
 *     (slug = place_code with ?, # and / stripped)
 *   {PLACES_DIR}/index.json     — every written feature with a when, in one
 *                                 FeatureCollection
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so exports/ and public/ resolve to
 *                    the instance when the engine lives in node_modules.
 *   DATA_DIR       — override the default exports directory (absolute path).
 *   PLACES_DIR     — override the default public/places output directory.
 *
 * @version v1.5.0
 */

const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');
const { isUnderDir } = require('../lib/under-dir');
const { descriptionYearRange } = require('../lib/year-range');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');
const PLACES_DIR = process.env.PLACES_DIR || path.join(INSTANCE_ROOT, 'public', 'places');

// ---------------------------------------------------------------------------
// Format constants
//
// LPF_CONTEXT is the JSON-LD context the format's sample collection declares,
// served from the format's current repository. FCLASSES are the seven
// GeoNames feature classes LPF accepts in properties.fclasses.
// ---------------------------------------------------------------------------

const LPF_CONTEXT = 'https://raw.githubusercontent.com/LinkedPasts/linked-places-format/master/linkedplaces-context-v1.1.jsonld';
const FCLASSES = ['A', 'H', 'L', 'P', 'R', 'S', 'T'];

// NMTOKEN, restricted to letters, digits and . _ : - (the same rule
// generate-eac.js applies to entity codes). The place code becomes a URL path
// segment and a filename, so spaces, slashes and other punctuation are
// rejected.
const NMTOKEN = /^[\p{L}\p{N}._:-]+$/u;

// Only strings and finite numbers carry text. Anything else (null, an object,
// an array, a boolean, NaN) counts as blank, so it is skipped rather than
// emitted as "[object Object]" or "true".
const isBlank = (v) => {
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return !Number.isFinite(v);
  return true;
};

// ---------------------------------------------------------------------------
// Feature types and authority links
//
// PLACE_TYPE_AAT maps the contract's place_type to a Getty AAT concept for
// LPF's types member. A place_type not in the map (blank, "other", or any
// unmapped value) leaves types out rather than guessing.
//
// PLACE_LINKS lists, in output order, the authority ids that become
// closeMatch links, each with the pattern its id must match and the URL it
// resolves to. hgis_id is deliberately absent: it is not a resolvable
// identifier.
// ---------------------------------------------------------------------------

const PLACE_TYPE_AAT = {
  city: { identifier: 'http://vocab.getty.edu/aat/300008347', label: 'inhabited places' },
  river: { identifier: 'http://vocab.getty.edu/aat/300008707', label: 'rivers' },
  region: { identifier: 'http://vocab.getty.edu/aat/300182722', label: 'regions (geographic)' },
};

const PLACE_LINKS = [
  { field: 'whg_id', pattern: /^\d+$/, href: id => `https://whgazetteer.org/places/${id}/detail` },
  { field: 'tgn_id', pattern: /^\d+$/, href: id => `http://vocab.getty.edu/tgn/${id}` },
  { field: 'wikidata_id', pattern: /^Q\d+$/, href: id => `http://www.wikidata.org/entity/${id}` },
];

// ---------------------------------------------------------------------------
// Geometry
//
// A GeoJSON Point is [longitude, latitude]. Both coordinates must be finite
// numbers in range; a string such as "1.4" is rejected rather than parsed, so
// a malformed export is reported instead of silently repaired. Zero is a
// valid coordinate. Both absent means the location is unknown, which LPF
// writes as a null geometry. Anything else is a contract violation.
// ---------------------------------------------------------------------------

function isAbsent(v) {
  return v === null || v === undefined;
}

function isCoordinate(v, limit) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
}

function buildGeometry(place, code) {
  const { latitude, longitude } = place;
  if (isAbsent(latitude) && isAbsent(longitude)) return null;
  if (isCoordinate(latitude, 90) && isCoordinate(longitude, 180)) {
    return { type: 'Point', coordinates: [longitude, latitude] };
  }
  throw new Error(`[generate-places] ${code}: invalid coordinates`);
}

// ---------------------------------------------------------------------------
// Further names and links
//
// The authorized name (display_name) comes first and carries the citation.
// The label, when it differs from display_name, and each name variant follow
// as further names, trimmed and in contract order, with lang when one is
// configured and no citation. A toponym already present is not repeated
// (exact, case-sensitive comparison). Non-string and blank variants are
// skipped; a name_variants that is neither null, undefined nor an array is a
// contract violation.
// ---------------------------------------------------------------------------

function buildFurtherNames(input, title, lang, code) {
  const variants = input.name_variants;
  if (!isAbsent(variants) && !Array.isArray(variants)) {
    throw new Error(`[generate-places] ${code}: name_variants must be an array`);
  }
  const seen = new Set([title]);
  const names = [];
  const add = (toponym) => {
    if (toponym === '' || seen.has(toponym)) return;
    seen.add(toponym);
    const name = { toponym };
    if (lang !== undefined) name.lang = lang;
    names.push(name);
  };
  if (typeof input.label === 'string') add(input.label.trim());
  for (const v of variants || []) {
    if (typeof v === 'string') add(v.trim());
  }
  return names;
}

// One closeMatch link per populated id that matches its pattern, in
// PLACE_LINKS order. A blank id is skipped silently; a populated id that does
// not match is dropped with a warning, so a malformed export is reported
// without failing the record.
function buildLinks(input, code) {
  const links = [];
  for (const { field, pattern, href } of PLACE_LINKS) {
    const v = input[field];
    if (isBlank(v)) continue;
    const id = String(v).trim();
    if (!pattern.test(id)) {
      console.warn(`[generate-places] ${code}: ignoring ${field} "${id}"`);
      continue;
    }
    links.push({ type: 'closeMatch', identifier: href(id) });
  }
  return links;
}

// ---------------------------------------------------------------------------
// Feature builder
// ---------------------------------------------------------------------------

/**
 * Build one LPF Feature for a place.
 *
 * Key order of the result: @id, type, properties, when, names, types,
 * geometry, links. when is omitted when no attested years are given, types
 * when place_type is not mapped, and links when no id qualifies.
 *
 * @param {object} input - one record from the place contract
 * @param {{siteBaseUrl?: string, siteTitle?: string, language?: string|null,
 *   attested?: {start: string, end: string, count: number}}} [opts]
 *   siteBaseUrl falls back to '/' and siteTitle to 'Zasqua' when unset or
 *   empty; lang is emitted on the name only when language is set; attested
 *   (one entry of attestedYears) becomes when, with end omitted when it
 *   equals start
 * @returns {object} the Feature
 */
function buildPlaceFeature(input, opts = {}) {
  if (isBlank(input.place_code)) {
    throw new Error('[generate-places] (no place_code): missing place_code');
  }
  // Every later message names the trimmed code, and the @id is built from it.
  const code = String(input.place_code).trim();
  if (!NMTOKEN.test(code)) {
    throw new Error(`[generate-places] ${code}: invalid place_code "${code}" (not an NMTOKEN)`);
  }
  if (isBlank(input.display_name)) {
    throw new Error(`[generate-places] ${code}: missing display_name`);
  }
  const title = String(input.display_name).trim();

  const fclass = typeof input.fclass === 'string' ? input.fclass.trim().toUpperCase() : '';
  if (!FCLASSES.includes(fclass)) {
    throw new Error(`[generate-places] ${code}: invalid fclass "${input.fclass}"`);
  }

  const geometry = buildGeometry(input, code);

  const baseUrl = isBlank(opts.siteBaseUrl) ? '/' : String(opts.siteBaseUrl).replace(/\/+$/, '') + '/';
  const siteTitle = isBlank(opts.siteTitle) ? 'Zasqua' : String(opts.siteTitle);
  const id = `${baseUrl}${code}/`;

  const lang = isBlank(opts.language) ? undefined : String(opts.language);
  const name = { toponym: title };
  if (lang !== undefined) name.lang = lang;
  name.citations = [{ label: siteTitle, '@id': id }];
  const names = [name, ...buildFurtherNames(input, title, lang, code)];

  const type = typeof input.place_type === 'string' ? input.place_type.trim().toLowerCase() : '';
  const types = Object.prototype.hasOwnProperty.call(PLACE_TYPE_AAT, type) ? [{ ...PLACE_TYPE_AAT[type] }] : null;
  const links = buildLinks(input, code);

  const feature = {
    '@id': id,
    type: 'Feature',
    properties: { title, fclasses: [fclass] },
  };
  const attested = opts.attested;
  if (attested && !isBlank(attested.start)) {
    const span = { start: { in: String(attested.start) } };
    if (!isBlank(attested.end) && String(attested.end) !== String(attested.start)) {
      span.end = { in: String(attested.end) };
    }
    feature.when = { timespans: [span] };
  }
  feature.names = names;
  if (types) feature.types = types;
  feature.geometry = geometry;
  if (links.length > 0) feature.links = links;
  return feature;
}

// ---------------------------------------------------------------------------
// Attested years
//
// A description's years are the range descriptionYearRange (lib/year-range.js,
// shared with the Pagefind date facets) derives: the start from date_start,
// else from date_expression, and the end from the last year in
// date_expression. A description with neither is undated. Each place gets the
// earliest and latest year of the distinct dated descriptions linked to it. A
// link whose reference_code names no description is ignored (the validator
// reports those).
// ---------------------------------------------------------------------------

/**
 * @param {object[]} placeLinks - the place_links contract
 * @param {object[]} descriptions - the descriptions contract
 * @returns {Map<string, {start: string, end: string, count: number}>}
 *   keyed by trimmed place_code; places with no dated link are absent
 */
function attestedYears(placeLinks, descriptions) {
  if (!Array.isArray(placeLinks)) {
    throw new Error('[generate-places] attestedYears: place links must be an array');
  }
  if (!Array.isArray(descriptions)) {
    throw new Error('[generate-places] attestedYears: descriptions must be an array');
  }
  const yearOf = new Map();
  for (const d of descriptions) {
    if (!d || isBlank(d.reference_code)) continue;
    const { startYear, endYear } = descriptionYearRange(d);
    if (startYear === null) continue;
    yearOf.set(String(d.reference_code).trim(), {
      start: Math.min(startYear, endYear),
      end: Math.max(startYear, endYear),
    });
  }
  const seen = new Map();
  const years = new Map();
  for (const link of placeLinks) {
    if (!link || isBlank(link.place_code) || isBlank(link.reference_code)) continue;
    const ref = String(link.reference_code).trim();
    const range = yearOf.get(ref);
    if (range === undefined) continue;
    const code = String(link.place_code).trim();
    if (!seen.has(code)) seen.set(code, new Set());
    const refs = seen.get(code);
    if (refs.has(ref)) continue;
    refs.add(ref);
    const entry = years.get(code);
    if (!entry) {
      years.set(code, { start: range.start, end: range.end, count: 1 });
    } else {
      entry.start = Math.min(entry.start, range.start);
      entry.end = Math.max(entry.end, range.end);
      entry.count++;
    }
  }
  // The years were matched as four digits, so they are written back as four.
  const year = (n) => String(n).padStart(4, '0');
  for (const entry of years.values()) {
    entry.start = year(entry.start);
    entry.end = year(entry.end);
  }
  return years;
}

// ---------------------------------------------------------------------------
// Collections and serialization
// ---------------------------------------------------------------------------

/**
 * @param {object[]} features - LPF Features
 * @returns {object} an LPF FeatureCollection
 */
function buildFeatureCollection(features) {
  return { type: 'FeatureCollection', '@context': LPF_CONTEXT, features };
}

/** Two-space JSON with a final newline, so an unchanged export writes identical files. */
function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Places config (hugo.toml)
//
// Reads:
//   siteBaseUrl   ← top-level baseURL, else '/'
//   siteTitle     ← top-level title, else 'Zasqua'
//   language      ← params.places_language, else null (a BCP 47 tag, passed
//                   through as given). There is no fallback to the site's
//                   defaultContentLanguage: the language of the interface
//                   says nothing about the language of the place names, so
//                   lang is declared only when the deployer sets it.
//   placesBaseUrl ← params.places_base_url (trailing slashes stripped), else
//                   null; used only to warn when the records would be served
//                   from the site rather than from that host
//
// Every value is trimmed, and a blank value counts as unset. Degrades
// gracefully: a missing or unparseable hugo.toml yields the defaults rather
// than a crash.
// ---------------------------------------------------------------------------

// A trimmed string for a string or finite number, else null.
function configValue(v) {
  if (isBlank(v)) return null;
  return String(v).trim();
}

function readPlacesConfig(instanceRoot) {
  const hugoTomlPath = path.join(instanceRoot, 'hugo.toml');
  const config = { siteBaseUrl: '/', siteTitle: 'Zasqua', language: null, placesBaseUrl: null };
  try {
    const cfg = parseToml(fs.readFileSync(hugoTomlPath, 'utf8'));
    const params = cfg.params || {};
    config.siteBaseUrl = configValue(cfg.baseURL) || config.siteBaseUrl;
    config.siteTitle = configValue(cfg.title) || config.siteTitle;
    config.language = configValue(params.places_language);
    const base = configValue(params.places_base_url);
    config.placesBaseUrl = base ? base.replace(/\/+$/, '') : null;
  } catch (err) {
    console.warn(
      `[generate-places] WARN: could not read places config from ${hugoTomlPath} ` +
      `(${err.message}); using neutral defaults`
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// Filenames and the per-record decision
// ---------------------------------------------------------------------------

/**
 * The output filename stem for a place: the trimmed place_code with ?, # and
 * / stripped, so the file is safe to write and matches the page URL.
 *
 * @param {string} code — place_code
 * @returns {string}
 */
function placesSlug(code) {
  return String(code || '').trim().replace(/[?#/]/g, '');
}

/**
 * Decide whether main() writes a place's file. Called after the feature has
 * been built, so it judges only the filename: a record is refused when its
 * slug is empty, when it is "index" (the corpus file), or when an earlier
 * record already wrote it, so the earlier file is kept rather than
 * overwritten. Slugs are compared case-insensitively and in Unicode NFC: on
 * a case-insensitive file system (macOS, Windows) nl-a.json and nl-A.json
 * are the same file, and APFS treats the NFC and NFD spellings of a name as
 * the same file too.
 *
 * @param {object} place — one record from the place contract
 * @param {Map<string,string>} slugOwners — NFC, lower-cased slug → code of the
 *   record that wrote it; updated when the record is to be written
 * @returns {{write: boolean, code: string, slug: string, reason?: string}}
 *   code is the trimmed place_code, or "(no place_code)"
 */
function planPlaceRecord(place, slugOwners) {
  const record = place || {};
  const code = isBlank(record.place_code) ? '(no place_code)' : String(record.place_code).trim();
  const slug = placesSlug(isBlank(record.place_code) ? '' : code);
  if (slug === '') return { write: false, code, slug, reason: 'empty slug' };
  const key = slug.normalize('NFC').toLowerCase();
  if (key === 'index') {
    return { write: false, code, slug, reason: 'slug "index" is reserved for the corpus file' };
  }
  if (slugOwners.has(key)) {
    return { write: false, code, slug, reason: `slug "${slug}" already written by ${slugOwners.get(key)}` };
  }
  slugOwners.set(key, code);
  return { write: true, code, slug };
}

// ---------------------------------------------------------------------------
// Entry point: read the place contract, write one LPF file per place and the
// corpus index.json.
// ---------------------------------------------------------------------------

/**
 * Whether an output directory lies inside the instance's rendered site tree
 * (INSTANCE_ROOT/public, or public itself), where its files would be served
 * with the site. A sibling such as public-staging is not inside it.
 *
 * @param {string} outDir — the output directory
 * @param {string} instanceRoot — the instance directory
 * @returns {boolean}
 */
function isUnderPublic(outDir, instanceRoot) {
  return isUnderDir(outDir, path.join(instanceRoot, 'public'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The description fields attestedYears reads. descriptions.json is the
// largest export (over 200 MB on the Neogranadina catalogue), so once it is
// parsed each record is reduced to these keys and the full records are left
// for the garbage collector, rather than kept resident for the whole run.
// (A JSON.parse reviver that drops the other keys was measured and rejected:
// V8 still builds the full tree before the reviver walks it, so the peak
// rose by about 375 MB and the parse took three times as long.)
const DESCRIPTION_DATE_KEYS = ['reference_code', 'date_start', 'date_expression'];

/**
 * Parse descriptions.json keeping only reference_code, date_start and
 * date_expression on each record.
 *
 * @param {string} file — path to descriptions.json
 * @returns {object[]}
 */
function readDescriptionDates(file) {
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(records)) return records;
  return records.map((record) => {
    if (!record || typeof record !== 'object') return record;
    const slim = {};
    for (const key of DESCRIPTION_DATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) slim[key] = record[key];
    }
    return slim;
  });
}

async function main() {
  const placesPath = path.join(DATA_DIR, 'places.json');
  const linksPath = path.join(DATA_DIR, 'place_links.json');
  const descriptionsPath = path.join(DATA_DIR, 'descriptions.json');

  console.log(`[generate-places] DATA_DIR: ${DATA_DIR}`);
  console.log(`[generate-places] PLACES_DIR: ${PLACES_DIR}`);

  if (!fs.existsSync(placesPath)) {
    throw new Error(`[generate-places] required input missing: ${placesPath}`);
  }

  const places = readJson(placesPath);
  if (!Array.isArray(places)) {
    throw new Error(`[generate-places] ${placesPath} is not an array`);
  }
  console.log(`[generate-places] places.json: ${places.length} records`);

  let years = new Map();
  if (fs.existsSync(linksPath) && fs.existsSync(descriptionsPath)) {
    years = attestedYears(readJson(linksPath), readDescriptionDates(descriptionsPath));
  } else {
    console.log('[generate-places] no place_links.json/descriptions.json — records carry no when');
  }

  const { siteBaseUrl, siteTitle, language, placesBaseUrl } = readPlacesConfig(INSTANCE_ROOT);

  // If places_base_url names another host (an absolute URL) but the records
  // are written under the rendered site tree (public/), they would be served
  // with the site rather than from that host. PLACES_DIR is an env var the
  // validator cannot see, so the check lives here.
  const placesDirResolved = path.resolve(PLACES_DIR);
  if (/^https?:\/\//i.test(placesBaseUrl || '') && isUnderPublic(PLACES_DIR, INSTANCE_ROOT)) {
    console.warn(
      `[generate-places] WARN: places_base_url is an absolute URL (${placesBaseUrl}) but PLACES_DIR ` +
      `resolves under public/ (${placesDirResolved}), so the records would be served with ` +
      `the site rather than from places_base_url. Set PLACES_DIR outside public/ and upload it ` +
      `to that host.`
    );
  }

  // LPF @id values should be absolute IRIs, and the @id is built from
  // baseURL, so a relative baseURL (or none, which defaults to '/') makes
  // every record's @id relative.
  if (!/^https?:\/\//i.test(siteBaseUrl)) {
    console.warn(
      `[generate-places] baseURL is not absolute (${siteBaseUrl}); ` +
      'Linked Places @id values should be absolute IRIs'
    );
  }

  fs.mkdirSync(PLACES_DIR, { recursive: true });

  const slugOwners = new Map();
  // index.json is the corpus for bulk ingest, so it holds only the features
  // that carry a when: LPF requires each feature to have a when (or a dated
  // citation), and a place no dated description mentions has neither. Those
  // places are still written as their own files, so the link on their pages
  // resolves, though the file is not a conformant record.
  const features = [];
  const dated = [];
  let skipped = 0;
  let withoutWhen = 0;
  const skip = (code, reason) => {
    skipped++;
    console.warn(`[generate-places] skipped ${code}: ${reason}`);
  };
  for (const place of places) {
    const record = place || {};
    const code = isBlank(record.place_code) ? '(no place_code)' : String(record.place_code).trim();
    let feature;
    try {
      feature = buildPlaceFeature(record, { siteBaseUrl, siteTitle, language, attested: years.get(code) });
    } catch (err) {
      // buildPlaceFeature messages start "[generate-places] <trimmed
      // place_code>: " (or "(no place_code): "); drop that literal prefix so
      // the code is not repeated in the warning.
      let reason = String(err && err.message ? err.message : err);
      const prefix = `[generate-places] ${code}: `;
      if (reason.startsWith(prefix)) reason = reason.slice(prefix.length);
      skip(code, reason);
      continue;
    }
    const plan = planPlaceRecord(record, slugOwners);
    if (!plan.write) {
      skip(plan.code, plan.reason);
      continue;
    }
    fs.writeFileSync(path.join(PLACES_DIR, `${plan.slug}.json`), serialize(buildFeatureCollection([feature])), 'utf8');
    features.push(feature);
    if (feature.when) dated.push(feature);
    else withoutWhen++;
    if (features.length % 10000 === 0) {
      console.log(`[generate-places] Wrote ${features.length} place files...`);
    }
  }
  fs.writeFileSync(path.join(PLACES_DIR, 'index.json'), serialize(buildFeatureCollection(dated)), 'utf8');

  console.log(`[generate-places] Wrote ${features.length} place files + index.json to ${PLACES_DIR}`);
  if (withoutWhen > 0) {
    console.warn(`[generate-places] ${withoutWhen} record(s) without a when: written as place files (not conformant LPF records), left out of index.json`);
  } else {
    console.log('[generate-places] every record carries a when');
  }
  if (skipped > 0) {
    console.warn(`[generate-places] Skipped ${skipped} record(s)`);
  }
}

module.exports = {
  buildPlaceFeature, FCLASSES, LPF_CONTEXT, PLACE_TYPE_AAT, PLACE_LINKS,
  attestedYears, buildFeatureCollection, serialize, readPlacesConfig, placesSlug, planPlaceRecord,
  isUnderPublic, readDescriptionDates,
};

if (require.main === module) {
  main().catch(err => {
    console.error('[generate-places] Fatal error:', (err && err.stack) || err);
    process.exit(1);
  });
}

// Version: v1.5.0
