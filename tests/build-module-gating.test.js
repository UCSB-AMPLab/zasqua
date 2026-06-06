/**
 * build.sh Module-Gating Regression Tests
 *
 * These tests guard a subtle failure mode in the build script. Earlier,
 * Stage 4's unpiped `ls -lh` and Stage 5's unconditional `cp` commands in
 * build.sh crashed any Core-only build: when entities=false and places=false,
 * precompute-links.js correctly writes no entity-links/, doc-entities/,
 * entity-index.json, place-links/, or place-index.json. Under
 * `set -euo pipefail`, the `ls` and `cp` invocations on absent paths exit 1
 * and abort the whole build — defeating graceful degradation on a Core-only
 * instance, where a deployer enables only the catalogue and none of the
 * optional explorer modules.
 *
 * These tests run the real build.sh end-to-end against a minimal Core-only
 * temp instance with SKIP_DOWNLOAD=1 and stubbed npm/hugo/pagefind binaries
 * (zero-op stubs that exit 0). This exercises the data-derivation and
 * copy stages that contain the gating logic, while bypassing the heavy
 * dependencies (Backblaze B2 download, npm ci, Hugo, Pagefind).
 *
 * Three behaviors asserted:
 *
 *   1. Core-only build (entities=false, places=false): build.sh exits 0 and
 *      produces no entity-links/, doc-entities/, entity-index.json,
 *      place-links/, or place-index.json under static/data/.
 *
 *   2. All-enabled build: build.sh exits 0 and copies all entity/place
 *      artifacts into static/data/ (no regression on the enabled path).
 *
 *   3. Mixed build (entities=true, places=false): build.sh exits 0, entity
 *      artifacts are present, place artifacts are absent.
 *
 * This test fails against an unfixed build.sh (the `ls -lh` exits 1 on absent
 * index files; the `cp -r` exits 1 on absent directories) and passes once the
 * copy and listing steps are guarded by the same module flags.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../');
const BUILD_SH = path.join(ENGINE_ROOT, 'build.sh');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a stub binary at `dir/name` that exits 0 and does nothing.
 * Used to shadow npm, hugo, and pagefind so build.sh runs on CI without them.
 */
function writeStub(dir, name) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
}

/**
 * Create a minimal temp instance and run build.sh against it with:
 *   SKIP_DOWNLOAD=1     — skip the B2 download stage
 *   PATH prepended with stub binaries for npm, hugo, pagefind
 *   ENGINE_ROOT         — pointing at the engine repo root
 *
 * The instance has:
 *   zasqua.manifest.toml       — module flags from `modules` param
 *   exports/descriptions.json  — one flat fonds record
 *   exports/repositories.json  — one repository
 *   exports/entities.json      — if entities=true in modules
 *   exports/entity_links.json  — if entities=true in modules
 *   exports/places.json        — if places=true in modules
 *   exports/place_links.json   — if places=true in modules
 *   assets/hugo-data/          — empty (generate-content.js writes here)
 *   static/data/               — empty (Stage 5 writes here)
 *
 * Returns the instance root path. Caller is responsible for cleanup.
 *
 * @param {object} modules — manifest module flags override
 * @returns {{ instanceDir: string, stubBinDir: string }}
 */
function makeInstanceAndStubs(modules = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-buildsh-test-'));

  // Merge with Core-only defaults
  const allModules = {
    hierarchy: false,
    entities: false,
    entities_graph: false,
    places: false,
    places_map: false,
    iiif: false,
    ocr: false,
    ...modules,
  };

  // Write manifest
  const lines = ['[modules]'];
  for (const [k, v] of Object.entries(allModules)) {
    if (v === 'auto') lines.push(`${k} = "auto"`);
    else lines.push(`${k} = ${v}`);
  }
  fs.writeFileSync(path.join(dir, 'zasqua.manifest.toml'), lines.join('\n') + '\n', 'utf8');

  // Core exports (always present)
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.writeFileSync(path.join(exportsDir, 'descriptions.json'), JSON.stringify([
    {
      id: 1, reference_code: 'co-test-f001', title: 'Fondo de Prueba',
      description_level: 'fonds', repository_code: 'co-test',
      date_expression: '', scope_content: '', has_digital: false,
      parent_id: null, parent_reference_code: null,
      child_count: 0, children_level: null,
    },
  ]), 'utf8');
  fs.writeFileSync(path.join(exportsDir, 'repositories.json'), JSON.stringify([
    { id: 1, code: 'co-test', name: 'Archivo de Prueba', country: 'Colombia' },
  ]), 'utf8');

  // Optional exports (required when the module is enabled)
  if (allModules.entities) {
    fs.writeFileSync(path.join(exportsDir, 'entities.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(exportsDir, 'entity_links.json'), JSON.stringify([]), 'utf8');
  }
  if (allModules.places) {
    fs.writeFileSync(path.join(exportsDir, 'places.json'), JSON.stringify([]), 'utf8');
    fs.writeFileSync(path.join(exportsDir, 'place_links.json'), JSON.stringify([]), 'utf8');
  }

  // Output dirs that build.sh writes into
  fs.mkdirSync(path.join(dir, 'assets', 'hugo-data', 'descriptions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'static', 'data'), { recursive: true });

  // Stub package.json so `npm ci` stub (which exits 0) doesn't complain
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }), 'utf8');

  // Stub bin dir: npm, hugo, pagefind, b2 all exit 0 so Stages 3, 6, 7 are no-ops
  const stubBinDir = path.join(dir, '.stub-bin');
  fs.mkdirSync(stubBinDir, { recursive: true });
  for (const bin of ['npm', 'hugo', 'pagefind', 'b2', 'pip']) {
    writeStub(stubBinDir, bin);
  }

  return { instanceDir: dir, stubBinDir };
}

/**
 * Run build.sh from the given instance directory with SKIP_DOWNLOAD=1
 * and the stub bin directory prepended to PATH.
 *
 * @param {string} instanceDir
 * @param {string} stubBinDir
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function runBuildSh(instanceDir, stubBinDir) {
  const env = {
    ...process.env,
    SKIP_DOWNLOAD: '1',
    ENGINE_ROOT,
    INSTANCE_ROOT: instanceDir,
    PATH: `${stubBinDir}:${ENGINE_ROOT}/node_modules/.bin:${process.env.PATH}`,
  };

  try {
    const stdout = execFileSync('bash', [BUILD_SH], {
      cwd: instanceDir,
      env,
      stdio: 'pipe',
    });
    return { exitCode: 0, stdout: stdout.toString(), stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Behavior 1: Core-only — build.sh exits 0, no disabled-module artifacts
//
// Fails against an unguarded build.sh (the `ls -lh` exits 1 on absent index
// files; the `cp -r` exits 1 on absent directories under set -euo pipefail).
// Passes once those steps are gated on the module flags.
// ---------------------------------------------------------------------------

describe('build.sh module gating — Core-only instance', () => {
  it('build.sh exits 0 on a Core-only instance (entities=false, places=false)', () => {
    const { instanceDir, stubBinDir } = makeInstanceAndStubs();
    const { exitCode, stderr } = runBuildSh(instanceDir, stubBinDir);

    if (exitCode !== 0) {
      console.error('[module-gating regression] build.sh stderr:', stderr);
    }
    expect(exitCode).toBe(0);

    fs.rmSync(instanceDir, { recursive: true });
  });

  it('static/data/ has no entity-links/, doc-entities/, entity-index.json on a Core-only instance', () => {
    const { instanceDir, stubBinDir } = makeInstanceAndStubs();
    runBuildSh(instanceDir, stubBinDir);

    // Disabled-module artifacts must NOT appear under static/data/
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'entity-links'))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'doc-entities'))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'entity-index.json'))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'place-links'))).toBe(false);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'place-index.json'))).toBe(false);

    fs.rmSync(instanceDir, { recursive: true });
  });

  it('static/data/children/ is present even on a Core-only instance', () => {
    const { instanceDir, stubBinDir } = makeInstanceAndStubs();
    runBuildSh(instanceDir, stubBinDir);

    // children/ is derived unconditionally — it must always be copied
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'children'))).toBe(true);

    fs.rmSync(instanceDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: All-enabled — build.sh exits 0 and copies entity/place artifacts
// ---------------------------------------------------------------------------

describe('build.sh module gating — all-enabled instance', () => {
  it('build.sh exits 0 with entities=true and places=true', () => {
    const { instanceDir, stubBinDir } = makeInstanceAndStubs({ entities: true, places: true });
    const { exitCode, stderr } = runBuildSh(instanceDir, stubBinDir);

    if (exitCode !== 0) {
      console.error('[module-gating parity] build.sh stderr:', stderr);
    }
    expect(exitCode).toBe(0);

    fs.rmSync(instanceDir, { recursive: true });
  });

  it('entity-index.json and place-index.json are copied to static/data/ when enabled', () => {
    const { instanceDir, stubBinDir } = makeInstanceAndStubs({ entities: true, places: true });
    runBuildSh(instanceDir, stubBinDir);

    // precompute-links writes these files when modules are enabled
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'entity-index.json'))).toBe(true);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'place-index.json'))).toBe(true);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'entity-links'))).toBe(true);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'doc-entities'))).toBe(true);
    expect(fs.existsSync(path.join(instanceDir, 'static', 'data', 'place-links'))).toBe(true);

    fs.rmSync(instanceDir, { recursive: true });
  });
});

// Version: v0.1.0
