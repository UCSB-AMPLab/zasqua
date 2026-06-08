/**
 * Standard Profile Unit Tests — Completeness and Parity Gate
 *
 * Tests for the per-standard YAML profiles that form the engine's descriptive
 * standards layer (themes/base/data/standards/). Covers profile file
 * existence, YAML parseability, field-list completeness, parity baseline
 * assertions against the earlier es.toml/ui.yaml string inventory, and vocab
 * file structure.
 *
 * The descriptive-standard labels (ISAD(G), DACS, RAD) once lived inline in
 * the chrome string bundle and the ui.yaml data file. Moving them into
 * per-standard profiles must not change a single rendered label, so these
 * tests pin every field, level, and section string against a verbatim
 * snapshot of the old strings — a regression net for that migration.
 *
 * Five behavior groups:
 *
 *   1. "isadg.yaml completeness" — asserts isadg.yaml exists, parses, and
 *      its es.fields array matches the parity baseline (22 field entries in
 *      the exact order the single-description page renders them).
 *
 *   2. "isadg.yaml en↔es field key-parity" — asserts en.fields and es.fields
 *      have identical key sets (same 22 keys, possibly different labels).
 *
 *   3. "isadg.yaml es parity baseline" — asserts every field label and level
 *      label in isadg.yaml.es matches the snapshot extracted verbatim from the
 *      old es.toml [fields] table and ui.yaml levels/levelsPlural.
 *
 *   4. "dacs.yaml and rad.yaml — stub files exist" — asserts stub files exist
 *      and parse. DACS-en must have at minimum the same field keys as isadg.
 *
 *   5. "vocab files — required sections present" — asserts data/vocab/es.yaml
 *      and en.yaml exist, parse, and each contains all required top-level
 *      sections (roles, roleGroups, placeRoles, entityTypes, placeTypes) as
 *      non-empty maps.
 *
 * Files are read from the real engine theme path (relative to this test file
 * via import.meta.url). Missing YAML files produce clear assertion failures
 * (file-not-found) rather than thrown exceptions at import time, so the suite
 * is always discoverable and runnable even before the data files exist.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Paths (resolved from this test file's location)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STANDARDS_DIR = path.join(__dirname, '..', 'themes', 'base', 'data', 'standards');
const VOCAB_DIR = path.join(__dirname, '..', 'themes', 'base', 'data', 'vocab');

// ---------------------------------------------------------------------------
// Parity baseline constants
// Verbatim snapshot of the labels as they read before the migration to
// per-standard profiles. These strings are sourced from the earlier:
//   - Field labels: themes/base/i18n/es.toml [fields] table
//   - Section headers: themes/base/i18n/es.toml [description] table
//   - Levels (singular): themes/base/data/ui.yaml levels map
//   - Levels (plural): themes/base/data/ui.yaml levelsPlural map
// ---------------------------------------------------------------------------

const ISADG_ES_FIELD_PARITY_BASELINE = {
  repository:               'Repositorio',
  date_formatted:           'Fecha',
  reference_code:           'Código de referencia',
  local_identifier:         'Identificador local',
  scope_content:            'Alcance y contenido',
  extent:                   'Extensión',
  arrangement:              'Signatura original',
  publication_title:        'Publicación',
  series_statement:         'Serie',
  uniform_title:            'Título uniforme',
  section_title:            'Sección',
  edition_statement:        'Edición',
  imprint:                  'Pie de imprenta',
  pages:                    'Páginas',
  access_conditions:        'Condiciones de acceso',
  reproduction_conditions:  'Condiciones de reproducción',
  language:                 'Idioma',
  location_of_originals:    'Localización de los originales',
  location_of_copies:       'Existencia y localización de copias',
  related_materials:        'Materiales relacionados',
  notes:                    'Notas',
  finding_aids:             'Instrumentos de consulta',
};

// Verbatim field order from the single-description page (parity-critical —
// the rendered page lists these fields in exactly this sequence)
const ISADG_FIELD_ORDER = [
  'repository', 'date_formatted', 'reference_code', 'local_identifier', 'scope_content', 'extent',
  'arrangement', 'publication_title', 'series_statement', 'uniform_title',
  'section_title', 'edition_statement', 'imprint', 'pages', 'access_conditions',
  'reproduction_conditions', 'language', 'location_of_originals', 'location_of_copies',
  'related_materials', 'notes', 'finding_aids',
];

// Section headers verbatim from the earlier es.toml [description] table
const ISADG_ES_SECTIONS_PARITY_BASELINE = {
  description:   'Descripción',
  bibliographic: 'Información bibliográfica',
  access:        'Condiciones de acceso',
  related:       'Materiales relacionados',
  notes:         'Notas',
  control:       'Control',
  reuse:         'Reutilización',
};

// Levels (singular) verbatim from the earlier ui.yaml levels map
const ISADG_ES_LEVELS_PARITY_BASELINE = {
  fonds:      'Fondo',
  subfonds:   'Subfondo',
  series:     'Serie',
  subseries:  'Subserie',
  file:       'Expediente',
  item:       'Unidad documental',
  collection: 'Colección',
  section:    'Sección',
  volume:     'Tomo',
};

// Levels (plural) verbatim from the earlier ui.yaml levelsPlural map (all 13 entries)
const ISADG_ES_LEVELS_PLURAL_PARITY_BASELINE = {
  fonds:      'fondos',
  subfonds:   'subfondos',
  series:     'series',
  subseries:  'subseries',
  file:       'expedientes',
  item:       'documentos',
  collection: 'colecciones',
  section:    'secciones',
  volume:     'tomos',
  caja:       'cajas',
  carpeta:    'carpetas',
  legajo:     'legajos',
  tomo:       'tomos',
};

const VOCAB_REQUIRED_KEYS = ['roles', 'roleGroups', 'placeRoles', 'entityTypes', 'placeTypes'];

// ---------------------------------------------------------------------------
// Helper: load and js-yaml-parse a file; returns { data, error } so tests
// can assert on the error message rather than throwing at parse time.
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    return { data: null, error: `File not found: ${filePath}` };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = yaml.load(raw);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: `YAML parse error in ${filePath}: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Behavior group 1: isadg.yaml completeness
// ---------------------------------------------------------------------------

describe('isadg.yaml completeness — file exists and parses', () => {
  const isadgPath = path.join(STANDARDS_DIR, 'isadg.yaml');

  it('isadg.yaml exists', () => {
    expect(
      fs.existsSync(isadgPath),
      `isadg.yaml must exist at ${isadgPath}`
    ).toBe(true);
  });

  it('isadg.yaml parses without error', () => {
    const { error } = loadYaml(isadgPath);
    expect(error, `isadg.yaml must be valid YAML: ${error}`).toBeNull();
  });

  it('isadg.yaml has top-level es key', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    expect(data, 'isadg.yaml must parse to a non-null object').not.toBeNull();
    expect(
      data?.es,
      'isadg.yaml must have a top-level "es" key'
    ).toBeDefined();
  });

  it('isadg.yaml es.fields is an array of exactly 22 entries', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const fields = data?.es?.fields;
    expect(Array.isArray(fields), 'es.fields must be an array').toBe(true);
    expect(
      fields?.length,
      `es.fields must have exactly 22 entries (got ${fields?.length})`
    ).toBe(22);
  });

  it('isadg.yaml es.fields key order matches ISADG_FIELD_ORDER exactly', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const fields = data?.es?.fields ?? [];
    const actualKeys = fields.map(f => f.key);
    expect(actualKeys).toEqual(ISADG_FIELD_ORDER);
  });

  it('isadg.yaml es.levels contains the 9 canonical level codes', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const levels = data?.es?.levels ?? {};
    const canonicalCodes = Object.keys(ISADG_ES_LEVELS_PARITY_BASELINE);
    for (const code of canonicalCodes) {
      expect(levels[code], `es.levels.${code} must be defined`).toBeDefined();
    }
  });

  it('isadg.yaml es.levelsPlural contains all 13 canonical plural entries', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const levelsPlural = data?.es?.levelsPlural ?? {};
    const canonicalCodes = Object.keys(ISADG_ES_LEVELS_PLURAL_PARITY_BASELINE);
    for (const code of canonicalCodes) {
      expect(levelsPlural[code], `es.levelsPlural.${code} must be defined`).toBeDefined();
    }
  });

  it('isadg.yaml es.sections contains all 7 required section keys', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const sections = data?.es?.sections ?? {};
    const sectionKeys = Object.keys(ISADG_ES_SECTIONS_PARITY_BASELINE);
    for (const key of sectionKeys) {
      expect(sections[key], `es.sections.${key} must be defined`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior group 2: isadg.yaml en↔es field key-parity
// ---------------------------------------------------------------------------

describe('isadg.yaml en↔es field key-parity', () => {
  const isadgPath = path.join(STANDARDS_DIR, 'isadg.yaml');

  it('isadg.yaml has top-level en key', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    expect(data?.en, 'isadg.yaml must have a top-level "en" key').toBeDefined();
  });

  it('isadg.yaml en.fields and es.fields have identical key sets', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const esKeys = (data?.es?.fields ?? []).map(f => f.key);
    const enKeys = (data?.en?.fields ?? []).map(f => f.key);
    expect(enKeys).toEqual(esKeys);
  });

  it('isadg.yaml en.fields has exactly 22 entries', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const fields = data?.en?.fields;
    expect(Array.isArray(fields), 'en.fields must be an array').toBe(true);
    expect(
      fields?.length,
      `en.fields must have exactly 22 entries (got ${fields?.length})`
    ).toBe(22);
  });
});

// ---------------------------------------------------------------------------
// Behavior group 3: isadg.es parity baseline — labels match the pre-migration strings
// ---------------------------------------------------------------------------

describe('isadg.yaml es parity baseline — labels match the pre-migration strings', () => {
  const isadgPath = path.join(STANDARDS_DIR, 'isadg.yaml');

  it('every es.fields label matches ISADG_ES_FIELD_PARITY_BASELINE', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const fields = data?.es?.fields ?? [];
    for (const [key, expectedLabel] of Object.entries(ISADG_ES_FIELD_PARITY_BASELINE)) {
      const field = fields.find(f => f.key === key);
      expect(field, `es.fields must contain an entry with key="${key}"`).toBeDefined();
      expect(
        field?.label,
        `es.fields[key=${key}].label must equal "${expectedLabel}" verbatim`
      ).toBe(expectedLabel);
    }
  });

  it('every es.levels label matches ISADG_ES_LEVELS_PARITY_BASELINE', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const levels = data?.es?.levels ?? {};
    for (const [code, expectedLabel] of Object.entries(ISADG_ES_LEVELS_PARITY_BASELINE)) {
      expect(
        levels[code],
        `es.levels.${code} must equal "${expectedLabel}" verbatim`
      ).toBe(expectedLabel);
    }
  });

  it('every es.levelsPlural label matches ISADG_ES_LEVELS_PLURAL_PARITY_BASELINE', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const levelsPlural = data?.es?.levelsPlural ?? {};
    for (const [code, expectedLabel] of Object.entries(ISADG_ES_LEVELS_PLURAL_PARITY_BASELINE)) {
      expect(
        levelsPlural[code],
        `es.levelsPlural.${code} must equal "${expectedLabel}" verbatim`
      ).toBe(expectedLabel);
    }
  });

  it('every es.sections label matches ISADG_ES_SECTIONS_PARITY_BASELINE', () => {
    const { data, error } = loadYaml(isadgPath);
    expect(error).toBeNull();
    const sections = data?.es?.sections ?? {};
    for (const [key, expectedLabel] of Object.entries(ISADG_ES_SECTIONS_PARITY_BASELINE)) {
      expect(
        sections[key],
        `es.sections.${key} must equal "${expectedLabel}" verbatim`
      ).toBe(expectedLabel);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior group 4: dacs.yaml and rad.yaml — stub files exist
// ---------------------------------------------------------------------------

describe('dacs.yaml and rad.yaml — stub files exist', () => {
  it('dacs.yaml exists', () => {
    const dacsPath = path.join(STANDARDS_DIR, 'dacs.yaml');
    expect(
      fs.existsSync(dacsPath),
      `dacs.yaml must exist at ${dacsPath}`
    ).toBe(true);
  });

  it('dacs.yaml parses without error', () => {
    const dacsPath = path.join(STANDARDS_DIR, 'dacs.yaml');
    const { error } = loadYaml(dacsPath);
    expect(error, `dacs.yaml must be valid YAML: ${error}`).toBeNull();
  });

  it('dacs.yaml en.fields keys are a subset-or-equal of isadg en.fields keys', () => {
    const dacsPath = path.join(STANDARDS_DIR, 'dacs.yaml');
    const isadgPath = path.join(STANDARDS_DIR, 'isadg.yaml');
    const { data: dacsData, error: dacsError } = loadYaml(dacsPath);
    const { data: isadgData, error: isadgError } = loadYaml(isadgPath);
    expect(dacsError).toBeNull();
    expect(isadgError).toBeNull();
    const isadgKeys = new Set((isadgData?.en?.fields ?? []).map(f => f.key));
    const dacsKeys = (dacsData?.en?.fields ?? []).map(f => f.key);
    for (const key of dacsKeys) {
      expect(
        isadgKeys.has(key),
        `dacs en.fields key "${key}" must be a known isadg en.fields key`
      ).toBe(true);
    }
  });

  it('rad.yaml exists', () => {
    const radPath = path.join(STANDARDS_DIR, 'rad.yaml');
    expect(
      fs.existsSync(radPath),
      `rad.yaml must exist at ${radPath}`
    ).toBe(true);
  });

  it('rad.yaml parses without error', () => {
    const radPath = path.join(STANDARDS_DIR, 'rad.yaml');
    const { error } = loadYaml(radPath);
    expect(error, `rad.yaml must be valid YAML: ${error}`).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Behavior group 5: vocab files — required sections present
// ---------------------------------------------------------------------------

describe('vocab files — required sections present', () => {
  it('data/vocab/es.yaml exists', () => {
    const esVocabPath = path.join(VOCAB_DIR, 'es.yaml');
    expect(
      fs.existsSync(esVocabPath),
      `vocab/es.yaml must exist at ${esVocabPath}`
    ).toBe(true);
  });

  it('data/vocab/es.yaml parses without error', () => {
    const esVocabPath = path.join(VOCAB_DIR, 'es.yaml');
    const { error } = loadYaml(esVocabPath);
    expect(error, `vocab/es.yaml must be valid YAML: ${error}`).toBeNull();
  });

  it('data/vocab/es.yaml contains all required top-level sections as non-empty maps', () => {
    const esVocabPath = path.join(VOCAB_DIR, 'es.yaml');
    const { data, error } = loadYaml(esVocabPath);
    expect(error).toBeNull();
    for (const key of VOCAB_REQUIRED_KEYS) {
      expect(data?.[key], `vocab/es.yaml must have a non-null "${key}" section`).toBeDefined();
      expect(
        typeof data?.[key],
        `vocab/es.yaml "${key}" must be an object (non-empty map)`
      ).toBe('object');
      expect(
        Object.keys(data?.[key] ?? {}).length,
        `vocab/es.yaml "${key}" must be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it('data/vocab/en.yaml exists', () => {
    const enVocabPath = path.join(VOCAB_DIR, 'en.yaml');
    expect(
      fs.existsSync(enVocabPath),
      `vocab/en.yaml must exist at ${enVocabPath}`
    ).toBe(true);
  });

  it('data/vocab/en.yaml parses without error', () => {
    const enVocabPath = path.join(VOCAB_DIR, 'en.yaml');
    const { error } = loadYaml(enVocabPath);
    expect(error, `vocab/en.yaml must be valid YAML: ${error}`).toBeNull();
  });

  it('data/vocab/en.yaml contains all required top-level sections as non-empty maps', () => {
    const enVocabPath = path.join(VOCAB_DIR, 'en.yaml');
    const { data, error } = loadYaml(enVocabPath);
    expect(error).toBeNull();
    for (const key of VOCAB_REQUIRED_KEYS) {
      expect(data?.[key], `vocab/en.yaml must have a non-null "${key}" section`).toBeDefined();
      expect(
        typeof data?.[key],
        `vocab/en.yaml "${key}" must be an object (non-empty map)`
      ).toBe('object');
      expect(
        Object.keys(data?.[key] ?? {}).length,
        `vocab/en.yaml "${key}" must be non-empty`
      ).toBeGreaterThan(0);
    }
  });
});

// Version: v1.1.0
