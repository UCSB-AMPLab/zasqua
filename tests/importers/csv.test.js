/**
 * CSV Import Adapter — Conformance Fixture Tests
 *
 * Exercises `run` from `lib/importers/csv.js` against two fixtures:
 *
 *   1. csv-import golden fixture: a realistic archivist dataset with
 *      descriptions, repositories, entities, places, and link sheets. Asserts
 *      six-file output, validateInputs passes, and deep equality against
 *      expected/ output.
 *
 *   2. injection fixture: malicious CSV cells with cross-site-scripting
 *      vectors. Asserts output deep-equals injection/expected/descriptions.json
 *      — every vector stripped, {{ / {% syntax preserved intact.
 *
 * Five behaviors covered:
 *
 *   1. run() on csv-import fixture writes six files to stagingDir.
 *   2. validateInputs(manifest, stagingDir) returns zero errors.
 *   3. Output deep-equals expected/ fixture files (golden-file lock).
 *   4. run() on injection fixture produces output deep-equal to injection/expected/.
 *   5. Unrecognised column headers emit a warning to process.stderr (not a
 *      silent pass).
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { validateInputs } = require('../../lib/validator.js');
const { run: runCsvImport } = require('../../lib/importers/csv.js');

const FIXTURE_DIR   = path.join(__dirname, '../fixtures/csv-import');
const EXPECTED_DIR  = path.join(FIXTURE_DIR, 'expected');

const INJECTION_DIR      = path.join(__dirname, '../fixtures/injection');
const INJECTION_EXPECTED = path.join(INJECTION_DIR, 'expected');

// ---------------------------------------------------------------------------
// Helper: create a fresh tmp staging dir per test
// ---------------------------------------------------------------------------

function makeStagingDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-csv-test-'));
}

// ---------------------------------------------------------------------------
// csv-import golden fixture — conformance + deep-equal assertions
// ---------------------------------------------------------------------------

describe('csv adapter — csv-import golden fixture', () => {
  it('writes six JSON files to stagingDir', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const expected = [
      'descriptions.json',
      'repositories.json',
      'entities.json',
      'entity_links.json',
      'places.json',
      'place_links.json',
    ];
    for (const file of expected) {
      expect(fs.existsSync(path.join(stagingDir, file)),
        `${file} should exist in stagingDir`).toBe(true);
    }
  });

  it('validateInputs returns zero errors (entities + places enabled)', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const manifest = { modules: { entities: true, places: true } };
    const errors = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });

  it('output deep-equals expected/descriptions.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'descriptions.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'descriptions.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('output deep-equals expected/repositories.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'repositories.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'repositories.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('output deep-equals expected/entities.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'entities.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'entities.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('output deep-equals expected/entity_links.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'entity_links.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'entity_links.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('output deep-equals expected/places.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'places.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'places.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('output deep-equals expected/place_links.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'place_links.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, 'place_links.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('descriptions carry auto-generated integer id starting at 1', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: FIXTURE_DIR, stagingDir, standard: 'isadg' });

    const descs = JSON.parse(fs.readFileSync(path.join(stagingDir, 'descriptions.json'), 'utf8'));
    descs.forEach((rec, i) => {
      expect(typeof rec.id).toBe('number');
      expect(rec.id).toBe(i + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// injection fixture round-trip
// ---------------------------------------------------------------------------

describe('csv adapter — injection fixture round-trip', () => {
  it('produces output deep-equal to injection/expected/descriptions.json', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: INJECTION_DIR, stagingDir, standard: 'isadg' });

    const actual   = JSON.parse(fs.readFileSync(path.join(stagingDir, 'descriptions.json'), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(INJECTION_EXPECTED, 'descriptions.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });

  it('injection fixture passes validateInputs (Core-only)', async () => {
    const stagingDir = makeStagingDir();
    await runCsvImport({ src: INJECTION_DIR, stagingDir, standard: 'isadg' });

    const manifest = { modules: { entities: false, places: false } };
    const errors = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Security: @file: path restriction — block reads outside the source dir
// ---------------------------------------------------------------------------

describe('csv adapter — @file: path restrictions', () => {
  it('rejects absolute @file: paths (leading /)', async () => {
    const stagingDir = makeStagingDir();
    // Write a CSV with an absolute @file: path to a tmp dir
    const tmpCsvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-csv-sec-'));
    fs.writeFileSync(path.join(tmpCsvDir, 'descriptions.csv'),
      'reference_code,title,description_level,parent_reference_code,repository_code,ocr_text\n' +
      'co-sec-001,Test Fonds,fonds,,co-sec,@file:/etc/passwd\n'
    );
    fs.writeFileSync(path.join(tmpCsvDir, 'repositories.csv'),
      'id,code,name\n1,co-sec,Security Test Archive\n'
    );

    await expect(
      runCsvImport({ src: tmpCsvDir, stagingDir, standard: 'isadg' })
    ).rejects.toThrow(/absolute/i);
  });

  it('rejects @file: paths containing ..', async () => {
    const stagingDir = makeStagingDir();
    const tmpCsvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-csv-sec2-'));
    fs.writeFileSync(path.join(tmpCsvDir, 'descriptions.csv'),
      'reference_code,title,description_level,parent_reference_code,repository_code,ocr_text\n' +
      'co-sec-001,Test Fonds,fonds,,co-sec,@file:../../etc/passwd\n'
    );
    fs.writeFileSync(path.join(tmpCsvDir, 'repositories.csv'),
      'id,code,name\n1,co-sec,Security Test Archive\n'
    );

    await expect(
      runCsvImport({ src: tmpCsvDir, stagingDir, standard: 'isadg' })
    ).rejects.toThrow(/\.\./);
  });
});

// ---------------------------------------------------------------------------
// Warning on unrecognised column headers
// ---------------------------------------------------------------------------

describe('csv adapter — unrecognised column header warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a warning to stderr for unknown column names', async () => {
    const stagingDir = makeStagingDir();
    const tmpCsvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-csv-hdr-'));
    // "Titulo" is a friendly label, not a canonical contract field name
    fs.writeFileSync(path.join(tmpCsvDir, 'descriptions.csv'),
      'reference_code,Titulo,description_level,parent_reference_code,repository_code\n' +
      'co-hdr-001,Test,fonds,,co-hdr\n'
    );
    fs.writeFileSync(path.join(tmpCsvDir, 'repositories.csv'),
      'id,code,name\n1,co-hdr,Header Test Archive\n'
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write');
    await runCsvImport({ src: tmpCsvDir, stagingDir, standard: 'isadg' }).catch(() => {});
    const warned = stderrSpy.mock.calls.some(
      args => typeof args[0] === 'string' && args[0].toLowerCase().includes('titulo')
    );
    expect(warned).toBe(true);
  });
});

// Version: v0.1.0
