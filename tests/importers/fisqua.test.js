/**
 * Fisqua Import Adapter — Round-Trip Losslessness Tests
 *
 * Exercises `run` from `lib/importers/fisqua.js` against the Fisqua-shaped
 * golden fixture at:
 *   tests/fixtures/fisqua-golden/
 *
 * Fisqua (the companion cataloguing application) already emits the six-file
 * contract, so its adapter is a pure passthrough — it must copy every field
 * untouched rather than re-deriving anything.
 *
 * Three behaviors covered:
 *
 *   1. Conformance gate: run() into a tmp staging dir; validateInputs
 *      with the full-module manifest (entities + places enabled) returns
 *      [] (zero errors).
 *
 *   2. Round-trip losslessness: for EACH of the six contract files, the
 *      staging output deep-equals the golden fixture input (toEqual). This
 *      assertion fails if the passthrough drops, renames, or transforms any
 *      field.
 *
 *   3. ocr_text {{ / {% byte-preservation: an ocr_text value containing
 *      literal {{ and {% is byte-equal after passthrough. The passthrough
 *      must NOT apply the sanitiser to Fisqua output, since that data is
 *      already trusted and the curly-brace sequences are real transcription
 *      content, not template syntax.
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
const { loadManifest }   = require('../../lib/manifest.js');
const { run: runFisqua } = require('../../lib/importers/fisqua.js');

const FIXTURE_DIR = path.join(__dirname, '../fixtures/fisqua-golden');

const CONTRACT_FILES = [
  'descriptions.json',
  'repositories.json',
  'entities.json',
  'entity_links.json',
  'places.json',
  'place_links.json',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStagingDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zasqua-fisqua-${prefix}-`));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Behavior 1: conformance gate — validateInputs returns [] (full manifest)
// ---------------------------------------------------------------------------

describe('fisqua adapter — validateInputs conformance', () => {
  it('validateInputs returns [] against the staging output (all modules enabled)', async () => {
    const stagingDir = makeStagingDir('validate');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    // Load the full-module manifest from the golden fixture itself
    const manifest = loadManifest(FIXTURE_DIR);
    const errors   = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: round-trip — every field deep-equals golden fixture
// ---------------------------------------------------------------------------

describe('fisqua adapter — round-trip losslessness', () => {
  it('descriptions.json: no field dropped through the passthrough', async () => {
    const stagingDir = makeStagingDir('rt-desc');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'descriptions.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'descriptions.json'));
    expect(actual).toEqual(expected);
  });

  it('repositories.json: no field dropped through the passthrough', async () => {
    const stagingDir = makeStagingDir('rt-repo');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'repositories.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'repositories.json'));
    expect(actual).toEqual(expected);
  });

  it('entities.json: no field dropped through the passthrough', async () => {
    const stagingDir = makeStagingDir('rt-ent');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'entities.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'entities.json'));
    expect(actual).toEqual(expected);
  });

  it('entity_links.json: no field dropped through the passthrough', async () => {
    const stagingDir = makeStagingDir('rt-elink');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'entity_links.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'entity_links.json'));
    expect(actual).toEqual(expected);
  });

  it('places.json: no field dropped — coordinates survive', async () => {
    const stagingDir = makeStagingDir('rt-pl');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'places.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'places.json'));
    expect(actual).toEqual(expected);

    // Explicit coordinate survival check
    for (const place of actual) {
      if (place.latitude !== null) {
        expect(typeof place.latitude).toBe('number');
        expect(typeof place.longitude).toBe('number');
      }
    }
  });

  it('place_links.json: no field dropped through the passthrough', async () => {
    const stagingDir = makeStagingDir('rt-plink');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const actual   = readJson(path.join(stagingDir, 'place_links.json'));
    const expected = readJson(path.join(FIXTURE_DIR, 'place_links.json'));
    expect(actual).toEqual(expected);
  });

  it('all six contract files: collective deep-equality (no field dropped anywhere)', async () => {
    const stagingDir = makeStagingDir('rt-all');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    for (const file of CONTRACT_FILES) {
      const actual   = readJson(path.join(stagingDir, file));
      const expected = readJson(path.join(FIXTURE_DIR, file));
      expect(actual, `${file} must deep-equal the golden fixture`).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: ocr_text {{ / {% byte-preservation
// ---------------------------------------------------------------------------

describe('fisqua adapter — ocr_text {{ and {% preserved', () => {
  it('ocr_text containing {{ is byte-equal after passthrough (no sanitiser applied)', async () => {
    const stagingDir = makeStagingDir('ocr-curly');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    const golden       = readJson(path.join(FIXTURE_DIR, 'descriptions.json'));

    // Find a record with {{ in ocr_text
    const withCurly = golden.filter(r => r.ocr_text && r.ocr_text.includes('{{'));
    expect(withCurly.length, 'golden fixture must have at least one ocr_text with {{').toBeGreaterThan(0);

    for (const goldenRecord of withCurly) {
      const actual = descriptions.find(d => d.reference_code === goldenRecord.reference_code);
      expect(actual, `record ${goldenRecord.reference_code} must exist in staging`).toBeDefined();
      // Byte-equal: the exact string must survive unchanged
      expect(actual.ocr_text).toBe(goldenRecord.ocr_text);
      // Explicit {{ and {% still present
      expect(actual.ocr_text).toContain('{{');
      expect(actual.ocr_text).toContain('{%');
    }
  });

  it('all ocr_text values are byte-identical after passthrough', async () => {
    const stagingDir = makeStagingDir('ocr-all');
    await runFisqua({ src: FIXTURE_DIR, stagingDir });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    const golden       = readJson(path.join(FIXTURE_DIR, 'descriptions.json'));

    for (const goldenRecord of golden) {
      const actual = descriptions.find(d => d.reference_code === goldenRecord.reference_code);
      expect(actual).toBeDefined();
      expect(actual.ocr_text).toBe(goldenRecord.ocr_text);
    }
  });
});

// ---------------------------------------------------------------------------
// Module contract
// ---------------------------------------------------------------------------

describe('fisqua adapter — module contract', () => {
  it('fisqua.js exports a run function', () => {
    const mod = require('../../lib/importers/fisqua.js');
    expect(typeof mod.run).toBe('function');
  });

  it('run() returns a result object with copied/absent arrays', async () => {
    const stagingDir = makeStagingDir('result');
    const result = await runFisqua({ src: FIXTURE_DIR, stagingDir });
    expect(Array.isArray(result.copied)).toBe(true);
    expect(Array.isArray(result.absent)).toBe(true);
    expect(result.copied.length).toBe(6);
  });
});

// Version: v0.1.0
