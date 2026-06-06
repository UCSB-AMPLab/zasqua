/**
 * EAD3 Import Adapter — Links-Only, Standard-Profile Aware
 *
 * This module deals with converting EAD3 XML exports (from AtoM,
 * ArchivesSpace, or other EAD3-compliant systems) into the six-file JSON
 * contract that `zasqua validate` and `zasqua build` consume.
 *
 * Behaviour governing this adapter:
 *
 *   Scope — the canonical EAD3 core, validated against real AtoM and
 *   ArchivesSpace export fixtures. Both numbered (c01–c12, AtoM style) and
 *   unnumbered (<c>, EAD3 standard) nesting are supported.
 *
 *   Descriptive standard — `descriptive_standard` is set from the
 *   `--standard` flag (default `isadg`). The calling dispatcher passes this
 *   as `standard`.
 *
 *   Links only, no authority minting — EAD3 does NOT mint authority records.
 *   `entity_links` and `place_links` are emitted only when a <controlaccess>
 *   element carries an `@identifier` that matches an existing `entity_code`
 *   or `place_code` in the instance authority files. The match key is the
 *   EAD3 `@identifier` attribute, compared directly against
 *   `entity_code` / `place_code`.
 *
 *   Bare names stay as prose — bare-string or unmatched names are NOT
 *   promoted to entity or place records. Their text is kept in the
 *   description's notes field. A reconciliation report (`import-report.json`)
 *   tallies carried versus skipped access points.
 *
 * XML parsing uses `fast-xml-parser` 5.8.0 (MIT). All text fields are run
 * through `sanitizeField` from `lib/sanitize.js` so that imported markup
 * cannot inject scripts into the published site. The parser does not resolve
 * external entities or DOCTYPE declarations — this is the parser's default
 * behaviour, and no entity-processing option is enabled here, which closes
 * the XML external-entity attack surface.
 *
 * Public API:
 *
 *   run({ src, stagingDir, standard, instanceRoot })
 *     Parse the EAD3 XML at `src`, walk archdesc + dsc recursively, apply
 *     the element→field mapping, resolve entity/place links via @identifier
 *     match, and write six JSON contract files to `stagingDir`. Also writes
 *     `import-report.json` with the reconciliation report.
 *
 * Dependencies: fast-xml-parser 5.8.0 (MIT), sanitize.js.
 *
 * @version v0.1.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { XMLParser }     = require('fast-xml-parser');
const { sanitizeField } = require('../sanitize');

// ---------------------------------------------------------------------------
// EAD3 @level → canonical description_level vocabulary
// ---------------------------------------------------------------------------

const LEVEL_MAP = {
  fonds:      'fonds',
  subfonds:   'subfonds',
  series:     'series',
  subseries:  'subseries',
  file:       'file',
  item:       'item',
  collection: 'collection',
  recordgrp:  'file',  // EAD3 synonym for file-level grouping
  subgrp:     'subseries',
  class:      'section',
  otherlevel: 'item',  // fallback; @otherlevel attr value used if available
};

/**
 * Map an EAD3 @level attribute value to a canonical description_level key.
 *
 * @param {string} level   — EAD3 @level value
 * @param {string} [other] — @otherlevel fallback
 * @returns {string}
 */
function mapLevel(level, other) {
  if (!level) return 'item';
  const key = (level || '').toLowerCase().trim();
  if (key === 'otherlevel' && other) return sanitizeField(other).toLowerCase().trim() || 'item';
  return LEVEL_MAP[key] || key;
}

// ---------------------------------------------------------------------------
// fast-xml-parser configuration
// ---------------------------------------------------------------------------

/** Component element names that must always be treated as arrays. */
const COMPONENT_NAMES = [
  'c',
  'c01','c02','c03','c04','c05','c06',
  'c07','c08','c09','c10','c11','c12',
];

/** Controlaccess element names that must always be treated as arrays. */
const ACCESS_POINT_NAMES = [
  'persname', 'corpname', 'famname', 'geogname',
  'subject', 'function', 'genreform',
];

const PARSER_OPTS = {
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  trimValues:          true,
  isArray: (name) =>
    COMPONENT_NAMES.includes(name) || ACCESS_POINT_NAMES.includes(name) ||
    name === 'dao' || name === 'container' || name === 'p',
};

// ---------------------------------------------------------------------------
// Internal helpers — XML text extraction
// ---------------------------------------------------------------------------

/**
 * Extract the text content of an XML element parsed by fast-xml-parser.
 * Handles both plain-string elements and objects with `#text`.
 *
 * @param {*} el
 * @returns {string}
 */
function textOf(el) {
  if (el === null || el === undefined) return '';
  if (typeof el === 'string') return el;
  if (typeof el === 'number') return String(el);
  if (typeof el === 'object' && el['#text'] !== undefined) return String(el['#text']);
  return '';
}

/**
 * Extract and join all <p> elements within a block element (e.g. scopecontent).
 * Returns a pipe-separated string matching the contract convention for multi-
 * paragraph fields — a pipe-list renders as a bullet list downstream.
 *
 * @param {object|string} blockEl — parsed block element (e.g. scopecontent)
 * @returns {string}
 */
function joinParagraphs(blockEl) {
  if (!blockEl) return '';
  if (typeof blockEl === 'string') return sanitizeField(blockEl);
  const paras = blockEl.p;
  if (!paras) return sanitizeField(textOf(blockEl));
  const arr = Array.isArray(paras) ? paras : [paras];
  return arr
    .map(p => sanitizeField(textOf(p)))
    .filter(Boolean)
    .join('|');
}

/**
 * Extract a simple text field from a block element, falling back to '' if absent.
 *
 * @param {object|string} blockEl
 * @returns {string}
 */
function blockText(blockEl) {
  return joinParagraphs(blockEl);
}

// ---------------------------------------------------------------------------
// Repository code derivation
// ---------------------------------------------------------------------------

/**
 * Derive the repository_code from <eadid> attributes.
 * Prefers countrycode + mainagencycode joined with '-'; falls back to
 * @identifier if present; otherwise uses the eadid text content.
 *
 * @param {object} eadid — parsed eadid element
 * @returns {string}
 */
function deriveRepositoryCode(eadid) {
  if (!eadid) return 'unknown';
  const country  = eadid['@_countrycode']      || '';
  const agency   = eadid['@_mainagencycode']   || '';
  if (country && agency) return `${country}-${agency}`;
  const identifier = eadid['@_identifier'] || '';
  if (identifier) return identifier;
  return sanitizeField(textOf(eadid)) || 'unknown';
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

/**
 * Extract date_expression and date_start from a <unitdate> element (or array).
 *
 * When `unitdate` is an array (common in AtoM/AS exports that carry both a
 * creation date and a bulk date), all expressions are joined with '; ' so no
 * date information is silently discarded. The earliest @normal value (the first
 * element in document order) is used for date_start. If `quirks` is provided
 * and the array has more than one entry, a note recording how many additional
 * unitdate values were present is pushed to make the data loss auditable.
 *
 * @param {*}        unitdate — parsed unitdate (string, object, or array)
 * @param {string[]} [quirks] — optional dialect_quirks log (mutated if provided)
 * @returns {{ date_expression: string, date_start: string }}
 */
function extractDates(unitdate, quirks) {
  if (!unitdate) return { date_expression: '', date_start: '' };

  const arr = Array.isArray(unitdate) ? unitdate : [unitdate];
  if (arr.length === 0 || !arr[0]) return { date_expression: '', date_start: '' };

  // Join all expressions so no date value is silently dropped.
  const expressions = arr
    .map(el => sanitizeField(textOf(el)))
    .filter(Boolean);
  const expression = expressions.join('; ');

  // Use the first @normal for date_start (earliest in document order).
  const firstEl = arr[0];
  const normal  = typeof firstEl === 'object' ? (firstEl['@_normal'] || '') : '';
  let dateStart = '';
  if (normal) {
    const start = normal.split('/')[0].trim();
    dateStart = sanitizeField(start);
  }

  // Record any extra unitdate values in dialect_quirks for auditability.
  if (Array.isArray(quirks) && arr.length > 1) {
    quirks.push(
      `unitdate array with ${arr.length} entries: joined all expressions; ` +
      `${arr.length - 1} additional unitdate value(s) beyond the first`
    );
  }

  return { date_expression: expression, date_start: dateStart };
}

// ---------------------------------------------------------------------------
// DAO → IIIF manifest URL extraction
// ---------------------------------------------------------------------------

/**
 * Extract a IIIF manifest URL from a <dao> element.
 * Only returns a URL if the href looks like a IIIF manifest (ends in
 * '/manifest.json' or similar). Otherwise, documents it in quirks.
 * Supports both @href and @xlink:href (AtoM/AS dialects).
 *
 * @param {object[]} daos   — array of parsed <dao> elements
 * @param {string[]} quirks — dialect quirk log (mutated)
 * @returns {string} manifest URL or empty string
 */
function extractIiifManifest(daos, quirks) {
  if (!daos || !Array.isArray(daos) || daos.length === 0) return '';

  for (const dao of daos) {
    if (!dao || typeof dao !== 'object') continue;
    const href = dao['@_href'] || dao['@_xlink:href'] || dao['@_xlink_href'] || '';
    if (!href) continue;
    if (href.includes('manifest.json') || href.includes('/manifest')) {
      return href;
    }
    // Non-IIIF DAO — note in quirks
    quirks.push(`dao href detected (non-IIIF): ${href}`);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Authority loading
// ---------------------------------------------------------------------------

/**
 * Load entity and place authority code sets from the instance root.
 * Looks for entities.json and places.json in instanceRoot; falls back to
 * empty sets if the files don't exist (graceful degradation).
 *
 * @param {string} instanceRoot — path to directory containing authority files
 * @returns {{ entityCodes: Set<string>, placeCodes: Set<string> }}
 */
function loadAuthorityCodes(instanceRoot) {
  const entityCodes = new Set();
  const placeCodes  = new Set();

  const entitiesPath = path.join(instanceRoot, 'entities.json');
  if (fs.existsSync(entitiesPath)) {
    try {
      const entities = JSON.parse(fs.readFileSync(entitiesPath, 'utf8'));
      for (const e of entities) {
        if (e.entity_code) entityCodes.add(e.entity_code);
      }
    } catch (_) { /* graceful: empty set */ }
  }

  const placesPath = path.join(instanceRoot, 'places.json');
  if (fs.existsSync(placesPath)) {
    try {
      const places = JSON.parse(fs.readFileSync(placesPath, 'utf8'));
      for (const p of places) {
        if (p.place_code) placeCodes.add(p.place_code);
      }
    } catch (_) { /* graceful: empty set */ }
  }

  return { entityCodes, placeCodes };
}

// ---------------------------------------------------------------------------
// Access point (controlaccess) processing — links only, no authority minting
// ---------------------------------------------------------------------------

/**
 * Process <controlaccess> elements for a description.
 * Emits entity_link and place_link records ONLY when @identifier matches an
 * existing authority code. Bare/unmatched names are added to the notes
 * field of the description and counted in the reconciliation report.
 *
 * @param {object}   controlaccess — parsed controlaccess element
 * @param {string}   referenceCode — reference_code of the parent description
 * @param {Set<string>} entityCodes
 * @param {Set<string>} placeCodes
 * @param {object[]} entityLinks  — output array (mutated)
 * @param {object[]} placeLinks   — output array (mutated)
 * @param {object}   report       — reconciliation report object (mutated)
 * @returns {string[]} bare names to add to description notes
 */
function processControlaccess(
  controlaccess,
  referenceCode,
  entityCodes,
  placeCodes,
  entityLinks,
  placeLinks,
  report
) {
  if (!controlaccess) return [];

  const bareNames = [];

  // Entity-type access points: persname, corpname, famname
  for (const elementName of ['persname', 'corpname', 'famname']) {
    const elements = controlaccess[elementName];
    if (!elements) continue;
    const arr = Array.isArray(elements) ? elements : [elements];
    for (const el of arr) {
      const text       = sanitizeField(textOf(el));
      const identifier = typeof el === 'object' ? (el['@_identifier'] || '') : '';
      const relator    = typeof el === 'object' ? (el['@_relator']    || '') : '';

      if (identifier && entityCodes.has(identifier)) {
        // Matched an existing authority code — emit an entity_link
        entityLinks.push({
          entity_code:    identifier,
          reference_code: referenceCode,
          role:           sanitizeField(relator) || 'subject',
        });
        report.access_points.carried++;
      } else {
        // No @identifier or unmatched — drop the name to prose, never mint
        bareNames.push(text);
        report.access_points.skipped++;
        report.access_points.skipped_list.push({
          element: elementName,
          text,
          reason: identifier ? `@identifier "${identifier}" not in authority file` : 'no @identifier',
        });
      }
    }
  }

  // Geographic access points: geogname
  const geognames = controlaccess['geogname'];
  if (geognames) {
    const arr = Array.isArray(geognames) ? geognames : [geognames];
    for (const el of arr) {
      const text       = sanitizeField(textOf(el));
      const identifier = typeof el === 'object' ? (el['@_identifier'] || '') : '';
      const relator    = typeof el === 'object' ? (el['@_relator']    || '') : '';

      if (identifier && placeCodes.has(identifier)) {
        // Matched an existing authority code — emit a place_link
        placeLinks.push({
          place_code:     identifier,
          reference_code: referenceCode,
          role:           sanitizeField(relator) || 'place',
        });
        report.access_points.carried++;
      } else {
        // Bare or unmatched — drop the name to prose, never mint
        bareNames.push(text);
        report.access_points.skipped++;
        report.access_points.skipped_list.push({
          element: 'geogname',
          text,
          reason: identifier ? `@identifier "${identifier}" not in authority file` : 'no @identifier',
        });
      }
    }
  }

  return bareNames;
}

// ---------------------------------------------------------------------------
// Description walker
// ---------------------------------------------------------------------------

/**
 * Walk an archdesc or component element and extract a description record.
 *
 * @param {object}   el             — parsed element (archdesc or c/c01..c12)
 * @param {number}   id             — sequential integer id (auto-generated)
 * @param {string}   repositoryCode — inherited from eadid derivation
 * @param {string}   parentRefCode  — reference_code of parent (null for root)
 * @param {string}   standard       — descriptive standard key (e.g. 'isadg')
 * @param {Set<string>} entityCodes
 * @param {Set<string>} placeCodes
 * @param {object[]} descriptions   — output array (mutated)
 * @param {object[]} entityLinks    — output array (mutated)
 * @param {object[]} placeLinks     — output array (mutated)
 * @param {object}   report         — reconciliation report (mutated)
 * @param {number[]} counter        — [0]: mutable id counter
 */
function walkElement(
  el,
  repositoryCode,
  parentRefCode,
  standard,
  entityCodes,
  placeCodes,
  descriptions,
  entityLinks,
  placeLinks,
  report,
  counter
) {
  if (!el || typeof el !== 'object') return;

  const did = el.did || {};

  // --- reference_code ---
  const unitid = did.unitid;
  const referenceCode = sanitizeField(textOf(unitid)) || '';
  if (!referenceCode) return; // skip elements with no unitid

  // --- id (auto-generated sequential integer) ---
  const id = ++counter[0];

  // --- title ---
  const title = sanitizeField(textOf(did.unittitle)) || '';

  // --- description_level ---
  const levelAttr = el['@_level'] || '';
  const otherLevel = el['@_otherlevel'] || '';
  const descriptionLevel = mapLevel(levelAttr, otherLevel);

  // --- dates ---
  const { date_expression, date_start } = extractDates(did.unitdate, report.dialect_quirks);

  // --- scope_content ---
  const scopeContent = blockText(el.scopecontent);

  // --- access / use conditions ---
  const accessConditions       = blockText(el.accessrestrict);
  const reproductionConditions = blockText(el.userestrict);

  // --- arrangement ---
  const arrangement = blockText(el.arrangement);

  // --- extent ---
  let extent = '';
  if (did.physdesc) {
    const physdesc = did.physdesc;
    extent = sanitizeField(textOf(physdesc.extent) || textOf(physdesc)) || '';
  }

  // --- language ---
  let language = '';
  if (did.langmaterial) {
    const lm = did.langmaterial;
    if (lm.language) {
      language = sanitizeField(textOf(lm.language)) || '';
    }
    if (!language) {
      language = sanitizeField(textOf(lm)) || '';
    }
  }

  // --- optional text fields ---
  const locationOfOriginals = blockText(el.originalsloc);
  const locationOfCopies    = blockText(el.altformavail);
  const relatedMaterials    = blockText(el.relatedmaterial) || blockText(el.separatedmaterial);
  const findingAids         = blockText(el.otherfindaid);

  // --- notes ---
  const oddNotes = blockText(el.odd) || blockText(el.note);

  // --- DAO → iiif_manifest_url ---
  const daos       = did.dao ? (Array.isArray(did.dao) ? did.dao : [did.dao]) : [];
  // Also check dao at component level (some EAD3 dialects place it there)
  const componentDaos = el.dao ? (Array.isArray(el.dao) ? el.dao : [el.dao]) : [];
  const allDaos = [...daos, ...componentDaos];
  const iiifManifestUrl = extractIiifManifest(allDaos, report.dialect_quirks);

  if (allDaos.length > 0 && iiifManifestUrl) {
    report.dialect_quirks.push(`dao xlink:href detected on 1 component(s)`);
  }

  // --- controlaccess → entity/place links + bare names ---
  const bareNames = processControlaccess(
    el.controlaccess,
    referenceCode,
    entityCodes,
    placeCodes,
    entityLinks,
    placeLinks,
    report
  );

  // --- Compose notes: odd notes + bare names dropped to prose ---
  const bareNoteParts = bareNames.map(n => `Bare name (no @identifier) dropped to prose: ${n}`);
  const noteParts = [oddNotes, ...bareNoteParts].filter(Boolean);
  const notes = noteParts.join('|');

  // --- Build description record ---
  const desc = {
    id,
    reference_code: referenceCode,
    title,
    description_level: descriptionLevel,
    parent_reference_code: parentRefCode || null,
    repository_code: repositoryCode,
  };

  if (date_expression) desc.date_expression = date_expression;
  if (date_start)      desc.date_start      = date_start;
  if (scopeContent)    desc.scope_content   = scopeContent;
  if (extent)          desc.extent          = extent;
  if (language)        desc.language        = language;
  if (accessConditions)        desc.access_conditions       = accessConditions;
  if (reproductionConditions)  desc.reproduction_conditions = reproductionConditions;
  if (arrangement)             desc.arrangement             = arrangement;
  if (locationOfOriginals)     desc.location_of_originals   = locationOfOriginals;
  if (locationOfCopies)        desc.location_of_copies      = locationOfCopies;
  if (relatedMaterials)        desc.related_materials        = relatedMaterials;
  if (findingAids)             desc.finding_aids             = findingAids;
  if (iiifManifestUrl)         desc.iiif_manifest_url        = iiifManifestUrl;
  if (notes)                   desc.notes                    = notes;

  desc.descriptive_standard = standard;

  descriptions.push(desc);

  // --- Recurse into DSC components ---
  const dsc = el.dsc || null;
  if (dsc) {
    walkDsc(dsc, referenceCode, repositoryCode, standard, entityCodes, placeCodes,
            descriptions, entityLinks, placeLinks, report, counter);
  }

  // Also recurse into inline component children (for component-level children)
  walkComponentChildren(el, referenceCode, repositoryCode, standard, entityCodes, placeCodes,
                        descriptions, entityLinks, placeLinks, report, counter);
}

/**
 * Walk a <dsc> element, processing all immediate component children.
 */
function walkDsc(
  dsc,
  parentRefCode,
  repositoryCode,
  standard,
  entityCodes,
  placeCodes,
  descriptions,
  entityLinks,
  placeLinks,
  report,
  counter
) {
  if (!dsc) return;
  walkComponentChildren(dsc, parentRefCode, repositoryCode, standard, entityCodes, placeCodes,
                        descriptions, entityLinks, placeLinks, report, counter);
}

/**
 * Walk all component children of any element (dsc or c/c01-c12).
 * Handles both unnumbered <c> and numbered <c01>–<c12> nesting styles.
 */
function walkComponentChildren(
  parent,
  parentRefCode,
  repositoryCode,
  standard,
  entityCodes,
  placeCodes,
  descriptions,
  entityLinks,
  placeLinks,
  report,
  counter
) {
  for (const componentName of COMPONENT_NAMES) {
    const children = parent[componentName];
    if (!children) continue;
    const arr = Array.isArray(children) ? children : [children];
    // Detect numbered components for dialect_quirks log
    if (componentName !== 'c' && !report.dialect_quirks.includes('numbered component elements (c01/c02) detected — treated as <c> per EAD3 recommendation')) {
      report.dialect_quirks.push('numbered component elements (c01/c02) detected — treated as <c> per EAD3 recommendation');
    }
    for (const child of arr) {
      walkElement(child, repositoryCode, parentRefCode, standard,
                  entityCodes, placeCodes, descriptions, entityLinks,
                  placeLinks, report, counter);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Convert an EAD3 XML export into the six-file contract.
 *
 * @param {object} opts
 * @param {string} opts.src          — path to the EAD3 XML file
 * @param {string} opts.stagingDir   — directory to write JSON output into
 * @param {string} [opts.standard]   — descriptive standard key (default: 'isadg')
 * @param {string} [opts.instanceRoot] — path to directory containing authority files
 */
async function run({ src, stagingDir, standard, instanceRoot }) {
  const std = standard || 'isadg';

  // Read and parse the XML — no entity resolution, no DOCTYPE fetch, so a
  // hostile EAD3 file cannot read local files or reach out over the network.
  const xmlContent = fs.readFileSync(src, 'utf8');
  const parser = new XMLParser(PARSER_OPTS);
  const doc    = parser.parse(xmlContent);

  // Navigate to <ead> root (parser may unwrap namespace declarations)
  const ead = doc.ead || doc;

  // --- Repository code from eadheader/eadid ---
  const eadheader    = ead.eadheader || {};
  const eadid        = eadheader.eadid || null;
  const repositoryCode = deriveRepositoryCode(eadid);

  // --- Load authority codes for link matching ---
  const root = instanceRoot || path.dirname(src);
  const { entityCodes, placeCodes } = loadAuthorityCodes(root);

  // --- Output arrays ---
  const descriptions  = [];
  const entityLinks   = [];
  const placeLinks    = [];

  // --- Repository record (minimal: id, code, name) ---
  let repositoryName = '';
  const archdesc = ead.archdesc || {};
  const archdescDid = archdesc.did || {};
  const repositoryEl = archdescDid.repository || {};
  // corpname may be an array (isArray config includes 'corpname')
  const corpnameRaw = repositoryEl.corpname;
  const corpnameEl  = Array.isArray(corpnameRaw) ? corpnameRaw[0] : corpnameRaw;
  repositoryName = sanitizeField(textOf(corpnameEl) || textOf(repositoryEl)) || '';

  const repositories = repositoryName
    ? [{ id: 1, code: repositoryCode, name: repositoryName }]
    : [{ id: 1, code: repositoryCode, name: repositoryCode }];

  // --- Reconciliation report skeleton ---
  const report = {
    format:              'ead3',
    dialect:             'unknown',
    standard:            std,
    descriptions_count:  0,
    repositories_count:  repositories.length,
    access_points: {
      carried:      0,
      skipped:      0,
      skipped_list: [],
    },
    dialect_quirks: [],
  };

  // --- Walk archdesc ---
  const counter = [0]; // mutable id counter
  walkElement(archdesc, repositoryCode, null, std,
              entityCodes, placeCodes,
              descriptions, entityLinks, placeLinks,
              report, counter);

  // --- Detect dialect from component naming ---
  const hasNumbered = report.dialect_quirks.some(q => q.includes('numbered component elements'));
  report.dialect = hasNumbered ? 'atom' : 'archivesspace';

  // Deduplicate dialect_quirks — dao quirk may be added multiple times
  const daoCount = entityLinks.length; // rough proxy; count actual dao occurrences
  // Rewrite dao quirk with correct count
  const daoQuirkIdx = report.dialect_quirks.findIndex(q => q.startsWith('dao xlink:href detected on'));
  if (daoQuirkIdx !== -1) {
    // Count unique descriptions that have iiif_manifest_url
    const daoDescCount = descriptions.filter(d => d.iiif_manifest_url).length;
    report.dialect_quirks[daoQuirkIdx] = `dao xlink:href detected on ${daoDescCount} component(s)`;
    // Remove any subsequent duplicates
    report.dialect_quirks = report.dialect_quirks.filter((q, i) =>
      i === daoQuirkIdx || !q.startsWith('dao xlink:href detected on')
    );
  }

  report.descriptions_count = descriptions.length;

  // --- Write six contract files ---
  const write = (name, data) =>
    fs.writeFileSync(path.join(stagingDir, name), JSON.stringify(data, null, 2), 'utf8');

  write('descriptions.json',  descriptions);
  write('repositories.json',  repositories);
  write('entities.json',      []);          // EAD3 never mints authority records
  write('entity_links.json',  entityLinks);
  write('places.json',        []);          // EAD3 never mints place records
  write('place_links.json',   placeLinks);
  write('import-report.json', report);
}

module.exports = { run };

// Version: v0.2.0
