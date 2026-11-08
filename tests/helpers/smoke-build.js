/**
 * Smoke-Instance Build Helper for Hugo Render Tests
 *
 * Some tests need to read pages the real templates render, not template
 * source, because what they check depends on Hugo evaluating site params,
 * partials and i18n together. This helper builds such a site once per call:
 *
 *   - copies tests/fixtures/engine-smoke into a temp directory and turns on
 *     entities and places in its manifest (with an empty entity_links.json,
 *     which the entities module requires and the fixture lacks);
 *   - appends the caller's `[params]` table to hugo.toml;
 *   - runs the caller's `prepare(dir)` hook, for extra content files;
 *   - copies the engine's themes/base into the instance (as `zasqua build`
 *     does) and symlinks the engine's node_modules into it, so Hugo's
 *     css.TailwindCSS can resolve `@import "tailwindcss"` and the
 *     `tailwindcss` binary;
 *   - runs the real build.sh with the real `hugo` from node_modules/.bin
 *     (Stage 6, `hugo --minify`), with zero-op stubs for npm, pagefind, b2
 *     and pip on PATH.
 *
 * The caller removes the returned directory when done.
 *
 * @version v1.6.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../../');
const BUILD_SH = path.join(ENGINE_ROOT, 'build.sh');
const FIXTURE = path.join(ENGINE_ROOT, 'tests', 'fixtures', 'engine-smoke');

export const BUILD_TIMEOUT_MS = 120000;

/**
 * Create a stub binary at `dir/name` that exits 0 and does nothing.
 */
function writeStub(dir, name) {
  fs.writeFileSync(path.join(dir, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
}

/**
 * Build a temp instance from the engine-smoke fixture with the real Hugo.
 *
 * @param {string|null} paramsToml — a `[params]` table appended to
 *   hugo.toml, or null for none
 * @param {object} [options]
 * @param {string} [options.prefix] — temp directory name prefix
 * @param {(dir: string) => void} [options.prepare] — writes extra files
 *   into the instance before the build
 * @returns {string} the instance root
 */
export function buildSmokeInstance(paramsToml, { prefix = 'zasqua-smoke-build-', prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(FIXTURE, dir, { recursive: true });

  // Enable the entity and place modules
  const manifestPath = path.join(dir, 'zasqua.manifest.toml');
  const manifest = fs.readFileSync(manifestPath, 'utf8')
    .replace(/^entities = false$/m, 'entities = true')
    .replace(/^places = false$/m, 'places = true');
  fs.writeFileSync(manifestPath, manifest, 'utf8');

  // The entities module requires entity_links.json; the fixture has none
  fs.writeFileSync(path.join(dir, 'exports', 'entity_links.json'), '[]', 'utf8');

  if (paramsToml) {
    fs.appendFileSync(path.join(dir, 'hugo.toml'), `\n${paramsToml}\n`, 'utf8');
  }

  if (prepare) prepare(dir);

  // Theme copy, as `zasqua build` does; node_modules for Tailwind
  fs.mkdirSync(path.join(dir, 'themes'), { recursive: true });
  fs.cpSync(path.join(ENGINE_ROOT, 'themes', 'base'), path.join(dir, 'themes', 'base'), { recursive: true });
  fs.symlinkSync(path.join(ENGINE_ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', version: '0.0.0' }), 'utf8');

  const stubBinDir = path.join(dir, '.stub-bin');
  fs.mkdirSync(stubBinDir, { recursive: true });
  for (const bin of ['npm', 'pagefind', 'b2', 'pip']) writeStub(stubBinDir, bin);

  const env = {
    ...process.env,
    ENGINE_ROOT,
    INSTANCE_ROOT: dir,
    PATH: `${stubBinDir}:${ENGINE_ROOT}/node_modules/.bin:${process.env.PATH}`,
  };
  try {
    execFileSync('bash', [BUILD_SH], { cwd: dir, env, stdio: 'pipe' });
  } catch (err) {
    const out = `${(err.stdout || '').toString()}\n${(err.stderr || '').toString()}`;
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`build.sh failed (exit ${err.status}):\n${out.slice(-4000)}`);
  }
  return dir;
}

/**
 * Read a rendered page from an instance's public/ directory.
 */
export function readPage(dir, slug) {
  return fs.readFileSync(path.join(dir, 'public', slug, 'index.html'), 'utf8');
}

// Version: v1.6.0
