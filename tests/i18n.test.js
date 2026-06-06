/**
 * i18n Bundle Unit Tests — Key-Parity and Completeness Gate
 *
 * Tests for the two i18n bundles (es.toml and en.toml) that form the
 * engine's chrome string layer. The Chrome i18n layer externalises all
 * navigation labels, button copy, error messages, section headers, and
 * similar UI strings from templates into locale-keyed TOML bundles, so
 * that any deployer can configure the site's interface language via a
 * single manifest entry.
 *
 * Four behavior groups are covered:
 *
 *   1. "es.toml completeness" — parses the real themes/base/i18n/es.toml,
 *      flattens it to a set of dotted leaf paths, and asserts every key in
 *      REQUIRED_KEYS is present. This guards the Colombian-Spanish bundle
 *      against missing strings.
 *
 *   2. "en.toml completeness" — same check against en.toml.
 *
 *   3. "en↔es key-parity" — asserts the flattened key sets of es.toml
 *      and en.toml are identical (symmetric difference empty). This is the
 *      CI gate that stops a half-translated bundle from shipping: every
 *      string present in one language must be present in the other.
 *
 *   4. "no vocabulary keys leaked" — asserts neither bundle contains the
 *      top-level tables reserved for domain vocabulary (levels, levelsPlural,
 *      roles, entity.types, place.types). Those belong in the data files and
 *      standards profiles, not in the chrome string bundle.
 *
 * Bundles are read from the real engine theme path (relative to this test
 * file via import.meta.url). Tests use graceful-missing file handling so the
 * full test file runs even before a bundle exists.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { REQUIRED_KEYS } = require('../lib/i18n-keys.js');
const { parse } = require('smol-toml');

// ---------------------------------------------------------------------------
// Paths (resolved from this test file's location)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_DIR = path.join(__dirname, '..', 'themes', 'base', 'i18n');
const ES_TOML_PATH = path.join(I18N_DIR, 'es.toml');
const EN_TOML_PATH = path.join(I18N_DIR, 'en.toml');

// ---------------------------------------------------------------------------
// CLDR plural category names — used by flattenKeys to identify plural tables
// ---------------------------------------------------------------------------

const CLDR_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Walk a parsed TOML object and return a Set of dotted leaf paths.
 *
 * Plural tables — objects whose own keys are a non-empty subset of the CLDR
 * plural category names (zero/one/two/few/many/other) — are treated as a
 * single terminal key at the table path. For example, the TOML:
 *
 *   [tree.childUnit]
 *   one = "unit"
 *   other = "units"
 *
 * contributes exactly one key: "tree.childUnit".
 *
 * This matches the convention used in REQUIRED_KEYS: plural tables appear as
 * a single entry (e.g. 'tree.childUnit'), not as 'tree.childUnit.one' and
 * 'tree.childUnit.other'.
 *
 * @param {object} obj — parsed TOML object
 * @param {string} [prefix] — dotted path prefix for the current recursion level
 * @returns {Set<string>} set of dotted leaf paths
 */
function flattenKeys(obj, prefix = '') {
  const result = new Set();

  if (obj === null || typeof obj !== 'object') {
    if (prefix) result.add(prefix);
    return result;
  }

  const ownKeys = Object.keys(obj);

  // Detect plural table: all own keys are CLDR categories and at least one exists
  if (ownKeys.length > 0 && ownKeys.every(k => CLDR_CATEGORIES.has(k))) {
    if (prefix) result.add(prefix);
    return result;
  }

  for (const key of ownKeys) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    const child = obj[key];

    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      const childKeys = Object.keys(child);
      if (childKeys.length > 0 && childKeys.every(k => CLDR_CATEGORIES.has(k))) {
        // Plural table — treat the whole subtable as one terminal key
        result.add(childPath);
      } else {
        // Regular nested table — recurse
        for (const k of flattenKeys(child, childPath)) {
          result.add(k);
        }
      }
    } else {
      result.add(childPath);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Behavior 1: es.toml completeness
// ---------------------------------------------------------------------------

describe('es.toml completeness — all REQUIRED_KEYS present', () => {
  const raw = fs.readFileSync(ES_TOML_PATH, 'utf8');
  const parsed = parse(raw);
  const esKeys = flattenKeys(parsed);

  it('es.toml file exists at the expected engine theme path', () => {
    expect(fs.existsSync(ES_TOML_PATH)).toBe(true);
  });

  it('es.toml parses without error', () => {
    expect(() => parse(raw)).not.toThrow();
  });

  it('es.toml contains every key in REQUIRED_KEYS', () => {
    const missing = REQUIRED_KEYS.filter(k => !esKeys.has(k));
    expect(missing, `Missing from es.toml: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('REQUIRED_KEYS has at least 60 entries (sanity check)', () => {
    expect(REQUIRED_KEYS.length).toBeGreaterThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: en.toml completeness
// ---------------------------------------------------------------------------

describe('en.toml completeness — all REQUIRED_KEYS present', () => {
  it('en.toml file exists at the expected engine theme path', () => {
    expect(fs.existsSync(EN_TOML_PATH)).toBe(true);
  });

  it('en.toml parses without error', () => {
    expect(fs.existsSync(EN_TOML_PATH)).toBe(true);
    const raw = fs.readFileSync(EN_TOML_PATH, 'utf8');
    expect(() => parse(raw)).not.toThrow();
  });

  it('en.toml contains every key in REQUIRED_KEYS', () => {
    expect(fs.existsSync(EN_TOML_PATH)).toBe(true);
    const raw = fs.readFileSync(EN_TOML_PATH, 'utf8');
    const parsed = parse(raw);
    const enKeys = flattenKeys(parsed);
    const missing = REQUIRED_KEYS.filter(k => !enKeys.has(k));
    expect(missing, `Missing from en.toml: ${missing.join(', ')}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: en↔es key-parity (the half-translated-bundle gate)
// ---------------------------------------------------------------------------

describe('key-parity — en.toml ↔ es.toml have identical key sets', () => {
  it('en.toml and es.toml have the same keys (symmetric difference is empty)', () => {
    expect(fs.existsSync(ES_TOML_PATH)).toBe(true);
    expect(fs.existsSync(EN_TOML_PATH)).toBe(true);

    const esKeys = flattenKeys(parse(fs.readFileSync(ES_TOML_PATH, 'utf8')));
    const enKeys = flattenKeys(parse(fs.readFileSync(EN_TOML_PATH, 'utf8')));

    const inEsNotEn = [...esKeys].filter(k => !enKeys.has(k));
    const inEnNotEs = [...enKeys].filter(k => !esKeys.has(k));

    expect(
      inEsNotEn,
      `Keys in es.toml but missing from en.toml: ${inEsNotEn.join(', ')}`
    ).toHaveLength(0);

    expect(
      inEnNotEs,
      `Keys in en.toml but missing from es.toml: ${inEnNotEs.join(', ')}`
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: no vocabulary keys leaked into either bundle
// ---------------------------------------------------------------------------

describe('no vocabulary keys leaked — levels/levelsPlural/roles stay in ui.yaml', () => {
  // fields is also guarded here: ISAD(G) field labels belong in standards profiles,
  // not in the chrome bundle. Adding fields back to es.toml/en.toml is a regression.
  const VOCAB_TABLES = ['levels', 'levelsPlural', 'roles', 'fields'];

  it('es.toml has no top-level vocabulary tables', () => {
    const raw = fs.readFileSync(ES_TOML_PATH, 'utf8');
    const parsed = parse(raw);
    for (const table of VOCAB_TABLES) {
      expect(
        parsed[table],
        `es.toml must not contain top-level [${table}] table (migrated to standards profiles)`
      ).toBeUndefined();
    }
    // entity.types and place.types are also vocabulary
    expect(parsed.entity?.types, 'es.toml must not contain entity.types (vocabulary)').toBeUndefined();
    expect(parsed.place?.types, 'es.toml must not contain place.types (vocabulary)').toBeUndefined();
  });

  it('en.toml has no top-level vocabulary tables (when it exists)', () => {
    if (!fs.existsSync(EN_TOML_PATH)) return; // skip gracefully when the bundle is absent
    const raw = fs.readFileSync(EN_TOML_PATH, 'utf8');
    const parsed = parse(raw);
    for (const table of VOCAB_TABLES) {
      expect(
        parsed[table],
        `en.toml must not contain top-level [${table}] table (migrated to standards profiles)`
      ).toBeUndefined();
    }
    expect(parsed.entity?.types, 'en.toml must not contain entity.types (vocabulary)').toBeUndefined();
    expect(parsed.place?.types, 'en.toml must not contain place.types (vocabulary)').toBeUndefined();
  });
});

// Version: v0.2.0
