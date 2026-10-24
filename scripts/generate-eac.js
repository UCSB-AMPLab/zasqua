'use strict';

/**
 * Generate EAC-CPF XML Records from the Entity Contract
 *
 * Every entity page's reuse section carries an EAC-CPF slot, which until now
 * has shown only a "coming soon" placeholder. This script provides the records
 * that slot will link to: it writes, from inside the engine, one EAC-CPF
 * record per entity (person, corporate body or family), so the people and
 * organizations named in the descriptions can be reused as authority records
 * by other archival systems, in the standard those systems use to describe
 * the contexts of records.
 *
 * It targets EAC-CPF 2010 (namespace urn:isbn:1-931666-33-4) because that is
 * the version SNAC and the authority aggregators ingest. TS-EAS 2.0 output can
 * follow when a consumer asks for it. The schema is declared in
 * xsi:schemaLocation so each record can be validated as written. The record is
 * assembled by string concatenation in schema order, as generate-mets.js does.
 *
 * No timestamps: the maintenance event is a machine "created" event with an
 * empty <eventDateTime/>. A build-time date would say only when the build ran,
 * not when the authority was established, and would make the output change on
 * every run. The element is required by the schema, so it is kept but left
 * empty.
 *
 * Deployment-agnostic by construction: the maintenance agency name, and the
 * optional agency code and record language, come from the caller's options.
 * No institution name, code or language is baked into the engine.
 *
 * Output location is wrapper-specified (EAC_DIR), as METS_DIR is for METS. A
 * single-bucket deployer writes the default public/eac/ (served with the
 * site); a deployer with a separate host sets EAC_DIR outside public/ and
 * uploads it there. A record that cannot be built (a contract violation), or
 * whose filename is empty or already taken by an earlier record, is skipped
 * with a warning naming it, and the run continues.
 *
 * Reads:
 *   exports/entities.json   — the entity contract (one object per entity)
 *   hugo.toml [params]      — EAC config (see readEacConfig)
 * Writes:
 *   {EAC_DIR}/{slug}.xml    — one EAC-CPF document per entity
 *     (slug = entity_code with ?, # and / stripped)
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so exports/ and public/ resolve to
 *                    the instance when the engine lives in node_modules.
 *   DATA_DIR       — override the default exports directory (absolute path).
 *   EAC_DIR        — override the default public/eac output directory.
 *
 * @version v1.5.0
 */

const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');
const { isUnderDir } = require('../lib/under-dir');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');
const EAC_DIR = process.env.EAC_DIR || path.join(INSTANCE_ROOT, 'public', 'eac');

// ---------------------------------------------------------------------------
// Namespaces and schema (declared once on the root element)
// ---------------------------------------------------------------------------

const NS_EAC = 'urn:isbn:1-931666-33-4';
const NS_XLINK = 'http://www.w3.org/1999/xlink';
const NS_XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const SCHEMA_LOCATION = 'urn:isbn:1-931666-33-4 https://eac.staatsbibliothek-berlin.de/schema/cpf.xsd';

// ---------------------------------------------------------------------------
// Entity type → EAC-CPF entityType mapping
//
// The entity contract documents person, corporate and family; the engine's
// own fixtures and entity template spell the second one corporate_body, and
// the CollectiveAccess importer emits corporateBody, so all three spellings
// are accepted. Anything else is a contract violation, so buildEacCpf throws
// rather than guess.
// ---------------------------------------------------------------------------

const ENTITY_TYPE_MAP = {
  person: 'person',
  corporate: 'corporateBody',
  corporate_body: 'corporateBody',
  corporateBody: 'corporateBody',
  family: 'family',
};

// ---------------------------------------------------------------------------
// XML escaping
//
// Entity values come from free-text fields, so every value must be escaped.
// Characters XML 1.0 does not allow at all (the C0 controls other than tab,
// newline and carriage return, and U+FFFE / U+FFFF) are dropped first, since
// no escape makes them legal. Element text escapes &, <, > ; attribute values
// additionally escape the double quote that delimits them.
// ---------------------------------------------------------------------------

const XML_FORBIDDEN = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

function escapeText(value) {
  return String(value)
    .replace(XML_FORBIDDEN, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

// xs:NMTOKEN, restricted to letters, digits and . _ : - (the name characters
// an entity code can reasonably carry).
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
// Dates of existence
//
// The contract types date_earliest and date_latest as strings, "YYYY" or
// "YYYY-MM-DD"; some exports carry integer years instead. Both are accepted.
// The value becomes the standardDate attribute (xs:gYear, xs:gYearMonth and
// xs:date are all permitted there); the free-text dates_of_existence is kept
// as the human-readable form. A reversed range is emitted as given, not
// corrected.
// ---------------------------------------------------------------------------

const YEAR_STRING = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * True when a "YYYY", "YYYY-MM" or "YYYY-MM-DD" string names a real month or
 * calendar day: the month is 01-12 and the day exists in that month (leap
 * years included). setUTCFullYear is used rather than Date.UTC, which maps
 * years 0-99 to 1900-1999.
 */
function isCalendarDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  if (m === undefined) return true;
  if (m < 1 || m > 12) return false;
  if (d === undefined) return true;
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Format a contract year as a standardDate value: a positive integer is
 * zero-padded to four digits, a "YYYY", "YYYY-MM" or "YYYY-MM-DD" string
 * that names a real month or day passes through (trimmed). Returns undefined
 * for anything else.
 *
 * @param {number|string} value
 * @returns {string|undefined}
 */
function formatYear(value) {
  if (Number.isInteger(value) && value > 0) return String(value).padStart(4, '0');
  if (typeof value === 'string') {
    const text = value.trim();
    if (YEAR_STRING.test(text) && isCalendarDate(text)) return text;
  }
  return undefined;
}

/**
 * Format a contract year as a standardDate value (see formatYear), throwing
 * when the value is not a valid year.
 *
 * @param {number|string} value
 * @returns {string}
 */
function gYear(value) {
  const formatted = formatYear(value);
  if (formatted === undefined) {
    throw new Error(`[generate-eac] invalid year "${value}"`);
  }
  return formatted;
}

/**
 * Read one year field of an entity: null for absent (null, undefined or a
 * blank string), the formatted value otherwise. Throws, naming the entity,
 * for an invalid value, 0 included.
 */
function readYear(entity, field) {
  const value = entity[field];
  // Absent means null, undefined or a blank string; any other non-year value
  // (an object, a boolean) is invalid rather than silently dropped.
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const formatted = formatYear(value);
  if (formatted === undefined) {
    throw new Error(`[generate-eac] ${entity.entity_code}: invalid year "${value}"`);
  }
  return formatted;
}

/**
 * Return entity[field] as an array: [] when null or undefined, the value
 * itself when it is an array. Throws, naming the entity, for anything else.
 */
function readArray(entity, field) {
  const value = entity[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[generate-eac] ${entity.entity_code}: ${field} must be an array`);
  }
  return value;
}

/**
 * Build the <existDates> block (indented for <description>), or '' when the
 * entity has neither years nor display text.
 *
 * @param {object} entity — one record from the entity contract
 * @returns {string}
 */
function existDatesXml(entity) {
  const earliest = readYear(entity, 'date_earliest');
  const latest = readYear(entity, 'date_latest');
  const text = entity.dates_of_existence;
  const hasEarliest = earliest !== null;
  const hasLatest = latest !== null;
  const hasText = !isBlank(text);
  const lines = [];

  if (hasEarliest && hasLatest && earliest !== latest) {
    lines.push('      <existDates>');
    lines.push('        <dateRange>');
    lines.push(`          <fromDate standardDate="${escapeAttr(earliest)}">${escapeText(earliest)}</fromDate>`);
    lines.push(`          <toDate standardDate="${escapeAttr(latest)}">${escapeText(latest)}</toDate>`);
    lines.push('        </dateRange>');
    if (hasText) {
      lines.push('        <descriptiveNote>');
      lines.push(`          <p>${escapeText(text)}</p>`);
      lines.push('        </descriptiveNote>');
    }
    lines.push('      </existDates>');
  } else if (hasEarliest || hasLatest) {
    // Equal years, or only one of them known: a single date.
    const year = hasEarliest ? earliest : latest;
    const content = hasText ? escapeText(text) : escapeText(year);
    lines.push('      <existDates>');
    lines.push(`        <date standardDate="${escapeAttr(year)}">${content}</date>`);
    lines.push('      </existDates>');
  } else if (hasText) {
    lines.push('      <existDates>');
    lines.push(`        <date>${escapeText(text)}</date>`);
    lines.push('      </existDates>');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Names and functions
// ---------------------------------------------------------------------------

/**
 * Build the authorized <nameEntry> (display_name, then the structured parts
 * that are present) and one further <nameEntry> per distinct name variant.
 *
 * @param {object} entity — one record from the entity contract
 * @returns {string}
 */
function nameEntriesXml(entity) {
  const displayName = String(entity.display_name).trim();
  const variants = readArray(entity, 'name_variants');
  const lines = [];
  lines.push('      <nameEntry>');
  lines.push(`        <part>${escapeText(displayName)}</part>`);
  for (const [field, localType] of [['surname', 'surname'], ['given_name', 'forename'], ['honorific', 'honorific']]) {
    if (!isBlank(entity[field])) {
      lines.push(`        <part localType="${localType}">${escapeText(entity[field])}</part>`);
    }
  }
  lines.push('      </nameEntry>');
  // Compared and emitted trimmed; the display name and repeats are skipped.
  const seen = new Set([displayName]);
  for (const variant of variants) {
    if (isBlank(variant)) continue;
    const name = String(variant).trim();
    if (seen.has(name)) continue;
    seen.add(name);
    lines.push('      <nameEntry>');
    lines.push(`        <part>${escapeText(name)}</part>`);
    lines.push('      </nameEntry>');
  }
  return lines.join('\n');
}

/**
 * Build the <functions> block, one term per entry with a non-empty function,
 * or '' when there is none. Counts and primary_function are not emitted.
 *
 * @param {object} entity — one record from the entity contract
 * @returns {string}
 */
function functionsXml(entity) {
  // An entry that is not a {function, count} object (a plain string, say)
  // has no .function and is dropped silently.
  const terms = readArray(entity, 'functions').map((f) => f && f.function).filter((t) => !isBlank(t));
  if (terms.length === 0) return '';
  const lines = ['      <functions>'];
  for (const term of terms) {
    lines.push('        <function>');
    lines.push(`          <term>${escapeText(term)}</term>`);
    lines.push('        </function>');
  }
  lines.push('      </functions>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// External-authority relations
//
// Each populated authority id becomes an identity <cpfRelation> pointing at
// the same entity in that authority file, VIAF first, then Wikidata. dbe_id
// (the Diccionario Biográfico Español) is deliberately left out.
// ---------------------------------------------------------------------------

// An id is linked only when it has the shape of that authority's
// identifiers (VIAF: digits; Wikidata: Q and digits). Anything else, a
// pasted URL for instance, would build a broken link, so it is reported and
// left out.
const AUTHORITY_LINKS = [
  { field: 'viaf_id', label: 'VIAF', pattern: /^\d+$/, href: (id) => `https://viaf.org/viaf/${id}` },
  { field: 'wikidata_id', label: 'Wikidata', pattern: /^Q\d+$/, href: (id) => `http://www.wikidata.org/entity/${id}` },
];

/**
 * Build the <relations> block, one identity cpfRelation per populated
 * authority id in AUTHORITY_LINKS order, or '' when there is none.
 *
 * @param {object} entity — one record from the entity contract
 * @returns {string}
 */
function relationsXml(entity) {
  const lines = [];
  for (const { field, label, pattern, href } of AUTHORITY_LINKS) {
    if (isBlank(entity[field])) continue;
    const id = String(entity[field]).trim();
    if (!pattern.test(id)) {
      console.warn(`[generate-eac] ${entity.entity_code}: ignoring ${field} "${id}"`);
      continue;
    }
    lines.push(`      <cpfRelation cpfRelationType="identity" xlink:type="simple" xlink:href="${escapeAttr(href(id))}">`);
    lines.push(`        <relationEntry>${escapeText(label)}</relationEntry>`);
    lines.push('      </cpfRelation>');
  }
  if (lines.length === 0) return '';
  return ['    <relations>', ...lines, '    </relations>'].join('\n');
}

/**
 * Build the complete EAC-CPF 2010 document for one entity.
 *
 * @param {object} entity — one record from the entity contract
 * @param {{agencyName?: string, agencyCode?: string, languageCode?: string}} [opts]
 *   agencyName falls back to 'Zasqua' when unset or empty
 * @returns {string} the XML document
 */
function buildEacCpf(input, opts = {}) {
  const { entity_type, display_name } = input;

  // recordId and the first name part are required by the schema and by the
  // entity contract, so a record without them is a contract violation.
  if (isBlank(input.entity_code)) {
    throw new Error('[generate-eac] (no entity_code): missing entity_code');
  }
  // recordId is built from the trimmed code, and every later message names
  // the trimmed code too. recordId is an xs:NMTOKEN, so a code with spaces,
  // slashes or other punctuation would make the record invalid.
  const entity_code = String(input.entity_code).trim();
  if (!NMTOKEN.test(entity_code)) {
    throw new Error(`[generate-eac] ${entity_code}: invalid entity_code "${entity_code}" (not an NMTOKEN)`);
  }
  const entity = { ...input, entity_code };
  if (isBlank(display_name)) {
    throw new Error(`[generate-eac] ${entity_code}: missing display_name`);
  }
  // Own properties only, so inherited names such as "constructor" are rejected.
  if (!Object.hasOwn(ENTITY_TYPE_MAP, entity_type)) {
    throw new Error(`[generate-eac] ${entity_code}: unknown entity_type "${entity_type}"`);
  }
  const entityType = ENTITY_TYPE_MAP[entity_type];
  const agencyName = isBlank(opts.agencyName) ? 'Zasqua' : opts.agencyName;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<eac-cpf xmlns="${NS_EAC}" xmlns:xlink="${NS_XLINK}"`);
  lines.push(`    xmlns:xsi="${NS_XSI}"`);
  lines.push(`    xsi:schemaLocation="${SCHEMA_LOCATION}">`);

  // control
  lines.push('  <control>');
  lines.push(`    <recordId>${escapeText(entity_code)}</recordId>`);
  lines.push('    <maintenanceStatus>new</maintenanceStatus>');
  lines.push('    <maintenanceAgency>');
  if (opts.agencyCode) {
    lines.push(`      <agencyCode>${escapeText(opts.agencyCode)}</agencyCode>`);
  }
  lines.push(`      <agencyName>${escapeText(agencyName)}</agencyName>`);
  lines.push('    </maintenanceAgency>');
  if (opts.languageCode) {
    lines.push('    <languageDeclaration>');
    lines.push(`      <language languageCode="${escapeAttr(opts.languageCode)}"/>`);
    lines.push('      <script scriptCode="Latn"/>');
    lines.push('    </languageDeclaration>');
  }
  lines.push('    <maintenanceHistory>');
  lines.push('      <maintenanceEvent>');
  lines.push('        <eventType>created</eventType>');
  lines.push('        <eventDateTime/>');
  lines.push('        <agentType>machine</agentType>');
  lines.push('        <agent>Zasqua</agent>');
  lines.push('      </maintenanceEvent>');
  lines.push('    </maintenanceHistory>');
  lines.push('  </control>');

  // cpfDescription
  lines.push('  <cpfDescription>');
  lines.push('    <identity>');
  lines.push(`      <entityType>${entityType}</entityType>`);
  lines.push(nameEntriesXml(entity));
  lines.push('    </identity>');

  // description: emitted only when at least one child applies, in schema
  // order existDates, functions, biogHist.
  const descriptionChildren = [existDatesXml(entity), functionsXml(entity)];
  if (!isBlank(entity.history)) {
    descriptionChildren.push(`      <biogHist>\n        <p>${escapeText(entity.history)}</p>\n      </biogHist>`);
  }
  const description = descriptionChildren.filter((block) => block !== '');
  if (description.length > 0) {
    lines.push('    <description>');
    lines.push(...description);
    lines.push('    </description>');
  }
  // relations: emitted only when at least one authority id is populated.
  const relations = relationsXml(entity);
  if (relations !== '') lines.push(relations);
  lines.push('  </cpfDescription>');
  lines.push('</eac-cpf>');

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

/**
 * The output filename stem for an entity: entity_code with ?, # and /
 * stripped, so the file is safe to write and matches the page URL.
 *
 * @param {string} code — entity_code
 * @returns {string}
 */
function eacSlug(code) {
  return String(code || '').replace(/[?#/]/g, '');
}

// ---------------------------------------------------------------------------
// EAC config (hugo.toml [params])
//
// Every value that would name an institution is deployer-owned config, so
// the engine bakes in none.
//
// Reads:
//   agencyName   ← params.eac_agency_name, else top-level `title`, else 'Zasqua'
//   agencyCode   ← params.eac_agency_code when it is an ISIL, else null
//   languageCode ← params.eac_language_code when it is a three-letter
//                  ISO 639-2 code, else null (an invalid value warns)
//   eacBaseUrl   ← params.eac_base_url (trailing slashes stripped), else null
//
// Degrades gracefully: a missing or unparseable hugo.toml yields the neutral
// defaults rather than a crash.
// ---------------------------------------------------------------------------

// The EAC-CPF 2010 schema patterns: agencyCode is an ISIL, and the record's
// language is an ISO 639-2 code. A value that does not match would make every
// record invalid, so it is ignored with a warning instead.
const ISIL = /^(([A-Z]{2})|([a-zA-Z]{1}[a-zA-Z0-9]{0,3}))(-[a-zA-Z0-9:\/\-]{1,11})$/;
const LANGUAGE_CODE = /^[a-z]{3}$/;

/**
 * Read one optional code param: null when unset, the string when it matches
 * the pattern, null with a warning when it does not.
 */
function checkedParam(params, key, pattern, why) {
  if (!params[key]) return null;
  const value = String(params[key]);
  if (pattern.test(value)) return value;
  console.warn(`[generate-eac] ignoring ${key} "${value}": ${why}`);
  return null;
}

function readEacConfig(instanceRoot) {
  const hugoTomlPath = path.join(instanceRoot, 'hugo.toml');
  let agencyName = 'Zasqua';
  let agencyCode = null;
  let languageCode = null;
  let eacBaseUrl = null;
  try {
    const cfg = parseToml(fs.readFileSync(hugoTomlPath, 'utf8'));
    const params = cfg.params || {};
    agencyName = String(params.eac_agency_name || cfg.title || agencyName);
    agencyCode = checkedParam(params, 'eac_agency_code', ISIL,
      'not an ISIL code (e.g. "CO-Smoke": a two-letter country prefix or 1-4 letters and digits, a hyphen, then 1-11 characters)');
    languageCode = checkedParam(params, 'eac_language_code', LANGUAGE_CODE,
      'not a three-letter lowercase ISO 639-2 code (e.g. "spa")');
    if (params.eac_base_url) {
      eacBaseUrl = String(params.eac_base_url).replace(/\/+$/, '');
    }
  } catch (err) {
    console.warn(
      `[generate-eac] WARN: could not read EAC config from ${hugoTomlPath} ` +
      `(${err.message}); using neutral defaults`
    );
  }
  return { agencyName, agencyCode, languageCode, eacBaseUrl };
}

// ---------------------------------------------------------------------------
// Per-record decision
// ---------------------------------------------------------------------------

/**
 * Decide what main() does with one entity: write it, or skip it with a
 * reason. A record is skipped when buildEacCpf throws (a contract
 * violation), when its slug is empty (a code made only of ?, # and /), or
 * when its slug was already written by an earlier record, so that the
 * earlier file is kept rather than overwritten.
 *
 * @param {object} entity — one record from the entity contract
 * @param {object} opts — buildEacCpf options
 * @param {Map<string,string>} slugOwners — NFC, lower-cased slug → code of the
 *   record that wrote it; updated when the record is to be written
 * @returns {{code: string, slug: string, xml: string} | {code: string, skip: string}}
 *   code is the trimmed entity_code, or "(no entity_code)"
 */
function planEacRecord(entity, opts, slugOwners) {
  const record = entity || {};
  const rawCode = record.entity_code;
  const code = isBlank(rawCode) ? '(no entity_code)' : String(rawCode).trim();
  let xml;
  try {
    xml = buildEacCpf(record, opts);
  } catch (err) {
    // buildEacCpf messages start "[generate-eac] <trimmed entity_code>: " (or
    // "(no entity_code): "); drop that literal prefix so the code is not
    // repeated in the warning, whatever characters the code contains.
    let reason = String(err && err.message ? err.message : err);
    const prefix = `[generate-eac] ${code}: `;
    if (reason.startsWith(prefix)) reason = reason.slice(prefix.length);
    return { code, skip: reason };
  }
  const slug = eacSlug(code);
  // Unreachable while buildEacCpf requires an NMTOKEN code (which has no ?, #
  // or /), but kept so a later change to either rule cannot write ".xml".
  if (slug === '') return { code, skip: 'empty slug' };
  // Compared case-insensitively and in Unicode NFC: on a case-insensitive
  // file system (macOS, Windows) ne-a.xml and ne-A.xml are the same file, and
  // APFS treats the NFC and NFD spellings of a name as the same file too.
  const key = slug.normalize('NFC').toLowerCase();
  if (slugOwners.has(key)) {
    return { code, skip: `slug "${slug}" already written by ${slugOwners.get(key)}` };
  }
  slugOwners.set(key, code);
  return { code, slug, xml };
}

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

// ---------------------------------------------------------------------------
// Entry point: read the entity contract, write one EAC-CPF file per entity.
// ---------------------------------------------------------------------------

async function main() {
  const entitiesPath = path.join(DATA_DIR, 'entities.json');

  console.log(`[generate-eac] DATA_DIR: ${DATA_DIR}`);
  console.log(`[generate-eac] EAC_DIR: ${EAC_DIR}`);

  if (!fs.existsSync(entitiesPath)) {
    throw new Error(`[generate-eac] required input missing: ${entitiesPath}`);
  }

  const entities = JSON.parse(fs.readFileSync(entitiesPath, 'utf8'));
  console.log(`[generate-eac] entities.json: ${entities.length} records`);

  const { agencyName, agencyCode, languageCode, eacBaseUrl } = readEacConfig(INSTANCE_ROOT);
  console.log(`[generate-eac] maintenance agency: ${agencyName}`);

  // If eac_base_url names another host (an absolute URL) but the records are
  // written under the rendered site tree (public/), they would be served with
  // the site rather than from that host. EAC_DIR is an env var the validator
  // cannot see, so the check lives here.
  const eacDirResolved = path.resolve(EAC_DIR);
  if (/^https?:\/\//i.test(eacBaseUrl || '') && isUnderPublic(EAC_DIR, INSTANCE_ROOT)) {
    console.warn(
      `[generate-eac] WARN: eac_base_url is an absolute URL (${eacBaseUrl}) but EAC_DIR ` +
      `resolves under public/ (${eacDirResolved}), so the records would be served with ` +
      `the site rather than from eac_base_url. Set EAC_DIR outside public/ and upload it ` +
      `to that host.`
    );
  }

  fs.mkdirSync(EAC_DIR, { recursive: true });

  const opts = { agencyName, agencyCode, languageCode };
  const slugOwners = new Map();
  let written = 0;
  let skipped = 0;
  for (const entity of entities) {
    const plan = planEacRecord(entity, opts, slugOwners);
    if (plan.skip) {
      skipped++;
      console.warn(`[generate-eac] skipped ${plan.code}: ${plan.skip}`);
      continue;
    }
    fs.writeFileSync(path.join(EAC_DIR, `${plan.slug}.xml`), plan.xml, 'utf8');
    written++;
    if (written % 10000 === 0) {
      console.log(`[generate-eac] Wrote ${written} EAC-CPF files...`);
    }
  }

  console.log(`[generate-eac] Wrote ${written} EAC-CPF files to ${EAC_DIR}`);
  if (skipped > 0) {
    console.warn(`[generate-eac] Skipped ${skipped} record(s)`);
  }
}

module.exports = {
  buildEacCpf, escapeText, escapeAttr, ENTITY_TYPE_MAP, gYear, existDatesXml, AUTHORITY_LINKS,
  readEacConfig, eacSlug, planEacRecord, isUnderPublic,
};

if (require.main === module) {
  main().catch(err => {
    console.error('[generate-eac] Fatal error:', (err && err.stack) || err);
    process.exit(1);
  });
}

// Version: v1.5.0
