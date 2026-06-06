/**
 * Golden Instance-Profile Fixture Assertions
 *
 * Exercises the modular-core Node APIs — loadManifest, validateInputs,
 * detectModules, and deriveChildren — against two synthetic small-dataset
 * profiles: core-only and core+hierarchy.
 *
 * These profiles are the modularity regression net: they prove the engine
 * builds correctly whether a deployer enables only the core catalogue or
 * adds the hierarchy module on top. They run entirely on 9–10 record
 * synthetic datasets and complete in milliseconds, making them suitable for
 * per-commit CI without a full corpus.
 *
 * Two golden fixture profiles tested:
 *
 *   core-only/
 *     A 10-record flat dataset (all fonds, no parent_reference_code) with a
 *     manifest where every explorer module is false. Proves graceful
 *     degradation: the validator passes, detectModules reports all explorer
 *     flags false, and deriveChildren produces zero shards (no hierarchy in
 *     a flat dataset).
 *
 *   core-hierarchy/
 *     A 9-record fonds-series-file tree with parent_reference_code and
 *     parent_id populated, with hierarchy = true in the manifest and all
 *     other modules false. Proves hierarchy derivation: deriveChildren
 *     produces shards for the three parent records; the fonds shard has
 *     three children (the three series); the first series shard has three
 *     children (three files); the second series shard has two children.
 *
 *   hugo-section-adapter/
 *     A minimal two-theme Hugo project with entities=true and places=true in
 *     its manifest. Used by the Hugo section-adapter regression tests
 *     (Behavior 10) to assert that the root-level _content.gotmpl adapter
 *     emits exactly /entidades/ and /lugares/ — and never the spurious nested
 *     /entidades/entidades/ or /lugares/lugares/ pages that an earlier
 *     per-section adapter pattern produced, where two extra pages appeared in
 *     the enabled build.
 *
 * Ten behaviors asserted:
 *
 *   1. core-only: validateInputs passes on conformant flat data
 *   2. core-only: detectModules returns all explorer modules false
 *   3. core-only: deriveChildren produces zero shards for a flat dataset
 *   4. core+hierarchy: validateInputs passes on conformant tree data
 *   5. core+hierarchy: detectModules returns hierarchy=true, entities/places false
 *   6. core+hierarchy: deriveChildren produces a non-empty Miller-column tree
 *      (at least one parent shard with grouped children)
 *   7. core+hierarchy: the fonds shard has exactly 3 children (the three series)
 *   8. core+hierarchy: the first series shard has exactly 3 children (three files)
 *   9. core+hierarchy: guarded-read predicates report entities/places disabled
 *      under the core-only manifest (manifest.modules.entities === false, etc.)
 *  10. hugo-section-adapter: a real Hugo build with entities=true and places=true
 *      produces exactly /entidades/ and /lugares/ — no nested /entidades/entidades/
 *      or /lugares/lugares/ pages (regression guard against the duplicate
 *      nested section pages)
 *
 * @version v0.2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);

// Resolve the fixtures directory relative to this test file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = __dirname;
const CORE_ONLY_DIR = path.join(FIXTURES_DIR, 'core-only');
const CORE_HIER_DIR = path.join(FIXTURES_DIR, 'core-hierarchy');
const HUGO_ADAPTER_DIR = path.join(FIXTURES_DIR, 'hugo-section-adapter');

// Hugo binary path (engine-bundled via hugo-extended npm package).
const ENGINE_ROOT = path.resolve(__dirname, '../../');
const HUGO_BIN = path.join(ENGINE_ROOT, 'node_modules', '.bin', 'hugo');

// Engine APIs under test.
const { loadManifest } = require('../../lib/manifest.js');
const { validateInputs } = require('../../lib/validator.js');
const { detectModules } = require('../../lib/init.js');
const { deriveChildren } = require('../../scripts/derive-children.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON fixture file.
 * @param {string} dir  - fixture directory
 * @param {string} name - filename (e.g. 'descriptions.json')
 * @returns {Array}
 */
function loadFixture(dir, name) {
  const p = path.join(dir, name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// Behavior 1–3: core-only profile
// ---------------------------------------------------------------------------

describe('core-only fixture — validateInputs passes on conformant flat data', () => {
  it('validateInputs returns an empty error array for the core-only fixture', () => {
    const manifest = loadManifest(CORE_ONLY_DIR);
    const errors = validateInputs(manifest, CORE_ONLY_DIR);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors).toHaveLength(0);
  });
});

describe('core-only fixture — detectModules returns all explorer modules false', () => {
  it('detectModules returns hierarchy = false (no parent_reference_code in data)', () => {
    const detected = detectModules(CORE_ONLY_DIR);
    expect(detected.hierarchy).toBe(false);
  });

  it('detectModules returns entities = false (no entities.json)', () => {
    const detected = detectModules(CORE_ONLY_DIR);
    expect(detected.entities).toBe(false);
  });

  it('detectModules returns places = false (no places.json)', () => {
    const detected = detectModules(CORE_ONLY_DIR);
    expect(detected.places).toBe(false);
  });

  it('detectModules returns entities_graph = false', () => {
    const detected = detectModules(CORE_ONLY_DIR);
    expect(detected.entities_graph).toBe(false);
  });

  it('detectModules returns places_map = false', () => {
    const detected = detectModules(CORE_ONLY_DIR);
    expect(detected.places_map).toBe(false);
  });
});

describe('core-only fixture — deriveChildren produces zero shards for a flat dataset', () => {
  it('deriveChildren returns an empty shards Map when no record has parent_id', () => {
    const descriptions = loadFixture(CORE_ONLY_DIR, 'descriptions.json');
    const { shards, warnings } = deriveChildren(descriptions);
    expect(shards.size).toBe(0);
    // No warnings expected: records are flat roots, not orphans
    expect(warnings).toHaveLength(0);
  });

  it('all 10 core-only descriptions have parent_id === null', () => {
    const descriptions = loadFixture(CORE_ONLY_DIR, 'descriptions.json');
    expect(descriptions).toHaveLength(10);
    for (const d of descriptions) {
      expect(d.parent_id).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior 4–8: core+hierarchy profile
// ---------------------------------------------------------------------------

describe('core+hierarchy fixture — validateInputs passes on conformant tree data', () => {
  it('validateInputs returns an empty error array for the core+hierarchy fixture', () => {
    const manifest = loadManifest(CORE_HIER_DIR);
    const errors = validateInputs(manifest, CORE_HIER_DIR);
    expect(Array.isArray(errors)).toBe(true);
    expect(errors).toHaveLength(0);
  });
});

describe('core+hierarchy fixture — detectModules returns expected flags', () => {
  it('detectModules returns hierarchy = true (parent_reference_code present)', () => {
    const detected = detectModules(CORE_HIER_DIR);
    expect(detected.hierarchy).toBe(true);
  });

  it('detectModules returns entities = false (no entities.json)', () => {
    const detected = detectModules(CORE_HIER_DIR);
    expect(detected.entities).toBe(false);
  });

  it('detectModules returns places = false (no places.json)', () => {
    const detected = detectModules(CORE_HIER_DIR);
    expect(detected.places).toBe(false);
  });
});

describe('core+hierarchy fixture — deriveChildren produces a Miller-column tree', () => {
  it('deriveChildren produces a non-empty shards Map', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards, warnings } = deriveChildren(descriptions);
    expect(shards.size).toBeGreaterThan(0);
    expect(warnings).toHaveLength(0);
  });

  it('produces exactly 3 parent shards (fonds + 2 series with children)', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    // Shard exists for id=100 (fonds), id=101 (series with 3 files),
    // id=102 (series with 2 files). id=103 (series with 0 children) has no shard.
    expect(shards.size).toBe(3);
    expect(shards.has(100)).toBe(true);
    expect(shards.has(101)).toBe(true);
    expect(shards.has(102)).toBe(true);
    // The leaf series (id=103) has no children, so no shard
    expect(shards.has(103)).toBe(false);
  });

  it('the fonds shard (id=100) has exactly 3 children (the three series)', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    const fondsShard = shards.get(100);
    expect(fondsShard).toBeDefined();
    expect(fondsShard.count).toBe(3);
    expect(fondsShard.results).toHaveLength(3);
  });

  it('the first series shard (id=101) has exactly 3 children (three files)', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    const series1Shard = shards.get(101);
    expect(series1Shard).toBeDefined();
    expect(series1Shard.count).toBe(3);
    expect(series1Shard.results).toHaveLength(3);
  });

  it('the second series shard (id=102) has exactly 2 children (two files)', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    const series2Shard = shards.get(102);
    expect(series2Shard).toBeDefined();
    expect(series2Shard.count).toBe(2);
    expect(series2Shard.results).toHaveLength(2);
  });

  it('children in the fonds shard are sorted by reference_code ascending', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    const fondsShard = shards.get(100);
    const codes = fondsShard.results.map(r => r.reference_code);
    expect(codes).toEqual([
      'co-test-f001-s001',
      'co-test-f001-s002',
      'co-test-f001-s003',
    ]);
  });

  it('each child object carries exactly the 9 confirmed contract fields', () => {
    const descriptions = loadFixture(CORE_HIER_DIR, 'descriptions.json');
    const { shards } = deriveChildren(descriptions);
    const fondsShard = shards.get(100);
    const child = fondsShard.results[0];
    expect(Object.keys(child)).toEqual([
      'id',
      'reference_code',
      'title',
      'description_level',
      'date_expression',
      'scope_content',
      'child_count',
      'children_level',
      'has_digital',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Behavior 9: guarded-read predicates via the manifest loaded from fixtures
// ---------------------------------------------------------------------------

describe('guarded-read predicates — manifest controls which modules are enabled', () => {
  it('core-only manifest: modules.entities === false (entities guard would skip)', () => {
    const manifest = loadManifest(CORE_ONLY_DIR);
    expect(manifest.modules.entities).toBe(false);
  });

  it('core-only manifest: modules.places === false (places guard would skip)', () => {
    const manifest = loadManifest(CORE_ONLY_DIR);
    expect(manifest.modules.places).toBe(false);
  });

  it('core-only manifest: modules.hierarchy === false', () => {
    const manifest = loadManifest(CORE_ONLY_DIR);
    expect(manifest.modules.hierarchy).toBe(false);
  });

  it('core+hierarchy manifest: modules.hierarchy === true', () => {
    const manifest = loadManifest(CORE_HIER_DIR);
    expect(manifest.modules.hierarchy).toBe(true);
  });

  it('core+hierarchy manifest: modules.entities === false', () => {
    const manifest = loadManifest(CORE_HIER_DIR);
    expect(manifest.modules.entities).toBe(false);
  });

  it('core+hierarchy manifest: modules.places === false', () => {
    const manifest = loadManifest(CORE_HIER_DIR);
    expect(manifest.modules.places).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behavior 10: Hugo section-adapter regression
//
// The /entidades/ and /lugares/ section landing pages are emitted SOLELY by the
// root content adapter (content/_content.gotmpl) when the matching module is
// enabled. There are deliberately no content/entidades/_index.md or
// content/lugares/_index.md stubs: a static _index.md at the same path competes
// with the adapter's AddPage call, and Hugo picks the winner once per build (Go
// map/goroutine ordering), so a stub carrying build.render = "never" could win
// that merge and silently suppress the section page — a build-order flake that
// surfaced intermittently on constrained CI runners.
//
// Two real Hugo builds of the minimal hugo-section-adapter fixture guard this:
//
//   Enabled (manifest entities=true, places=true):
//     - /entidades/index.html and /lugares/index.html are produced
//     - /entidades/entidades/ and /lugares/lugares/ are ABSENT — the adapter
//       lives at the content root, so path="entidades" resolves to the section
//       root, not a spurious nested page
//
//   Disabled (entities=false, places=false), built in a throwaway copy:
//     - /entidades/ and /lugares/ are ABSENT — the adapter does not fire and no
//       stub renders them, so core-only builds stay clean without a
//       render:"never" file (Hugo does not auto-render an empty section)
// ---------------------------------------------------------------------------

describe('Hugo section-adapter regression — adapter is the sole, deterministic source of the section pages', () => {
  const publicDir = path.join(HUGO_ADAPTER_DIR, 'public');
  const entidadesIndex = path.join(publicDir, 'entidades', 'index.html');
  const lugaresIndex = path.join(publicDir, 'lugares', 'index.html');

  let enabledOutput = '';
  let enabledError = null;
  let disabledDir = '';
  let disabledOutput = '';
  let disabledError = null;

  beforeAll(() => {
    // Enabled build — the fixture manifest enables both modules, so the root
    // adapter emits both section pages. A single build suffices: with no
    // competing _index.md stub the emission is deterministic.
    if (fs.existsSync(publicDir)) {
      fs.rmSync(publicDir, { recursive: true });
    }
    try {
      enabledOutput = execSync(`"${HUGO_BIN}" --minify --logLevel error`, {
        cwd: HUGO_ADAPTER_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      enabledError = err;
      enabledOutput = `${err.stdout || ''}${err.stderr || ''}`;
    }

    // Disabled build — a throwaway copy of the fixture with both modules off.
    // The adapter does not fire and there is no stub, so neither section may
    // appear. This locks the core-only suppression the removed render:"never"
    // stubs used to provide.
    disabledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-section-disabled-'));
    fs.cpSync(HUGO_ADAPTER_DIR, disabledDir, { recursive: true });
    fs.rmSync(path.join(disabledDir, 'public'), { recursive: true, force: true });
    fs.rmSync(path.join(disabledDir, 'resources'), { recursive: true, force: true });
    fs.writeFileSync(
      path.join(disabledDir, 'data', 'manifest.toml'),
      '[modules]\nentities = false\nplaces = false\n',
      'utf8'
    );
    try {
      disabledOutput = execSync(`"${HUGO_BIN}" --minify --logLevel error`, {
        cwd: disabledDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      disabledError = err;
      disabledOutput = `${err.stdout || ''}${err.stderr || ''}`;
    }
  }, 30000);

  afterAll(() => {
    if (disabledDir && fs.existsSync(disabledDir)) {
      fs.rmSync(disabledDir, { recursive: true, force: true });
    }
  });

  it('hugo binary exists', () => {
    expect(fs.existsSync(HUGO_BIN)).toBe(true);
  });

  it('hugo-section-adapter fixture directory exists', () => {
    expect(fs.existsSync(HUGO_ADAPTER_DIR)).toBe(true);
    expect(fs.existsSync(path.join(HUGO_ADAPTER_DIR, 'hugo.toml'))).toBe(true);
  });

  it('enabled build completed without error', () => {
    expect(enabledError, `Hugo failed on the enabled fixture:\n${enabledOutput}`).toBeNull();
  });

  it('enabled build produced the public/ directory', () => {
    expect(fs.existsSync(publicDir), `Hugo output:\n${enabledOutput}`).toBe(true);
  });

  it('/entidades/index.html exists when entities is enabled', () => {
    expect(fs.existsSync(entidadesIndex), `Hugo output:\n${enabledOutput}`).toBe(true);
  });

  it('/lugares/index.html exists when places is enabled', () => {
    expect(fs.existsSync(lugaresIndex), `Hugo output:\n${enabledOutput}`).toBe(true);
  });

  it('/entidades/entidades/ is ABSENT — no spurious nested section page', () => {
    const spurious = path.join(publicDir, 'entidades', 'entidades', 'index.html');
    expect(fs.existsSync(spurious)).toBe(false);
  });

  it('/lugares/lugares/ is ABSENT — no spurious nested section page', () => {
    const spurious = path.join(publicDir, 'lugares', 'lugares', 'index.html');
    expect(fs.existsSync(spurious)).toBe(false);
  });

  // Guard the disabled-case assertions below against a masked build failure:
  // they check for ABSENCE, which a crashed build (no output at all) would also
  // satisfy. Assert the build actually ran and emitted a site first, so the
  // absence of the two sections means real suppression, not a dead build.
  it('disabled build completed without error', () => {
    expect(disabledError, `Hugo failed on the disabled fixture:\n${disabledOutput}`).toBeNull();
  });

  it('disabled build still produced a site (public/ with output)', () => {
    const disabledPublic = path.join(disabledDir, 'public');
    expect(fs.existsSync(disabledPublic), `Hugo output:\n${disabledOutput}`).toBe(true);
    expect(fs.existsSync(path.join(disabledPublic, 'sitemap.xml')), `Hugo output:\n${disabledOutput}`).toBe(true);
  });

  it('/entidades/ is ABSENT when entities is disabled (core-only suppression)', () => {
    const dir = path.join(disabledDir, 'public', 'entidades');
    expect(fs.existsSync(dir), `Hugo output:\n${disabledOutput}`).toBe(false);
  });

  it('/lugares/ is ABSENT when places is disabled (core-only suppression)', () => {
    const dir = path.join(disabledDir, 'public', 'lugares');
    expect(fs.existsSync(dir), `Hugo output:\n${disabledOutput}`).toBe(false);
  });
});

// Version: v1.0.0
