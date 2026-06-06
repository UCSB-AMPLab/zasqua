/**
 * EAD3 Import Adapter — Conformance Fixture Tests
 *
 * Exercises `run` from `lib/importers/ead3.js` against two fixtures:
 *
 *   1. ead3-atom golden fixture: AtoM-style EAD3 export with fonds + 2 nested
 *      components (c01/c02), one matched persname (@identifier matches
 *      entity_code in entities.json), one matched geogname (@identifier
 *      matches place_code in places.json), and one bare persname (no
 *      @identifier) that must drop to prose and NOT appear in entity_links.
 *      Asserts conformance, deep equality against expected/ output, and
 *      import-report carried/skipped counts.
 *
 *   2. ead3-archivesspace golden fixture: ArchivesSpace-style EAD3 export
 *      with unnumbered <c> nesting, no authority file (empty entity/place
 *      arrays). Asserts conformance and correct description hierarchy.
 *
 * Seven behaviors covered:
 *
 *   1. run() on ead3-atom fixture writes six files; validateInputs returns [].
 *   2. descriptions deep-equal expected/ (hierarchy, parent_reference_code).
 *   3. entity_links contain ONLY matched @identifier access points.
 *   4. Bare persname (no @identifier) is ABSENT from entity_links (no minting).
 *   5. import-report carried/skipped counts deep-equal expected report.
 *   6. run() on ead3-archivesspace fixture (unnumbered <c>) produces conformant
 *      descriptions with correct hierarchy.
 *   7. descriptive_standard on output reflects the --standard argument.
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
const { run: runEad3Import } = require('../../lib/importers/ead3.js');

const ATOM_FIXTURE_DIR    = path.join(__dirname, '../fixtures/ead3-atom');
const ATOM_EXPECTED_DIR   = path.join(ATOM_FIXTURE_DIR, 'expected');

const AS_FIXTURE_DIR      = path.join(__dirname, '../fixtures/ead3-archivesspace');
const AS_EXPECTED_DIR     = path.join(AS_FIXTURE_DIR, 'expected');

// ---------------------------------------------------------------------------
// Helper: create a fresh tmp staging dir per test
// ---------------------------------------------------------------------------

function makeStagingDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zasqua-ead3-${prefix}-`));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// AtoM fixture tests
// ---------------------------------------------------------------------------

describe('ead3 adapter — AtoM fixture', () => {
  it('run() writes six contract files to stagingDir', async () => {
    const stagingDir = makeStagingDir('atom-six');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const CONTRACT = [
      'descriptions.json', 'repositories.json', 'entities.json',
      'entity_links.json', 'places.json', 'place_links.json',
    ];
    for (const f of CONTRACT) {
      expect(fs.existsSync(path.join(stagingDir, f)), `${f} should exist`).toBe(true);
    }
  });

  it('validateInputs returns zero errors on AtoM output', async () => {
    const stagingDir = makeStagingDir('atom-validate');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const manifest = { modules: { entities: true, places: true } };
    const errors = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });

  it('descriptions deep-equal expected output (hierarchy, parent_reference_code)', async () => {
    const stagingDir = makeStagingDir('atom-desc');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'descriptions.json'));
    const expected = readJson(path.join(ATOM_EXPECTED_DIR, 'descriptions.json'));
    expect(actual).toEqual(expected);
  });

  it('repositories deep-equal expected output', async () => {
    const stagingDir = makeStagingDir('atom-repo');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'repositories.json'));
    const expected = readJson(path.join(ATOM_EXPECTED_DIR, 'repositories.json'));
    expect(actual).toEqual(expected);
  });

  it('entity_links contain ONLY matched @identifier access points', async () => {
    const stagingDir = makeStagingDir('atom-elinks');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'entity_links.json'));
    const expected = readJson(path.join(ATOM_EXPECTED_DIR, 'entity_links.json'));
    expect(actual).toEqual(expected);
  });

  it('bare persname (no @identifier) is ABSENT from entity_links — no authority minting', async () => {
    const stagingDir = makeStagingDir('atom-nomint');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const entityLinks = readJson(path.join(stagingDir, 'entity_links.json'));
    // The bare name "Martínez Herrera, Pedro" must not appear in entity_links
    const hasBare = entityLinks.some(
      l => l.entity_code === undefined || l.entity_code === null
        || l.role === undefined
    );
    expect(hasBare).toBe(false);

    // Specifically, no link should exist for an entity that's not ne-abc12
    const unknownLinks = entityLinks.filter(l => l.entity_code !== 'ne-abc12');
    expect(unknownLinks).toHaveLength(0);
  });

  it('place_links deep-equal expected output', async () => {
    const stagingDir = makeStagingDir('atom-plinks');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'place_links.json'));
    const expected = readJson(path.join(ATOM_EXPECTED_DIR, 'place_links.json'));
    expect(actual).toEqual(expected);
  });

  it('import-report carried/skipped counts deep-equal expected report', async () => {
    const stagingDir = makeStagingDir('atom-report');
    await runEad3Import({
      src: path.join(ATOM_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: ATOM_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'import-report.json'));
    const expected = readJson(path.join(ATOM_EXPECTED_DIR, 'import-report.json'));

    expect(actual.access_points.carried).toBe(expected.access_points.carried);
    expect(actual.access_points.skipped).toBe(expected.access_points.skipped);
    expect(actual.access_points.skipped_list).toHaveLength(expected.access_points.skipped_list.length);
    // The bare name must appear in the skipped list
    const skippedTexts = actual.access_points.skipped_list.map(s => s.text);
    expect(skippedTexts).toContain('Martínez Herrera, Pedro');
  });
});

// ---------------------------------------------------------------------------
// ArchivesSpace fixture tests
// ---------------------------------------------------------------------------

describe('ead3 adapter — ArchivesSpace fixture (unnumbered <c>)', () => {
  it('run() on ArchivesSpace fixture writes six conformant files', async () => {
    const stagingDir = makeStagingDir('as-six');
    await runEad3Import({
      src: path.join(AS_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: AS_FIXTURE_DIR,
    });

    // Core conformance: descriptions + repositories required; entities/places empty ok
    const manifest = { modules: { entities: false, places: false } };
    const errors = validateInputs(manifest, stagingDir);
    expect(errors).toHaveLength(0);
  });

  it('ArchivesSpace descriptions deep-equal expected output (unnumbered <c> hierarchy)', async () => {
    const stagingDir = makeStagingDir('as-desc');
    await runEad3Import({
      src: path.join(AS_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'isadg',
      instanceRoot: AS_FIXTURE_DIR,
    });

    const actual   = readJson(path.join(stagingDir, 'descriptions.json'));
    const expected = readJson(path.join(AS_EXPECTED_DIR, 'descriptions.json'));
    expect(actual).toEqual(expected);
  });

  it('descriptive_standard reflects the --standard argument (dacs)', async () => {
    const stagingDir = makeStagingDir('as-standard');
    await runEad3Import({
      src: path.join(AS_FIXTURE_DIR, 'export.xml'),
      stagingDir,
      standard: 'dacs',
      instanceRoot: AS_FIXTURE_DIR,
    });

    const descriptions = readJson(path.join(stagingDir, 'descriptions.json'));
    expect(descriptions.length).toBeGreaterThan(0);
    for (const desc of descriptions) {
      expect(desc.descriptive_standard).toBe('dacs');
    }
  });
});

// Version: v0.1.0
