/**
 * Manifest + Input Validator — Build-Gate and Standalone Command
 *
 * Validates a Zasqua instance before the build pipeline runs. The validator
 * is the first step of `zasqua build` and is also available standalone as
 * `zasqua validate`. It enforces three categories of checks:
 *
 *   Module dependency violations. Certain explorer modules require
 *   their supporting module to be enabled: `entities_graph` requires
 *   `entities`; `places_map` requires `places`. A violation is a hard error
 *   that fails the build loudly — there is no way to build a graph without
 *   entity data.
 *
 *   Per-module input conformance. For every module that the manifest
 *   enables, the validator checks that the corresponding data file in
 *   `exports/` (a) exists, (b) parses as valid JSON, (c) is a JSON array
 *   whose elements are all objects (a non-object element — null, array, or
 *   primitive — is rejected per-record with its index, not thrown on), and
 *   (d) every record carries the required keys with the correct primitive
 *   types. Required keys + types derive from `docs/data-contract.md` §2.
 *   Core files (descriptions, repositories) are always checked.
 *
 *   Full JSON Schema conformance (--strict mode). When `--strict` is
 *   passed, each export file present in `exports/` is validated against its
 *   corresponding schema in `schemas/` using ajv draft-07. The key + type
 *   pre-pass runs first for actionable messages on missing fields; the
 *   schema pass runs second for full conformance. Files absent from
 *   `exports/` are silently skipped — their absence is caught by the
 *   per-module conformance pass. When `--strict` is false, ajv is never
 *   loaded (lazy require pattern).
 *
 * Public API:
 *
 *   validateManifest(manifest)
 *     Checks manifest-level dependency rules. Returns an array of
 *     error strings. Empty array means the manifest is self-consistent.
 *
 *   validateInputs(manifest, dataDir)
 *     For each enabled module, checks that the corresponding file exists in
 *     `dataDir`, is a valid JSON array, and every record has required keys
 *     with correct primitive types. Returns an array of error strings.
 *
 *   validateSchemas(dataDir, engineRoot, errors)
 *     Full JSON Schema pass via ajv draft-07 over the six contract files
 *     found in `dataDir`. Validates each present file against its schema in
 *     `engineRoot/schemas/`. Mutates `errors` in place; absent files are
 *     silently skipped. Called only when --strict is true.
 *
 *   runValidate({ manifest, instanceRoot, engineRoot, strict })
 *     CLI/pipeline entry point. Loads the manifest if not supplied, resolves
 *     `dataDir` from `instanceRoot`, calls `validateManifest`,
 *     `validateInputs`, `validateBundle`, and (when strict=true)
 *     `validateSchemas`. Returns an array of error strings (empty = pass).
 *     When called as `require.main === module` (standalone), prints each
 *     error with a `[validate]` prefix and exits 1 on failure, 0 on pass.
 *
 *   validateBundle(manifest, engineRoot)
 *     Per-instance bundle gate — the build-time half of the two-layer i18n
 *     check. Checks that the i18n bundle for the selected language (derived
 *     from manifest [ui].language) exists in themes/base/i18n/ and
 *     contains every key in REQUIRED_KEYS. Returns error strings; empty
 *     means bundle is valid.
 *
 * A note on what is validated: the validator checks `exports/*.json` (the
 * raw pipeline input), NOT `assets/hugo-data/*.json` (the enriched output).
 * Checking enriched files would be too late — the pipeline would have already
 * crashed with an unhelpful ENOENT before reaching Stage 4.
 *
 * @version v0.3.1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');
const { loadManifest } = require('./manifest');

// ---------------------------------------------------------------------------
// Required-key + type tables — sourced from docs/data-contract.md §2
// ---------------------------------------------------------------------------

/**
 * Type-check table entry: `{ key, type }` where `type` is the string returned
 * by `typeof` for a valid value ('number' for integers, 'string', 'boolean').
 * The special type 'string|null' means the value is allowed to be null or a
 * string.
 *
 * @typedef {{ key: string, type: string }} FieldSpec
 */

/** @type {FieldSpec[]} */
const DESCRIPTION_FIELDS = [
  { key: 'id', type: 'number' },
  { key: 'reference_code', type: 'string' },
  { key: 'title', type: 'string' },
  { key: 'description_level', type: 'string' },
  { key: 'parent_reference_code', type: 'string|null' },
  { key: 'repository_code', type: 'string' },
];

/** @type {FieldSpec[]} */
const REPOSITORY_FIELDS = [
  { key: 'id', type: 'number' },
  { key: 'code', type: 'string' },
  { key: 'name', type: 'string' },
];

/** @type {FieldSpec[]} */
const ENTITY_FIELDS = [
  { key: 'entity_code', type: 'string' },
  { key: 'display_name', type: 'string' },
  { key: 'entity_type', type: 'string' },
];

/** @type {FieldSpec[]} */
const ENTITY_LINK_FIELDS = [
  { key: 'entity_code', type: 'string' },
  { key: 'reference_code', type: 'string' },
  { key: 'role', type: 'string' },
];

/** @type {FieldSpec[]} */
const PLACE_FIELDS = [
  { key: 'id', type: 'number' },
  { key: 'place_code', type: 'string' },
  { key: 'display_name', type: 'string' },
];

/** @type {FieldSpec[]} */
const PLACE_LINK_FIELDS = [
  { key: 'place_code', type: 'string' },
  { key: 'reference_code', type: 'string' },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a value satisfies a field spec type.
 *
 * @param {*} val
 * @param {string} expectedType
 * @returns {boolean}
 */
function typeOk(val, expectedType) {
  if (expectedType === 'string|null') {
    return val === null || typeof val === 'string';
  }
  return typeof val === expectedType;
}

/**
 * Read a file from `dataDir`, parse as JSON, confirm it is an array, and
 * check every record for required keys + types. Appends error strings to
 * `errors`.
 *
 * Emits a `validate module=<module> status=pass|fail records=<N>` line per
 * file (check-build-counts log style).
 *
 * @param {string}      filePath  — absolute path to the JSON file
 * @param {string}      moduleName — short label for log lines (e.g. 'entities')
 * @param {FieldSpec[]} fields    — required key + type specs
 * @param {string[]}    errors    — accumulator; mutated in place
 */
function checkFile(filePath, moduleName, fields, errors) {
  const startLen = errors.length;
  if (!fs.existsSync(filePath)) {
    errors.push(`validate module=${moduleName} status=fail error="file not found: ${filePath}"`);
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    errors.push(`validate module=${moduleName} status=fail error="JSON parse failed: ${e.message}"`);
    return;
  }

  if (!Array.isArray(data)) {
    errors.push(`validate module=${moduleName} status=fail error="${path.basename(filePath)} is not a JSON array"`);
    return;
  }

  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      const kind = record === null ? 'null' : Array.isArray(record) ? 'array' : typeof record;
      errors.push(
        `validate module=${moduleName} status=fail error="record ${i} is not an object: got ${kind}"`
      );
      continue;
    }
    for (const { key, type } of fields) {
      if (!(key in record)) {
        errors.push(
          `validate module=${moduleName} status=fail error="missing required key: ${key} at record ${i}"`
        );
        break; // one error per record is enough for actionability
      }
      if (!typeOk(record[key], type)) {
        errors.push(
          `validate module=${moduleName} status=fail error="wrong type for key '${key}' at record ${i}: expected ${type}, got ${typeof record[key]}"`
        );
        break;
      }
    }
  }

  // Pass/fail is decided from the errors THIS call produced (startLen..now),
  // not by rescanning the shared accumulator by module-name substring — which
  // would cross-contaminate if two files ever shared a module label.
  if (errors.length === startLen) {
    console.log(`validate module=${moduleName} status=pass records=${data.length}`);
  }
}

// ---------------------------------------------------------------------------
// i18n bundle helpers
// ---------------------------------------------------------------------------

// CLDR plural category keys. An object whose only properties are a subset of
// these is treated as a plural table terminal, not a nested namespace.
const CLDR_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Recursively flatten a parsed TOML object to a Set of dotted-path keys.
 * Plural tables (objects whose keys are all CLDR categories) are treated as
 * terminal — they contribute one entry at the table path, not one per
 * category. This mirrors the REQUIRED_KEYS convention in i18n-keys.js.
 *
 * Example:
 *   { nav: { home: "Inicio" }, tree: { childUnit: { one: "unidad", other: "unidades" } } }
 *   → Set { "nav.home", "tree.childUnit" }
 *
 * @param {object} obj   — TOML-parsed object
 * @param {string} [prefix] — dotted-path prefix for recursion
 * @returns {Set<string>}
 */
function flattenKeys(obj, prefix) {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // If all keys of this sub-object are CLDR categories, treat it as terminal
      const subKeys = Object.keys(v);
      const isPlural = subKeys.length > 0 && subKeys.every(sk => CLDR_CATEGORIES.has(sk));
      if (isPlural) {
        keys.add(full);
      } else {
        for (const nested of flattenKeys(v, full)) {
          keys.add(nested);
        }
      }
    } else {
      keys.add(full);
    }
  }
  return keys;
}

/**
 * Check that the selected language bundle exists and contains all required
 * keys. Per-instance bundle gate — the build-time half of the two-layer
 * i18n check.
 *
 * Derives the base language from manifest [ui].language (e.g. "es-CO" → "es"),
 * looks up themes/base/i18n/${baseLang}.toml in engineRoot, parses it, and
 * checks every key in REQUIRED_KEYS is present. Returns error strings; empty
 * means the bundle is valid and the build may proceed.
 *
 * @param {object} manifest    — parsed manifest object
 * @param {string} engineRoot  — absolute path to the engine root
 * @returns {string[]} error strings; empty array = bundle valid
 */
function validateBundle(manifest, engineRoot) {
  const errors = [];
  const { REQUIRED_KEYS } = require('./i18n-keys');

  const selectedLang = (manifest.ui && manifest.ui.language) || 'en-US';
  const baseLang = selectedLang.split('-')[0];          // "es-CO" → "es"
  const bundlePath = path.join(engineRoot, 'themes', 'base', 'i18n', `${baseLang}.toml`);

  if (!fs.existsSync(bundlePath)) {
    errors.push(
      `validate i18n status=fail error="bundle not found: ${baseLang}.toml (derived from language=${selectedLang})"`
    );
    return errors;   // can't check keys without the file
  }

  let bundle;
  try {
    bundle = parseToml(fs.readFileSync(bundlePath, 'utf8'));
  } catch (e) {
    errors.push(
      `validate i18n status=fail error="bundle parse failed: ${baseLang}.toml — ${e.message}"`
    );
    return errors;
  }

  const flatKeys = flattenKeys(bundle);

  for (const key of REQUIRED_KEYS) {
    if (!flatKeys.has(key)) {
      errors.push(
        `validate i18n status=fail error="missing key '${key}' in ${baseLang}.toml"`
      );
    }
  }

  if (errors.length === 0) {
    console.log(`validate i18n status=pass bundle=${baseLang}.toml keys=${REQUIRED_KEYS.length}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check manifest-level dependency rules.
 *
 * @param {object} manifest — parsed manifest object (modules sub-object expected)
 * @returns {string[]} array of error strings; empty means the manifest is valid
 */
function validateManifest(manifest) {
  const errors = [];
  const m = (manifest && manifest.modules) ? manifest.modules : {};

  if (m.entities_graph && !m.entities) {
    errors.push(
      'validate manifest status=fail error="entities_graph requires entities to be enabled"'
    );
  }
  if (m.places_map && !m.places) {
    errors.push(
      'validate manifest status=fail error="places_map requires places to be enabled"'
    );
  }

  return errors;
}

/**
 * Check that every enabled module's input files exist and conform.
 *
 * Core (descriptions + repositories) is always checked, regardless of
 * manifest flags.
 *
 * @param {object} manifest — parsed manifest object
 * @param {string} dataDir  — absolute path to the exports directory
 * @returns {string[]} array of error strings; empty means all inputs are valid
 */
function validateInputs(manifest, dataDir) {
  const errors = [];
  const m = (manifest && manifest.modules) ? manifest.modules : {};

  // Core — always required
  checkFile(path.join(dataDir, 'descriptions.json'), 'descriptions', DESCRIPTION_FIELDS, errors);
  checkFile(path.join(dataDir, 'repositories.json'), 'repositories', REPOSITORY_FIELDS, errors);

  // Entities module
  if (m.entities) {
    checkFile(path.join(dataDir, 'entities.json'), 'entities', ENTITY_FIELDS, errors);
    checkFile(path.join(dataDir, 'entity_links.json'), 'entity_links', ENTITY_LINK_FIELDS, errors);
  }

  // Places module
  if (m.places) {
    checkFile(path.join(dataDir, 'places.json'), 'places', PLACE_FIELDS, errors);
    checkFile(path.join(dataDir, 'place_links.json'), 'place_links', PLACE_LINK_FIELDS, errors);
  }

  return errors;
}

/**
 * Run full JSON Schema validation (draft-07) via ajv on each export file
 * present in `dataDir`. Called only when --strict is true. Validates each
 * present file against the corresponding schema in `engineRoot/schemas/`.
 *
 * ajv is lazy-required inside this function so the module loads without
 * crashing if ajv is not installed, and only touches ajv on the --strict
 * path. ajv v8.20.0 already registers draft-07 internally; the x-contract-
 * version extension keyword requires strict:false so ajv does not reject it
 * as an unknown keyword.
 *
 * Absent files are silently skipped — their absence is validateInputs'
 * concern, not this function's.
 *
 * @param {string}   dataDir    — absolute path to the exports directory
 * @param {string}   engineRoot — absolute path to the engine root
 * @param {string[]} errors     — accumulator; mutated in place
 */
function validateSchemas(dataDir, engineRoot, errors) {
  const Ajv = require('ajv');
  // ajv v8.20.0 already registers draft-07 internally — addMetaSchema must not
  // be called (it throws "schema already exists"). Use strict:false so that the
  // x-contract-version extension keyword in the schemas does not trigger ajv's
  // unknown-keyword strict-mode error.
  const ajv = new Ajv({ allErrors: true, strict: false });

  const schemaMap = {
    'descriptions.json':  'descriptions.schema.json',
    'repositories.json':  'repositories.schema.json',
    'entities.json':      'entities.schema.json',
    'entity_links.json':  'entity_links.schema.json',
    'places.json':        'places.schema.json',
    'place_links.json':   'place_links.schema.json',
  };

  const schemasDir = path.join(engineRoot, 'schemas');

  for (const [dataFile, schemaFile] of Object.entries(schemaMap)) {
    const dataPath = path.join(dataDir, dataFile);
    if (!fs.existsSync(dataPath)) continue;  // absent = handled by validateInputs

    const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, schemaFile), 'utf8'));
    const validate = ajv.compile(schema);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    if (!validate(data)) {
      for (const err of validate.errors) {
        errors.push(
          `validate schema=${schemaFile} status=fail error="${err.instancePath} ${err.message}"`
        );
      }
    } else {
      console.log(`validate schema=${schemaFile} status=pass`);
    }
  }
}

/**
 * CLI and pipeline entry point.
 *
 * Loads the manifest (from `opts.manifest` if provided, else reads from
 * `instanceRoot`), resolves `dataDir` and `engineRoot`, runs
 * `validateManifest`, `validateInputs`, `validateBundle`, and (when
 * opts.strict is true) `validateSchemas`. Returns an array of error strings
 * (empty = pass).
 *
 * When opts.strict is true, the key + type pre-pass runs first (better
 * messages for missing required fields) and the ajv schema pass runs second
 * (full contract conformance). When opts.strict is false, validateSchemas
 * and ajv are not touched.
 *
 * @param {object} opts
 * @param {object} [opts.manifest]     — pre-loaded manifest (skips file read if supplied)
 * @param {string} [opts.instanceRoot] — absolute path to the instance root
 * @param {string} [opts.engineRoot]   — absolute path to the engine root
 * @param {boolean} [opts.strict]      — enable full JSON Schema pass
 * @returns {string[]} error strings; empty array = validation passed
 */
function runValidate(opts = {}) {
  const instanceRoot = opts.instanceRoot || process.env.INSTANCE_ROOT || process.cwd();
  const manifest = opts.manifest || loadManifest(instanceRoot);
  const engineRoot = opts.engineRoot || process.env.ENGINE_ROOT || path.join(__dirname, '..');
  const dataDir = process.env.DATA_DIR || path.join(instanceRoot, 'exports');

  const errors = [
    ...validateManifest(manifest),
    ...validateInputs(manifest, dataDir),
    ...validateBundle(manifest, engineRoot),   // bundle completeness gate
  ];

  if (opts.strict) {
    validateSchemas(dataDir, engineRoot, errors);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Standalone mode
// ---------------------------------------------------------------------------

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const errors = runValidate({ strict });
  if (errors.length > 0) {
    errors.forEach(e => console.error('[validate]', e));
    process.exit(1);
  }
  console.log('[validate] All checks passed.');
  process.exit(0);
}

module.exports = { runValidate, validateManifest, validateInputs, validateBundle, validateSchemas };

// Version: v0.3.1
