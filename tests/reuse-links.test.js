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
 * template source, with the smoke-instance build in tests/helpers/smoke-build.js.
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
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write one entity page and one place page with no code, which the content
 * adapter never produces, so the templates run with the param set but the
 * code missing.
 */
function writeCodelessPages(dir) {
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
}

/**
 * Build the smoke instance with the codeless pages added.
 */
function buildInstance(paramsToml) {
  return buildSmokeInstance(paramsToml, {
    prefix: 'zasqua-reuse-links-test-',
    prepare: writeCodelessPages,
  });
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

// Version: v1.6.0
