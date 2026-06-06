/**
 * CollectiveAccess Import Adapter — Conformance Fixture Tests
 *
 * Exercises `run` from `lib/importers/collectiveaccess.js` against the
 * CollectiveAccess web-services JSON fixture at:
 *   tests/fixtures/collectiveaccess/fixture.json
 *
 * Seven behaviors covered:
 *
 *   1. run() writes all six contract files to stagingDir.
 *   2. validateInputs returns [] (zero errors) against the staging output.
 *   3. All six output files deep-equal their counterparts in expected/.
 *   4. places.json has numeric latitude/longitude (not the raw georeference
 *      string), confirming the georeference string is split into coordinates.
 *   5. collectiveaccess.js exports a `run` function.
 *   6. Text fields are sanitized (scope_content HTML tags stripped,
 *      block closers converted to newlines).
 *   7. Descriptions carry auto-generated integer id fields — the source
 *      records use opaque CollectiveAccess ids, so the adapter assigns its own
 *      sequential ids.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { validateInputs } = require('../../lib/validator.js');
const { run: runCaImport } = require('../../lib/importers/collectiveaccess.js');

const FIXTURE_DIR  = path.join(__dirname, '../fixtures/collectiveaccess');
const FIXTURE_SRC  = path.join(FIXTURE_DIR, 'fixture.json');
const EXPECTED_DIR = path.join(FIXTURE_DIR, 'expected');

const CONTRACT_FILES = [
  'descriptions.json', 'repositories.json', 'entities.json',
  'entity_links.json', 'places.json', 'place_links.json',
];

// ---------------------------------------------------------------------------
// Helper: create a fresh tmp staging dir per test
// ---------------------------------------------------------------------------

function makeStagingDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zasqua-ca-${prefix}-`));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Behavior 1: run() writes all six contract files
// ---------------------------------------------------------------------------

describe('ca adapter — six-file output', () => {
  it('run() writes all six contract files to stagingDir', async () => {
    const stagingDir = makeStagingDir('six');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    for (const f of CONTRACT_FILES) {
      expect(
        fs.existsSync(path.join(stagingDir, f)),
        `Expected ${f} to exist in stagingDir`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: validateInputs returns [] (conformance gate)
// ---------------------------------------------------------------------------

describe('ca adapter — validateInputs conformance', () => {
  it('validateInputs returns [] against the staging output', async () => {
    const stagingDir = makeStagingDir('validate');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const manifest = {
      modules: { entities: true, places: true },
    };
    const errors = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: deep-equals expected/ output
// ---------------------------------------------------------------------------

describe('ca adapter — deep-equals expected output', () => {
  it('descriptions.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-desc');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'descriptions.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'descriptions.json'));
    expect(actual).toEqual(expected);
  });

  it('repositories.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-repo');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'repositories.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'repositories.json'));
    expect(actual).toEqual(expected);
  });

  it('entities.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-ent');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'entities.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'entities.json'));
    expect(actual).toEqual(expected);
  });

  it('entity_links.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-elink');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'entity_links.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'entity_links.json'));
    expect(actual).toEqual(expected);
  });

  it('places.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-pl');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'places.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'places.json'));
    expect(actual).toEqual(expected);
  });

  it('place_links.json deep-equals expected', async () => {
    const stagingDir = makeStagingDir('eq-plink');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const actual   = readJson(path.join(stagingDir, 'place_links.json'));
    const expected = readJson(path.join(EXPECTED_DIR, 'place_links.json'));
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: place latitude/longitude are numeric
// ---------------------------------------------------------------------------

describe('ca adapter — georeference split', () => {
  it('places carry numeric latitude and longitude (not raw georeference string)', async () => {
    const stagingDir = makeStagingDir('geo');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const places = readJson(path.join(stagingDir, 'places.json'));
    // At least one place must carry georeference coordinates
    const withCoords = places.filter(
      p => p.latitude !== null && p.longitude !== null
    );
    expect(withCoords.length).toBeGreaterThan(0);

    // All coordinates that are present must be numbers, not strings
    for (const p of withCoords) {
      expect(typeof p.latitude).toBe('number');
      expect(typeof p.longitude).toBe('number');
    }
  });

  it('both places in the fixture have numeric coordinates', async () => {
    const stagingDir = makeStagingDir('geo2');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const places = readJson(path.join(stagingDir, 'places.json'));
    expect(places).toHaveLength(2);
    for (const p of places) {
      expect(typeof p.latitude).toBe('number');
      expect(typeof p.longitude).toBe('number');
    }
  });

  it('malformed georeference produces null latitude/longitude', async () => {
    // Create a temp fixture with a malformed georeference
    const tmpDir = makeStagingDir('geo-bad');
    const badFixture = [
      {
        ca_object_id: 9999,
        idno: 'test-001',
        preferred_labels: [{ name: 'Test', locale: 'es_CO' }],
        type: 'file',
        ca_objects_x_collections: [],
        repository: { code: 'test', name: 'Test Repo' },
        date_expression: '',
        date_start: '',
        scope_and_content: '',
        extent_and_medium: '',
        arrangement: '',
        access_conditions: '',
        reproduction_conditions: '',
        language: '',
        location_of_originals: '',
        location_of_copies: '',
        related_materials: '',
        finding_aids: '',
        notes: '',
        ca_entities: [],
        ca_places: [
          {
            place_id: 999,
            name: 'Unknown',
            type: 'city',
            georeference: 'not a coord',
            relationship_typename: 'place_of_creation',
          },
        ],
        ca_object_representations: [],
      },
    ];
    const badFixturePath = path.join(tmpDir, 'bad-fixture.json');
    fs.writeFileSync(badFixturePath, JSON.stringify(badFixture), 'utf8');

    const stagingDir2 = makeStagingDir('geo-bad-out');
    await runCaImport({ src: badFixturePath, stagingDir: stagingDir2, standard: 'isadg' });
    const places = readJson(path.join(stagingDir2, 'places.json'));
    expect(places[0].latitude).toBeNull();
    expect(places[0].longitude).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 + 6: module exports + sanitizeField call
// ---------------------------------------------------------------------------

describe('ca adapter — module contract', () => {
  it('collectiveaccess.js exports a run function', () => {
    const mod = require('../../lib/importers/collectiveaccess.js');
    expect(typeof mod.run).toBe('function');
  });

  it('HTML in scope_and_content is sanitized (block closers → newlines, tags stripped)', async () => {
    const stagingDir = makeStagingDir('sanitize');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    // The fonds record has two <p> paragraphs in scope_and_content
    const fonds = descriptions.find(d => d.description_level === 'fonds');
    expect(fonds).toBeDefined();
    // No HTML tags should remain
    expect(fonds.scope_content).not.toMatch(/<[^>]+>/);
    // Block closer </p> should have been converted to \n
    expect(fonds.scope_content).toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// Behavior 7: auto-generated integer id fields
// ---------------------------------------------------------------------------

describe('ca adapter — auto-generated integer ids', () => {
  it('all description records carry a numeric id', async () => {
    const stagingDir = makeStagingDir('ids');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    for (const d of descriptions) {
      expect(typeof d.id).toBe('number');
    }
  });

  it('description ids are sequential starting from 1', async () => {
    const stagingDir = makeStagingDir('ids2');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    const ids = descriptions.map(d => d.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('all place records carry a numeric id', async () => {
    const stagingDir = makeStagingDir('place-ids');
    await runCaImport({ src: FIXTURE_SRC, stagingDir, standard: 'isadg' });

    const places = readJson(path.join(stagingDir, 'places.json'));
    for (const p of places) {
      expect(typeof p.id).toBe('number');
    }
  });
});

// Version: v0.1.0
