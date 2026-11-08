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
 * Behaviors covered:
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
 *  11. Older spellings of the corporate entity type — a warning naming
 *      `corporate`, never an error.
 *
 *  12. Codes the vocabulary does not define — one warning per distinct
 *      code absent from vocabulary.json (or, without the file, from the
 *      bundled vocabulary), compared untrimmed, roles in lowercase and
 *      types as written, as vocab.html compares them, with its file,
 *      record count and how the pages show it; the result and the exit
 *      status of `zasqua validate` are unchanged.
 *
 *  13. Former codes that are also live codes — one warning per clash in
 *      descriptions, entities and places, naming the code and the record
 *      that lists it; a code listed twice by one record is reported once;
 *      no warning when the former codes are free; never an error.
 *
 * All fixtures are written to os.tmpdir() — no real corpus data needed.
 *
 * @version v1.6.0
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { validateManifest, validateInputs, validateSchemas, runValidate } = require('../lib/validator.js');

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
  it('returns an error when title is a number instead of a string', () => {
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
    const badDesc = makeDesc({ title: 42 });
    const dataDir = makeTmpDataDir({
      'descriptions.json': [badDesc],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    const combined = errors.join(' ');
    expect(combined).toMatch(/key 'title'/);
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

// ---------------------------------------------------------------------------
// Record ids: integers (Django-era exports) and strings (Fisqua exports) both
// pass the key pre-pass; any other type is still rejected.
// ---------------------------------------------------------------------------

describe('validateInputs — id may be an integer or a string', () => {
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
  const desc = (id) => ({
    id,
    reference_code: 'co-ahrb-aht-001',
    title: 'Fondo',
    description_level: 'fonds',
    parent_reference_code: null,
    repository_code: 'ahrb',
  });

  it('accepts a UUID string id on descriptions and repositories', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [desc('5c1a1c9e-2a6b-4d0f-9b3e-0c3f0a1b2c3d')],
      'repositories.json': [makeRepo({ id: 'e2c2f4a0-1111-4222-8333-444455556666' })],
    });
    const errors = validateInputs(manifest, dataDir).filter((e) => /key 'id'/.test(e));
    expect(errors).toEqual([]);
  });

  it('still accepts an integer id', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [desc(42)],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir).filter((e) => /key 'id'/.test(e));
    expect(errors).toEqual([]);
  });

  it('rejects a boolean id with the expected-type message', () => {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [desc(true)],
      'repositories.json': [makeRepo()],
    });
    const errors = validateInputs(manifest, dataDir);
    expect(errors.join(' ')).toMatch(/wrong type for key 'id' at record 0: expected number\|string, got boolean/);
  });
});

describe('validateInputs — older spellings of the corporate entity type', () => {
  const manifest = { modules: { entities: true } };

  function run(entities) {
    const dataDir = makeTmpDataDir({
      'descriptions.json': [makeDesc()],
      'repositories.json': [makeRepo()],
      'entities.json': entities,
      'entity_links.json': [makeEntityLink()],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const errors = validateInputs(manifest, dataDir);
      return { errors, warnings: warn.mock.calls.map((c) => c.join(' ')) };
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  }

  // The bundled vocabulary has no corporateBody, so that spelling also gets
  // an undefined-code warning; these tests count the legacy-spelling lines.
  const legacy = (warnings) => warnings.filter((w) => /should be 'corporate'/.test(w));

  it('warns, without an error, for corporateBody and names corporate', () => {
    const { errors, warnings: all } = run([makeEntity({ entity_code: 'ne-aaaaa', entity_type: 'corporateBody' })]);
    const warnings = legacy(all);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/status=warn/);
    expect(warnings[0]).toMatch(/'corporateBody'/);
    expect(warnings[0]).toMatch(/ne-aaaaa/);
    expect(warnings[0]).toMatch(/should be 'corporate'/);
  });

  it('warns, without an error, for corporate_body', () => {
    const { errors, warnings } = run([makeEntity({ entity_type: 'corporate_body' })]);
    expect(errors).toEqual([]);
    expect(legacy(warnings)).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/'corporate_body'/);
  });

  it('does not warn for corporate, person or family', () => {
    const { errors, warnings } = run([
      makeEntity({ entity_code: 'ne-aaaaa', entity_type: 'corporate' }),
      makeEntity({ entity_code: 'ne-bbbbb', entity_type: 'person' }),
      makeEntity({ entity_code: 'ne-ccccc', entity_type: 'family' }),
    ]);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Codes the vocabulary does not define
// ---------------------------------------------------------------------------

describe('validateInputs — codes the vocabulary does not define', () => {
  const manifest = { modules: { entities: true, places: true } };
  const DATA = {
    'descriptions.json': [makeDesc()],
    'repositories.json': [makeRepo()],
    'entities.json': [
      makeEntity({ entity_code: 'ne-aaaaa', entity_type: 'person' }),
      makeEntity({ entity_code: 'ne-bbbbb', entity_type: 'Family' }),
      makeEntity({ entity_code: 'ne-ccccc', entity_type: 'guild' }),
      makeEntity({ entity_code: 'ne-ddddd', entity_type: 'Guild' }),
    ],
    'entity_links.json': [
      makeEntityLink({ role: 'witness' }),
      makeEntityLink({ role: 'Witness' }),
      makeEntityLink({ role: 'ferryman' }),
    ],
    'places.json': [makePlace({ place_type: 'city' }), makePlace({ place_type: 'hamlet' })],
    'place_links.json': [makePlaceLink({ role: 'origin' }), makePlaceLink({ role: '' })],
  };
  const VOCAB = {
    entity_types: [{ code: 'PERSON', label: { es: 'Persona', en: 'Person' } }, { code: 'guild', label: { es: 'Gremio', en: 'Guild' } }],
    place_types: [{ code: 'hamlet', label: { es: 'Caserío', en: 'Hamlet' } }],
    entity_roles: [{ code: 'witness', label: { es: 'Testigo', en: 'Witness' } }],
    place_roles: [{ code: 'origin', label: { es: 'Origen', en: 'Origin' } }],
  };

  function run(files) {
    const dataDir = makeTmpDataDir(files);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const errors = validateInputs(manifest, dataDir);
      return { errors, warnings: warn.mock.calls.map((c) => c.join(' ')) };
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  }

  it('with vocabulary.json, warns once per distinct code the file lacks; roles ignore case, types do not', () => {
    const { errors, warnings } = run({ ...DATA, 'vocabulary.json': VOCAB });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "validate module=entities status=warn warning=\"entities.json entity_type 'person' (1 record) is not defined in vocabulary.json entity_types; shown with the engine's label\"",
      "validate module=entities status=warn warning=\"entities.json entity_type 'Family' (1 record) is not defined in vocabulary.json entity_types; shown as the code\"",
      "validate module=entities status=warn warning=\"entities.json entity_type 'Guild' (1 record) is not defined in vocabulary.json entity_types; shown as the code\"",
      "validate module=places status=warn warning=\"places.json place_type 'city' (1 record) is not defined in vocabulary.json place_types; shown with the engine's label\"",
      "validate module=entity_links status=warn warning=\"entity_links.json role 'ferryman' (1 record) is not defined in vocabulary.json entity_roles; shown as the code\"",
    ]);
  });

  it('reports Family as undefined and shown as the code when the vocabulary defines family', () => {
    const { errors, warnings } = run({
      ...DATA,
      'entities.json': [makeEntity({ entity_type: 'Family' })],
      'vocabulary.json': { ...VOCAB, entity_types: [{ code: 'family', label: { es: 'Familia', en: 'Family' } }] },
    });
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => /entities\.json/.test(w))).toEqual([
      "validate module=entities status=warn warning=\"entities.json entity_type 'Family' (1 record) is not defined in vocabulary.json entity_types; shown as the code\"",
    ]);
  });

  it('compares codes untrimmed on both sides, as the pages do', () => {
    const { errors, warnings } = run({
      ...DATA,
      'entities.json': [makeEntity({ entity_type: ' person ' }), makeEntity({ entity_type: 'family' })],
      'entity_links.json': [makeEntityLink({ role: ' Witness' })],
      'vocabulary.json': { ...VOCAB, entity_types: [{ code: ' family ', label: { en: 'Family' } }, { code: ' person ', label: { en: 'Person' } }] },
    });
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => /entit(ies|y_links)\.json/.test(w))).toEqual([
      "validate module=entities status=warn warning=\"entities.json entity_type 'family' (1 record) is not defined in vocabulary.json entity_types; shown with the engine's label\"",
      "validate module=entity_links status=warn warning=\"entity_links.json role ' Witness' (1 record) is not defined in vocabulary.json entity_roles; shown as the code\"",
    ]);
    const bundledOnly = run({ ...DATA, 'entities.json': [makeEntity({ entity_type: ' person ' })] });
    expect(bundledOnly.warnings.filter((w) => /entities\.json/.test(w))).toEqual([
      "validate module=entities status=warn warning=\"entities.json entity_type ' person ' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
    ]);
  });

  it('without vocabulary.json, warns only for codes the bundled vocabulary lacks', () => {
    const { errors, warnings } = run(DATA);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "validate module=entities status=warn warning=\"entities.json entity_type 'Family' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
      "validate module=entities status=warn warning=\"entities.json entity_type 'guild' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
      "validate module=entities status=warn warning=\"entities.json entity_type 'Guild' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
      "validate module=places status=warn warning=\"places.json place_type 'hamlet' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
      "validate module=entity_links status=warn warning=\"entity_links.json role 'ferryman' (1 record) is not defined in the engine's bundled vocabulary; shown as the code\"",
    ]);
  });

  it('checks only the files of enabled modules', () => {
    const dataDir = makeTmpDataDir(DATA);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      validateInputs({ modules: {} }, dataDir);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('never changes the result or the exit status', () => {
    const exportsDir = makeTmpDataDir(DATA);
    const instance = path.dirname(exportsDir);
    fs.writeFileSync(
      path.join(instance, 'zasqua.manifest.toml'),
      '[ui]\nlanguage = "en-US"\n\n[modules]\nentities = true\nplaces = true\n',
      'utf8'
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(runValidate({ instanceRoot: instance })).toEqual([]);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'validator.js');
    const cli = spawnSync('node', [script], {
      env: { ...process.env, INSTANCE_ROOT: instance, DATA_DIR: '' },
      encoding: 'utf8',
    });
    expect(cli.stderr).toContain("role 'ferryman' (1 record)");
    expect(cli.stdout).toContain('[validate] All checks passed.');
    expect(cli.status).toBe(0);
  });
});


describe('validateInputs — former codes that are also live codes', () => {
  const manifest = { modules: { entities: true, places: true } };
  const BASE = {
    'descriptions.json': [makeDesc()],
    'repositories.json': [makeRepo()],
    'entities.json': [makeEntity()],
    'entity_links.json': [makeEntityLink()],
    'places.json': [makePlace()],
    'place_links.json': [makePlaceLink()],
  };

  function run(files, m = manifest) {
    const dataDir = makeTmpDataDir({ ...BASE, ...files });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const errors = validateInputs(m, dataDir);
      return { errors, warnings: warn.mock.calls.map((c) => c.join(' ')).filter((w) => /former/.test(w)) };
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  }

  it('is silent when no former code is a live code', () => {
    const { errors, warnings } = run({
      'descriptions.json': [makeDesc({ former_reference_codes: ['co-ahrb-old'] })],
      'entities.json': [makeEntity({ former_codes: ['ne-old01'] })],
      'places.json': [makePlace({ former_codes: ['nl-old01'] })],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('warns once per clash in each file, and never adds an error', () => {
    const { errors, warnings } = run({
      'descriptions.json': [
        makeDesc({ reference_code: 'co-ahrb-001', former_reference_codes: ['co-ahrb-002', 'co-ahrb-002'] }),
        makeDesc({ id: 2, reference_code: 'co-ahrb-002' }),
      ],
      'entities.json': [
        makeEntity({ entity_code: 'ne-aaaaa', former_codes: ['ne-aaaaa'] }),
      ],
      'places.json': [
        makePlace({ place_code: 'nl-aaaaa', former_codes: ['nl-bbbbb', '', 7] }),
        makePlace({ id: 2, place_code: 'nl-bbbbb' }),
      ],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "validate module=descriptions status=warn warning=\"descriptions.json former_reference_codes 'co-ahrb-002' of 'co-ahrb-001' is the reference_code of another record; that address shows the other record, not a redirect\"",
      "validate module=entities status=warn warning=\"entities.json former_codes 'ne-aaaaa' of 'ne-aaaaa' is its own entity_code\"",
      "validate module=places status=warn warning=\"places.json former_codes 'nl-bbbbb' of 'nl-aaaaa' is the place_code of another record; that address shows the other record, not a redirect\"",
    ]);
  });

  it('checks entities and places only when their modules are enabled', () => {
    const { warnings } = run(
      { 'entities.json': [makeEntity({ former_codes: ['ne-abc12'] })] },
      { modules: {} }
    );
    expect(warnings).toEqual([]);
  });
});

// Version: v1.6.0
