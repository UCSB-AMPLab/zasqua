/**
 * Generate Linked Places — command-level smoke test
 *
 * Runs scripts/generate-places.js end-to-end as the `zasqua places` command
 * would (a subprocess reading a fixture instance's exports/ + hugo.toml,
 * writing to a temp PLACES_DIR), to cover what the pure-function unit tests
 * cannot: the file I/O path, one file per place named by place_code plus the
 * corpus index.json (only the features that carry a when), the attested years taken from the linked descriptions,
 * determinism across runs, the type terms read from vocabulary.json, and a record that fails to build, or whose
 * filename is already taken, being skipped with a warning rather than
 * stopping the run or overwriting the earlier file.
 *
 * Uses the engine-smoke fixture: three places (a city with coordinates, a
 * WHG id and a repeated variant; a river without coordinates; an "other"
 * place whose label differs from its display name and which no description
 * links to), two place links to the existing smoke descriptions, the site
 * title "Smoke Test Archive" and no places_* params.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = join(__dirname, '..');
const SCRIPT = join(ENGINE_ROOT, 'scripts', 'generate-places.js');
const FIXTURE = join(__dirname, 'fixtures', 'engine-smoke');
const LPF_CONTEXT = 'https://raw.githubusercontent.com/LinkedPasts/linked-places-format/master/linkedplaces-context-v1.1.jsonld';

// spawnSync keeps stdout, stderr and the exit status.
function runPlaces(placesDir, instanceRoot = FIXTURE) {
  return spawnSync('node', [SCRIPT], {
    env: { ...process.env, INSTANCE_ROOT: instanceRoot, PLACES_DIR: placesDir, DATA_DIR: '' },
    encoding: 'utf8',
  });
}

// A writable copy of the fixture, for the tests that change its exports.
function copyFixture() {
  const instance = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-instance-'));
  fs.cpSync(FIXTURE, instance, { recursive: true });
  return instance;
}

describe('zasqua places — command smoke test', () => {
  let dir, files, result;
  const read = (f) => fs.readFileSync(join(dir, f), 'utf8');
  const feature = (code) => JSON.parse(read(`${code}.json`)).features[0];

  beforeAll(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-smoke-'));
    result = runPlaces(dir);
    files = fs.readdirSync(dir).sort();
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 and writes one file per place plus index.json', () => {
    expect(result.status).toBe(0);
    expect(files).toEqual(['index.json', 'nl-smoke-o1.json', 'nl-smoke-p1.json', 'nl-smoke-r1.json']);
    expect(result.stdout).toContain('[generate-places] Wrote 3 place files + index.json to');
  });

  it('writes each place as a one-feature FeatureCollection with the LPF context', () => {
    for (const f of files.filter((f) => f !== 'index.json')) {
      const fc = JSON.parse(read(f));
      expect(fc.type).toBe('FeatureCollection');
      expect(fc['@context']).toBe(LPF_CONTEXT);
      expect(fc.features).toHaveLength(1);
      expect(fc.features[0]['@id']).toBe(`https://example.com/${f.replace(/\.json$/, '')}/`);
    }
  });

  it('lists in index.json, in input order, only the features that carry a when', () => {
    const index = JSON.parse(read('index.json'));
    expect(index.type).toBe('FeatureCollection');
    expect(index['@context']).toBe(LPF_CONTEXT);
    expect(index.features.map((f) => f['@id'])).toEqual([
      'https://example.com/nl-smoke-p1/',
      'https://example.com/nl-smoke-r1/',
    ]);
    expect(index.features.every((f) => f.when)).toBe(true);
    expect(index.features[0]).toEqual(feature('nl-smoke-p1'));
  });

  it('builds the city with a when from its two dated descriptions, a Point, one WHG link and one variant', () => {
    const p1 = feature('nl-smoke-p1');
    // f001 is 1800 .. 1900 and f002 1901 .. 1950 (date_start, then the last
    // year of date_expression).
    expect(p1.when).toEqual({ timespans: [{ start: { in: '1800' }, end: { in: '1950' } }] });
    expect(p1.geometry).toEqual({ type: 'Point', coordinates: [-74.1, 4.6] });
    expect(p1.links).toEqual([{ type: 'closeMatch', identifier: 'https://whgazetteer.org/places/176861/detail' }]);
    expect(p1.names.map((n) => n.toponym)).toEqual(['Smoke City', 'Smoke Town']);
    expect(p1.names[0].citations).toEqual([{ label: 'Smoke Test Archive', '@id': 'https://example.com/nl-smoke-p1/' }]);
    // The fixture sets defaultContentLanguage but no places_language, so the
    // names make no language claim.
    expect(p1.names[0]).not.toHaveProperty('lang');
  });

  it('gives a place with one dated description that description\'s year range', () => {
    expect(feature('nl-smoke-r1').when).toEqual({ timespans: [{ start: { in: '1800' }, end: { in: '1900' } }] });
  });

  it('builds the unlinked place with no when, a null geometry and its label as a second name', () => {
    const o1 = feature('nl-smoke-o1');
    expect(o1).not.toHaveProperty('when');
    expect(o1.geometry).toBeNull();
    expect(o1.names.map((n) => n.toponym)).toEqual(['Smoke Hill (Smoke City)', 'Smoke Hill']);
    expect(result.stderr).toContain('[generate-places] 1 record(s) without a when: written as place files (not conformant LPF records), left out of index.json');
  });

  it('is deterministic — a second run produces byte-identical output', () => {
    expect(files).toHaveLength(4);
    const dir2 = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-smoke2-'));
    try {
      expect(runPlaces(dir2).status).toBe(0);
      expect(fs.readdirSync(dir2).sort()).toEqual(files);
      for (const f of files) {
        expect(fs.readFileSync(join(dir2, f), 'utf8')).toBe(read(f));
      }
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('skips an unknown fclass, a repeated slug and the reserved slug, warns, and still exits 0', () => {
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-skip-'));
    try {
      const placesPath = join(instance, 'exports', 'places.json');
      const places = JSON.parse(fs.readFileSync(placesPath, 'utf8'));
      places.push({ id: 4, place_code: 'nl-smoke-x1', display_name: 'X', fclass: 'Q' });
      places.push({ id: 5, place_code: 'NL-SMOKE-P1', display_name: 'Duplicate', fclass: 'P' });
      places.push({ id: 6, place_code: 'index', display_name: 'Index', fclass: 'P' });
      fs.writeFileSync(placesPath, JSON.stringify(places, null, 2), 'utf8');

      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(0);
      expect(run.stderr).toContain('[generate-places] skipped nl-smoke-x1: invalid fclass "Q"');
      expect(run.stderr).toContain('[generate-places] skipped NL-SMOKE-P1: slug "NL-SMOKE-P1" already written by nl-smoke-p1');
      expect(run.stderr).toContain('[generate-places] skipped index: slug "index" is reserved for the corpus file');
      expect(run.stderr).toContain('[generate-places] Skipped 3 record(s)');
      expect(fs.readdirSync(outDir).sort()).toEqual(files);
      for (const f of files) {
        expect(fs.readFileSync(join(outDir, f), 'utf8')).toBe(read(f));
      }
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('writes records without when when place_links.json is absent', () => {
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-nolinks-'));
    try {
      fs.rmSync(join(instance, 'exports', 'place_links.json'));
      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('[generate-places] no place_links.json/descriptions.json — records carry no when');
      expect(run.stderr).toContain('[generate-places] 3 record(s) without a when: written as place files (not conformant LPF records), left out of index.json');
      expect(fs.readdirSync(outDir).sort()).toEqual(files);
      const index = JSON.parse(fs.readFileSync(join(outDir, 'index.json'), 'utf8'));
      expect(index.features).toEqual([]);
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('fails with exit 1 when places.json is missing', () => {
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-missing-'));
    try {
      fs.rmSync(join(instance, 'exports', 'places.json'));
      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('[generate-places] required input missing:');
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('reports on stdout that every record carries a when when none lacks one', () => {
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-allwhen-'));
    try {
      const linksPath = join(instance, 'exports', 'place_links.json');
      const links = JSON.parse(fs.readFileSync(linksPath, 'utf8'));
      links.push({ place_code: 'nl-smoke-o1', reference_code: 'co-smoke-f002' });
      fs.writeFileSync(linksPath, JSON.stringify(links, null, 2), 'utf8');
      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('[generate-places] every record carries a when');
      expect(run.stderr).not.toContain('without a when');
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('warns once when baseURL is not absolute, and not for the absolute fixture baseURL', () => {
    expect(result.stderr).not.toContain('baseURL is not absolute');
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-relbase-'));
    try {
      const tomlPath = join(instance, 'hugo.toml');
      fs.writeFileSync(tomlPath, fs.readFileSync(tomlPath, 'utf8').replace('baseURL = "https://example.com/"', 'baseURL = "/"'), 'utf8');
      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(0);
      const warning = '[generate-places] baseURL is not absolute (/); Linked Places @id values should be absolute IRIs';
      expect(run.stderr.split(warning)).toHaveLength(2);
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('takes the type term from vocabulary.json and leaves the other places as without it', () => {
    const instance = copyFixture();
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-vocab-'));
    try {
      fs.writeFileSync(join(instance, 'exports', 'vocabulary.json'), JSON.stringify({
        place_types: [
          { code: 'CITY', label: { es: 'Ciudad', en: 'City' },
            external: { scheme: 'aat', uri: 'https://example.org/concept/1', label: null } },
          { code: 'river', label: { es: 'Río', en: 'River' } },
        ],
      }), 'utf8');
      const run = runPlaces(outDir, instance);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('[generate-places] vocabulary.json: 1 place type term');
      const p1 = JSON.parse(fs.readFileSync(join(outDir, 'nl-smoke-p1.json'), 'utf8')).features[0];
      // The fixture's [ui] language is en-US, so the English label is used.
      expect(p1.types).toEqual([{ identifier: 'https://example.org/concept/1', label: 'City' }]);
      expect({ ...p1, types: undefined }).toEqual({ ...feature('nl-smoke-p1'), types: undefined });
      for (const f of ['nl-smoke-r1.json', 'nl-smoke-o1.json']) {
        expect(fs.readFileSync(join(outDir, f), 'utf8')).toBe(read(f));
      }
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('warns when places_base_url is absolute but PLACES_DIR is under public/', () => {
    const instance = copyFixture();
    try {
      fs.appendFileSync(join(instance, 'hugo.toml'), '\n[params]\nplaces_base_url = "https://data.example.org/places/"\n');
      const run = runPlaces(join(instance, 'public', 'places'), instance);
      expect(run.status).toBe(0);
      expect(run.stderr).toContain('[generate-places] WARN: places_base_url is an absolute URL (https://data.example.org/places)');
      const staged = runPlaces(join(instance, 'public-staging', 'places'), instance);
      expect(staged.status).toBe(0);
      expect(staged.stderr).not.toContain('places_base_url is an absolute URL');
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
    }
  });
});

describe('zasqua places — stale output on rerun', () => {
  // A copy of the fixture whose exports can be changed between runs.
  function setup() {
    const instance = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-stale-instance-'));
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-places-stale-out-'));
    fs.cpSync(FIXTURE, instance, { recursive: true });
    return { instance, outDir };
  }
  function run(instance, outDir) {
    return spawnSync('node', [SCRIPT], {
      env: { ...process.env, INSTANCE_ROOT: instance, PLACES_DIR: outDir, DATA_DIR: '' },
      encoding: 'utf8',
    });
  }
  function cleanup(...dirs) {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }

  it('leaves no file for a record removed from the input, and logs how many files it removed', () => {
    const { instance, outDir } = setup();
    try {
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.existsSync(join(outDir, 'nl-smoke-o1.json'))).toBe(true);
      const inputPath = join(instance, 'exports', 'places.json');
      const records = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const kept = records.filter((r) => r.place_code !== 'nl-smoke-o1');
      expect(kept).toHaveLength(records.length - 1);
      fs.writeFileSync(inputPath, JSON.stringify(kept, null, 2), 'utf8');
      const second = run(instance, outDir);
      expect(second.status).toBe(0);
      expect(fs.existsSync(join(outDir, 'nl-smoke-o1.json'))).toBe(false);
      expect(fs.readdirSync(outDir).sort()).toEqual(['index.json', 'nl-smoke-p1.json', 'nl-smoke-r1.json']);
      expect(second.stdout).toMatch(/Removed \d+ json files? from/);
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('keeps a file with another extension and anything in a subdirectory', () => {
    const { instance, outDir } = setup();
    try {
      fs.writeFileSync(join(outDir, 'notes.xml'), 'keep', 'utf8');
      fs.mkdirSync(join(outDir, 'sub'));
      fs.writeFileSync(join(outDir, 'sub', 'inner.json'), 'keep', 'utf8');
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.readFileSync(join(outDir, 'notes.xml'), 'utf8')).toBe('keep');
      expect(fs.readFileSync(join(outDir, 'sub', 'inner.json'), 'utf8')).toBe('keep');
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('removes a stale json file that no input record produces', () => {
    const { instance, outDir } = setup();
    try {
      fs.writeFileSync(join(outDir, 'gone-record.json'), 'stale', 'utf8');
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.existsSync(join(outDir, 'gone-record.json'))).toBe(false);
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('leaves the previous output in place when the run fails before writing', () => {
    const { instance, outDir } = setup();
    try {
      expect(run(instance, outDir).status).toBe(0);
      const before = fs.readdirSync(outDir).sort();
      expect(before.length).toBeGreaterThan(0);
      fs.writeFileSync(join(instance, 'exports', 'places.json'), '{ not json', 'utf8');
      const failed = run(instance, outDir);
      expect(failed.status).not.toBe(0);
      expect(fs.readdirSync(outDir).sort()).toEqual(before);
    } finally {
      cleanup(instance, outDir);
    }
  });
});

// Version: v1.6.0
