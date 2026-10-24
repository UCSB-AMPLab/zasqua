/**
 * Reuse-Block Record Links — Hugo Render Tests
 *
 * The Reuse section of the entity page (`entidad/single.html`) and the place
 * page (`lugar/single.html`) points readers at the machine-readable record
 * for that authority: the EAC-CPF XML file for an entity, the Linked Places
 * JSON file for a place. The base URLs come from two site params,
 * `eac_base_url` and `places_base_url`, which a deployer sets in hugo.toml
 * once the `zasqua eac` and `zasqua places` outputs are published. Until
 * then the block keeps its "coming soon" placeholder.
 *
 * These tests render the real templates through Hugo rather than inspecting
 * template source. Each build:
 *
 *   - copies tests/fixtures/engine-smoke into a temp directory and turns on
 *     entities and places in its manifest;
 *   - copies the engine's themes/base into the instance (as `zasqua build`
 *     does) and symlinks the engine's node_modules into it, so Hugo's
 *     css.TailwindCSS can resolve `@import "tailwindcss"` and the
 *     `tailwindcss` binary;
 *   - runs the real build.sh with the real `hugo` from node_modules/.bin
 *     (Stage 6, `hugo --minify`), with zero-op stubs for npm, pagefind, b2
 *     and pip on PATH.
 *
 * The instance also carries one hand-written entity page and one place page
 * without a code (the content adapter never produces such pages) so the
 * templates are exercised with the param set but the code missing.
 *
 * Behaviors asserted:
 *
 *   1. With both params set, the entity page shows
 *      https://m.example.org/eac/ne-smoke-p1.xml and carries it on the copy
 *      button; the place page shows
 *      https://m.example.org/places/nl-smoke-p1.json. A trailing slash on
 *      the base URL yields exactly one slash before the code, and a base of
 *      "/" links to the record at the site root.
 *   2. With a param set but no code on the page, the placeholder renders and
 *      no `/.xml` or `/.json` link appears.
 *   3. Without the params, both pages show the placeholder and no copy
 *      button in the Reuse block.
 *   4. The shared copy handler is loaded on the entity, place and
 *      description pages.
 *
 * @version v1.5.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '../');
const BUILD_SH = path.join(ENGINE_ROOT, 'build.sh');
const FIXTURE = path.join(__dirname, 'fixtures', 'engine-smoke');

const BUILD_TIMEOUT_MS = 120000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a stub binary at `dir/name` that exits 0 and does nothing.
 */
function writeStub(dir, name) {
  fs.writeFileSync(path.join(dir, name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
}

/**
 * Build a temp instance from the engine-smoke fixture and run build.sh
 * against it with the real Hugo.
 *
 * @param {string|null} paramsToml — a `[params]` table appended to
 *   hugo.toml, or null for none
 * @returns {string} the instance root (caller removes it)
 */
function buildInstance(paramsToml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-reuse-links-test-'));
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

  // One entity page and one place page with no code
  fs.mkdirSync(path.join(dir, 'content', 'entidad'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content', 'entidad', 'sin-codigo.md'), [
    '---',
    'title: "Entity Without Code"',
    'display_name: "Entity Without Code"',
    'entity_type: "person"',
    'url: "/entity-without-code/"',
    '---',
    '',
  ].join('\n'), 'utf8');
  fs.mkdirSync(path.join(dir, 'content', 'lugar'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content', 'lugar', 'sin-codigo.md'), [
    '---',
    'title: "Place Without Code"',
    'display_name: "Place Without Code"',
    'label: "Place Without Code"',
    'place_type: "city"',
    'url: "/place-without-code/"',
    '---',
    '',
  ].join('\n'), 'utf8');

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
function readPage(dir, slug) {
  return fs.readFileSync(path.join(dir, 'public', slug, 'index.html'), 'utf8');
}

/**
 * Return the inner HTML of the page's Reuse-block row. The row holds only a
 * <code> and an optional <button>, so the first closing </div> ends it.
 */
function reuseRow(html) {
  const m = html.match(/<div class="?reuse-manifest-row"?>([\s\S]*?)<\/div>/);
  if (!m) throw new Error('reuse-manifest-row not found in rendered page');
  return m[1];
}

/**
 * Return every data-copy-url value in a fragment (minified HTML may drop
 * the attribute quotes).
 */
function copyUrls(fragment) {
  return [...fragment.matchAll(/data-copy-url=(?:"([^"]*)"|([^\s>]+))/g)].map((m) => m[1] ?? m[2]);
}

// ---------------------------------------------------------------------------
// With params
// ---------------------------------------------------------------------------

describe('Reuse block — base URLs set', () => {
  let dir;

  beforeAll(() => {
    dir = buildInstance([
      '[params]',
      '  eac_base_url = "https://m.example.org/eac/"',
      '  places_base_url = "https://m.example.org/places/"',
    ].join('\n'));
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('entity page shows the EAC-CPF URL and puts it on the copy button', () => {
    const row = reuseRow(readPage(dir, 'ne-smoke-p1'));
    expect(row).toContain('https://m.example.org/eac/ne-smoke-p1.xml');
    expect(copyUrls(row)).toEqual(['https://m.example.org/eac/ne-smoke-p1.xml']);
    expect(row).not.toContain('Coming soon');
  });

  it('a trailing slash on either base URL yields one slash before the code', () => {
    const html = readPage(dir, 'ne-smoke-p1');
    expect(html).not.toContain('m.example.org/eac//');
  });

  it('place page shows the Linked Places URL and puts it on the copy button', () => {
    const row = reuseRow(readPage(dir, 'nl-smoke-p1'));
    expect(row).toContain('https://m.example.org/places/nl-smoke-p1.json');
    expect(copyUrls(row)).toEqual(['https://m.example.org/places/nl-smoke-p1.json']);
    expect(row).not.toContain('Coming soon');
    expect(readPage(dir, 'nl-smoke-p1')).not.toContain('m.example.org/places//');
  });

  it('entity page without a code keeps the placeholder and renders no /.xml link', () => {
    const html = readPage(dir, 'entity-without-code');
    const row = reuseRow(html);
    expect(row).toContain('Coming soon');
    expect(copyUrls(row)).toEqual([]);
    expect(html).not.toContain('/.xml');
  });

  it('place page without a code keeps the placeholder and renders no /.json link', () => {
    const html = readPage(dir, 'place-without-code');
    const row = reuseRow(html);
    expect(row).toContain('Coming soon');
    expect(copyUrls(row)).toEqual([]);
    expect(html).not.toContain('/.json');
  });

  it('the shared copy handler is loaded on entity, place and description pages', () => {
    const src = /<script src="?\/js\/copy-url\.js"?>/;
    expect(readPage(dir, 'ne-smoke-p1')).toMatch(src);
    expect(readPage(dir, 'nl-smoke-p1')).toMatch(src);
    expect(readPage(dir, 'co-smoke-f001')).toMatch(src);
  });
});

// ---------------------------------------------------------------------------
// Without params
// ---------------------------------------------------------------------------

describe('Reuse block — base URLs at the site root', () => {
  let dir;

  beforeAll(() => {
    dir = buildInstance([
      '[params]',
      '  eac_base_url = "/"',
      '  places_base_url = "/"',
    ].join('\n'));
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a base of "/" still links, with the record at the root', () => {
    const entity = reuseRow(readPage(dir, 'ne-smoke-p1'));
    expect(copyUrls(entity)).toEqual(['/ne-smoke-p1.xml']);
    expect(entity).not.toContain('Coming soon');
    const place = reuseRow(readPage(dir, 'nl-smoke-p1'));
    expect(copyUrls(place)).toEqual(['/nl-smoke-p1.json']);
    expect(place).not.toContain('Coming soon');
  });
});

describe('Reuse block — base URLs not set', () => {
  let dir;

  beforeAll(() => {
    dir = buildInstance(null);
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('entity page shows the placeholder and no copy button', () => {
    const row = reuseRow(readPage(dir, 'ne-smoke-p1'));
    expect(row).toContain('Coming soon');
    expect(copyUrls(row)).toEqual([]);
    expect(row).not.toContain('reuse-copy-btn');
  });

  it('place page shows the placeholder and no copy button', () => {
    const row = reuseRow(readPage(dir, 'nl-smoke-p1'));
    expect(row).toContain('Coming soon');
    expect(copyUrls(row)).toEqual([]);
    expect(row).not.toContain('reuse-copy-btn');
  });
});

// Version: v1.5.0
