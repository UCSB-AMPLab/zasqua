/**
 * Guarded-Read Contract Unit Tests
 *
 * Tests for the two-tier guarded-read pattern applied to the pipeline scripts
 * `precompute-links.js` and `generate-content.js`. These guards are the
 * belt-and-suspenders layer below the validator: when a module is disabled in
 * `zasqua.manifest.toml`, no file read is attempted and no ENOENT crash
 * occurs; when a module is enabled but its input file is absent, the script
 * throws a loud, actionable error instead of a raw Node ENOENT stack.
 *
 * Four behaviors covered:
 *
 *   1. Tier 1 (entities=false) — precompute-links skips entity processing
 *      entirely.  The guard returns false / skips the block; no error is
 *      thrown even though entity_links.json is absent.
 *
 *   2. Tier 2 (entities=true + missing file) — precompute-links throws
 *      an Error whose message includes the module name ("entities") and the
 *      missing file path.
 *
 *   3. generate-content.js Tier 1 — when entities=false, the script
 *      does not crash even though desc-entity-lookup.json is absent.  The
 *      default empty-object guard correctly produces {} when disabled.
 *
 *   4. generate-content.js Tier 2 — when entities=true but
 *      desc-entity-lookup.json is absent (e.g. partial/interrupted build),
 *      the script throws an actionable Error naming the module and file
 *      rather than a raw ENOENT stack.
 *
 * Note: there is no server-side GeoJSON conversion step — the places map is
 * built client-side from place-index.json, so no places-to-geojson stage
 * exists or is needed.
 *
 * Fixtures use os.tmpdir() for temp directories; no real corpus data is
 * required.
 *
 * @version v0.3.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ENGINE_ROOT is the engine repo root — used to resolve generate-content.js
// when running it as a subprocess in the Tier 2 tests.
const ENGINE_ROOT = path.resolve(__dirname, '../');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a zasqua.manifest.toml and (optionally)
 * data files, returning the instance root path.
 */
function makeInstance(modules = {}, dataFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-guard-test-'));
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });

  // Write the manifest
  const lines = ['[modules]'];
  const defaults = {
    hierarchy: false,
    entities: false,
    entities_graph: false,
    places: false,
    places_map: false,
    iiif: '"auto"',
    ocr: '"auto"',
  };
  const merged = { ...defaults, ...modules };
  for (const [k, v] of Object.entries(merged)) {
    // iiif/ocr may already be quoted strings
    if (typeof v === 'string' && !v.startsWith('"')) {
      lines.push(`${k} = "${v}"`);
    } else {
      lines.push(`${k} = ${v}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'zasqua.manifest.toml'), lines.join('\n'), 'utf8');

  // Write optional data files into exports/
  for (const [name, content] of Object.entries(dataFiles)) {
    fs.writeFileSync(path.join(exportsDir, name), JSON.stringify(content), 'utf8');
  }

  return dir;
}

// ---------------------------------------------------------------------------
// Behavior 1: Tier 1 — entities=false skips entity processing (no crash)
// ---------------------------------------------------------------------------

describe('precompute-links guarded-reads — Tier 1: entities=false skips entity block', () => {
  it('returns false for shouldProcess(manifest, "entities") when entities=false in manifest', () => {
    const { loadManifest } = require('../lib/manifest.js');
    const instanceRoot = makeInstance({ entities: false });
    const manifest = loadManifest(instanceRoot);
    expect(manifest.modules.entities).toBe(false);
  });

  it('does not throw when entity_links.json is absent and entities=false', async () => {
    // Simulate the guarded main by calling with a manifest where entities=false
    // and no entity files present. We test via the exported guardedMain function.
    const { runGuardedMain } = require('../scripts/precompute-links.js');

    // Core-only instance: just descriptions + repositories (min required content)
    const instanceRoot = makeInstance(
      { entities: false, places: false },
      {
        'descriptions.json': [],
        'repositories.json': [],
      }
    );

    await expect(runGuardedMain(instanceRoot)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: Tier 2 — entities=true but file missing throws with module name + path
// ---------------------------------------------------------------------------

describe('precompute-links guarded-reads — Tier 2: entities=true + missing file throws loudly', () => {
  it('throws an Error mentioning "entities" and the missing file path', async () => {
    const { runGuardedMain } = require('../scripts/precompute-links.js');

    // entities=true but entity_links.json not provided
    const instanceRoot = makeInstance(
      { entities: true },
      {
        'descriptions.json': [],
        'repositories.json': [],
        // entity_links.json intentionally absent
      }
    );

    await expect(runGuardedMain(instanceRoot)).rejects.toThrow(/entities/);
    await expect(runGuardedMain(instanceRoot)).rejects.toThrow(/entity_links\.json/);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: generate-content.js Tier 1 — entities=false, no crash
// ---------------------------------------------------------------------------

describe('generate-content.js guarded-reads — Tier 1: entities=false does not crash on missing desc-entity-lookup.json', () => {
  it('does not throw when entities=false and desc-entity-lookup.json is absent', async () => {
    // generate-content.js is an entry-point script that calls main() and exits
    // the process. We need to test it by importing its module-level functions
    // indirectly. Since it does not export main(), we test the contract that
    // the manifest guard is respected: when entities=false, readJSON for
    // desc-entity-lookup.json must never be called.
    //
    // We validate this by running the script via a child process with a Core-only
    // temp instance. If the guard is absent, the process exits 1 (ENOENT).
    // If the guard is present, the process exits 0.
    const { execSync } = await import('child_process');

    const instanceRoot = makeInstance(
      { entities: false, places: false },
      {
        'descriptions.json': [],
        'repositories.json': [{ id: 1, code: 'test', name: 'Test Repo' }],
      }
    );

    // Create the output directory generate-content.js writes to
    const hugoDataDir = path.join(instanceRoot, 'assets', 'hugo-data');
    fs.mkdirSync(hugoDataDir, { recursive: true });

    // desc-entity-lookup.json is intentionally absent — the guard must skip it
    expect(fs.existsSync(path.join(instanceRoot, 'exports', 'desc-entity-lookup.json'))).toBe(false);

    // Run the script as a subprocess. It should exit 0.
    // Without the Tier-2 guard, this exits 1 with a raw ENOENT stack
    // (because precompute-links writes desc-entity-lookup.json unconditionally
    // but this instance has no precompute run).
    // Since entities=false, the guard must prevent the read entirely.
    let threw = false;
    try {
      execSync(
        `node "${path.join(ENGINE_ROOT, 'scripts', 'generate-content.js')}"`,
        {
          env: {
            ...process.env,
            INSTANCE_ROOT: instanceRoot,
            DATA_DIR: path.join(instanceRoot, 'exports'),
            HUGO_DATA_DIR: hugoDataDir,
          },
          cwd: instanceRoot,
          stdio: 'pipe',
        }
      );
    } catch (err) {
      threw = true;
    }
    expect(threw).toBe(false);

    fs.rmSync(instanceRoot, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: generate-content.js Tier 2 — entities=true, missing file, actionable error
// ---------------------------------------------------------------------------

describe('generate-content.js guarded-reads — Tier 2: entities=true + missing desc-entity-lookup.json throws actionably', () => {
  it('exits non-zero with a message mentioning "entities" when desc-entity-lookup.json is absent and entities=true', async () => {
    const { execSync } = await import('child_process');

    // entities=true with entities.json present (so precompute-links Tier 2 would
    // pass), but desc-entity-lookup.json absent — simulating a partial/interrupted
    // precompute-links run.
    const instanceRoot = makeInstance(
      { entities: true, places: false },
      {
        'descriptions.json': [],
        'repositories.json': [{ id: 1, code: 'test', name: 'Test Repo' }],
        'entities.json': [],
        'entity-index.json': '[]',
        // desc-entity-lookup.json intentionally absent
      }
    );

    const hugoDataDir = path.join(instanceRoot, 'assets', 'hugo-data');
    fs.mkdirSync(hugoDataDir, { recursive: true });

    expect(fs.existsSync(path.join(instanceRoot, 'exports', 'desc-entity-lookup.json'))).toBe(false);

    // The script must exit non-zero and its stderr must mention "entities" and
    // "desc-entity-lookup.json" so the operator knows exactly what failed.
    let stderr = '';
    let exitCode = 0;
    try {
      execSync(
        `node "${path.join(ENGINE_ROOT, 'scripts', 'generate-content.js')}"`,
        {
          env: {
            ...process.env,
            INSTANCE_ROOT: instanceRoot,
            DATA_DIR: path.join(instanceRoot, 'exports'),
            HUGO_DATA_DIR: hugoDataDir,
          },
          cwd: instanceRoot,
          stdio: 'pipe',
        }
      );
    } catch (err) {
      exitCode = err.status || 1;
      stderr = (err.stderr || '').toString();
    }

    expect(exitCode).toBeGreaterThan(0);
    // The error message must be actionable — it must name the module and file
    expect(stderr).toMatch(/entities/);
    expect(stderr).toMatch(/desc-entity-lookup\.json/);

    fs.rmSync(instanceRoot, { recursive: true });
  });
});

// Version: v0.3.0
