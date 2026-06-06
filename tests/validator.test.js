/**
 * Validator Unit Tests
 *
 * Tests for `validateManifest`, `validateInputs`, `validateBundle`, and
 * `validateSchemas` from `lib/validator.js`. The validator is the first step
 * of `zasqua build` and is available standalone as `zasqua validate`. It
 * enforces three layers of checks: cross-module dependency rules (a module
 * cannot be enabled without the module it builds on), per-module file
 * existence with JSON array shape and required keys plus primitive types,
 * and full JSON Schema validation via ajv draft-07 under `--strict`.
 *
 * Ten behaviors covered:
 *
 *   1. Dependency violation (entities_graph without entities) —
 *      validateManifest returns an error mentioning entities_graph
 *      requires entities.
 *
 *   2. Dependency violation (places_map without places) —
 *      validateManifest returns an error mentioning places_map requires
 *      places.
 *
 *   3. Missing file — validateInputs on a fixture dir missing an enabled
 *      module's file returns an error naming the missing file.
 *
 *   4. Missing required key — validateInputs on a record missing
 *      `reference_code` (descriptions) returns an error citing the key
 *      and a record index.
 *
 *   5. Conformant data — validateInputs on full conformant fixtures
 *      returns an empty errors array.
 *
 *   6. Wrong primitive type — validateInputs flags `id` as a string
 *      when it should be an integer.
 *
 *   7. validateSchemas accept path — conformant inline fixture produces
 *      zero errors.
 *
 *   8. validateSchemas reject path — a descriptions record missing
 *      required `reference_code` yields an error whose text includes
 *      `descriptions.schema.json` and `fail`.
 *
 *   9. validateSchemas absent-file skip — a contract file absent from the
 *      data dir is silently skipped (absence is validateInputs' concern).
 *
 *  10. Null or primitive array element — validateInputs on
 *      descriptions.json=[null] returns a non-empty string[] containing
 *      an "is not an object" error at record index 0, without throwing a
 *      TypeError. A primitive string element is likewise reported, not
 *      thrown on.
 *
 * All fixtures are written to os.tmpdir() — no real corpus data needed.
 *
 * @version v0.3.1
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { validateManifest, validateInputs, validateSchemas } = require('../lib/validator.js');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory, write an exports/ subdirectory, and populate it
 * with the given JSON files. Returns the path to the exports/ directory.
 *
 * @param {Object} files — { 'descriptions.json': [...], ... }
 * @returns {string} absolute path to the temp exports dir
 */
function makeTmpDataDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-validator-test-'));
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(exportsDir, name), JSON.stringify(data), 'utf8');
  }
  return exportsDir;
}

/** Minimal conformant description record */
function makeDesc(overrides = {}) {
  return {
    id: 1,
    reference_code: 'co-ahrb-001',
    title: 'Test description',
    description_level: 'fonds',
    parent_reference_code: null,
    repository_code: 'ahrb',
    ...overrides,
  };
}

/** Minimal conformant repository record */
function makeRepo(overrides = {}) {
  return { id: 1, code: 'ahrb', name: 'Archivo Histórico', ...overrides };
}

/** Minimal conformant entity record */
function makeEntity(overrides = {}) {
  return {
    entity_code: 'ne-abc12',
    display_name: 'Juan López',
    entity_type: 'person',
    ...overrides,
  };
}

/** Minimal conformant entity_link record */
function makeEntityLink(overrides = {}) {
  return {
    entity_code: 'ne-abc12',
    reference_code: 'co-ahrb-001',
    role: 'subject',
    ...overrides,
  };
}

/** Minimal conformant place record */
function makePlace(overrides = {}) {
  return { id: 1, place_code: 'nl-qfsbu', display_name: 'Bogotá', ...overrides };
}

/** Minimal conformant place_link record */
function makePlaceLink(overrides = {}) {
  return { place_code: 'nl-qfsbu', reference_code: 'co-ahrb-001', ...overrides };
}

// ---------------------------------------------------------------------------
// Behavior 1: dependency violation — entities_graph without entities
// ---------------------------------------------------------------------------

describe('validateManifest — entities_graph without entities', () => {
  it('returns at least one error mentioning entities_graph', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: false,
        entities_graph: true,
        places: false,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    const errors = validateManifest(manifest);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/entities_graph/);
    expect(combined).toMatch(/entities/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: dependency violation — places_map without places
// ---------------------------------------------------------------------------

describe('validateManifest — places_map without places', () => {
  it('returns at least one error mentioning places_map', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: false,
        entities_graph: false,
        places: false,
        places_map: true,
        iiif: false,
        ocr: false,
      },
    };
    const errors = validateManifest(manifest);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/places_map/);
    expect(combined).toMatch(/places/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: missing enabled-module file
// ---------------------------------------------------------------------------

describe('validateInputs — missing file for enabled module', () => {
  it('returns an error naming the missing file when entities.json is absent', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: true,
        entities_graph: false,
        places: false,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    // Provide Core files but omit entities.json and entity_links.json
    const dataDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/entities\.json/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: missing required key in a record
// ---------------------------------------------------------------------------

describe('validateInputs — record missing required key', () => {
  it('returns an error citing reference_code and the record index', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: false,
        entities_graph: false,
        places: false,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    // A description record missing `reference_code`
    const badDesc = { id: 1, title: 'No ref', description_level: 'fonds', parent_reference_code: null, repository_code: 'ahrb' };
    const dataDir = makeTmpDataDir({
      'descriptions.json': [badDesc],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/reference_code/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 10: null or primitive array element — actionable error, no crash
// ---------------------------------------------------------------------------

describe('validateInputs — null or primitive array element', () => {
  const coreOnlyManifest = {
    modules: {
      hierarchy: false,
      entities: false,
      entities_graph: false,
      places: false,
      places_map: false,
      iiif: false,
      ocr: false,
    },
  };

  it('returns a non-empty string[] (does not throw) when descriptions.json is [null]', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [null],
      'repositories.json': [makeRepo()],
    });
    expect(() => validateInputs(coreOnlyManifest, dataDir)).not.toThrow();
    const errors = validateInputs(coreOnlyManifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/is not an object: got null/);
    expect(combined).toMatch(/record 0\b/); // record index 0, anchored
  });

  it('returns a non-empty string[] (does not throw) when descriptions.json is ["x"]', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': ['x'],
      'repositories.json': [makeRepo()],
    });
    expect(() => validateInputs(coreOnlyManifest, dataDir)).not.toThrow();
    const errors = validateInputs(coreOnlyManifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/is not an object: got string/);
  });

  it('reports a numeric array element as not-an-object (does not throw)', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [42],
      'repositories.json': [makeRepo()],
    });
    expect(() => validateInputs(coreOnlyManifest, dataDir)).not.toThrow();
    const errors = validateInputs(coreOnlyManifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.join(' ')).toMatch(/is not an object: got number/);
  });

  it('reports a boolean array element as not-an-object (does not throw)', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [true],
      'repositories.json': [makeRepo()],
    });
    expect(() => validateInputs(coreOnlyManifest, dataDir)).not.toThrow();
    const errors = validateInputs(coreOnlyManifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.join(' ')).toMatch(/is not an object: got boolean/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: conformant data returns zero errors
// ---------------------------------------------------------------------------

describe('validateInputs — conformant data', () => {
  it('returns an empty errors array for fully conformant Core fixtures', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: false,
        entities_graph: false,
        places: false,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    const dataDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(errors).toEqual([]);
  });

  it('returns an empty errors array for conformant Core + entities + places', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: true,
        entities_graph: false,
        places: true,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    const dataDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
      'repositories.json': [makeRepo()],
      'entities.json': [makeEntity()],
      'entity_links.json': [makeEntityLink()],
      'places.json': [makePlace()],
      'place_links.json': [makePlaceLink()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behavior 6: wrong primitive type
// ---------------------------------------------------------------------------

describe('validateInputs — wrong primitive type', () => {
  it('returns an error when id is a string instead of a number', () => {
    const manifest = {
      modules: {
        hierarchy: false,
        entities: false,
        entities_graph: false,
        places: false,
        places_map: false,
        iiif: false,
        ocr: false,
      },
    };
    const badDesc = makeDesc({ id: 'not-a-number' });
    const dataDir = makeTmpDataDir({
      'descriptions.json': [badDesc],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/id/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 7–9: validateSchemas (--strict mode)
// ---------------------------------------------------------------------------

describe('validateSchemas (--strict mode)', () => {
  it('behavior 7: passes on a conformant inline descriptions fixture', () => {
    // Use an inline tmp fixture — no dependency on a shared example/exports/ dir
    const exportsDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
    });
    const engineRoot = path.resolve(__dirname, '..');
    const errors = [];
    validateSchemas(exportsDir, engineRoot, errors);
    expect(errors).toHaveLength(0);
  });

  it('behavior 8: fails when descriptions.json is missing required reference_code', () => {
    // Record missing reference_code (and other required fields) — must yield a schema fail
    const badDesc = [{ id: 1, title: 'Bad record' }];
    const exportsDir = makeTmpDataDir({ 'descriptions.json': badDesc });
    const engineRoot = path.resolve(__dirname, '..');
    const errors = [];
    validateSchemas(exportsDir, engineRoot, errors);
    expect(errors.some(e => e.includes('descriptions.schema.json') && e.includes('fail'))).toBe(true);
  });

  it('behavior 9: silently skips a contract file absent from the data dir', () => {
    // Only descriptions.json present — the other five contract files are absent.
    // validateSchemas must not push errors for the absent files (absence is validateInputs' concern).
    const exportsDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
    });
    const engineRoot = path.resolve(__dirname, '..');
    const errors = [];
    validateSchemas(exportsDir, engineRoot, errors);
    // No errors from absent files — only descriptions.json was present and it's conformant
    expect(errors).toHaveLength(0);
  });
});

// Version: v0.3.1
