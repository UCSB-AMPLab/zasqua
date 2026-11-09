/**
 * Site Title With an Apostrophe — Hugo Render Tests
 *
 * The page templates hand the browser scripts their strings and labels as
 * JSON in single-quoted `data-*` attributes, and several of those strings
 * carry the site's title (`{{ .Site }}` in the i18n bundles). An apostrophe
 * in the title would close the attribute early, so every such attribute
 * replaces `'` with `\u0027` after `jsonify`; JSON.parse reads it back as
 * the apostrophe.
 *
 * These tests build the smoke instance with the title "Saint Mary's
 * Archive" (tests/helpers/smoke-build.js) and read every single-quoted
 * `data-*` attribute on the search, entity, place, description and explorer
 * pages. So that the description page renders its viewer strings and its
 * tree labels, the first description gets an IIIF manifest and children, a
 * copy of the ISAD(G) profile in a site theme gives one plural level label
 * an apostrophe, and a site i18n file does the same for one viewer string.
 *
 * Behaviors asserted:
 *
 *   1. Every single-quoted `data-*` attribute on those pages parses as JSON.
 *   2. The search page's strings carry the title with its apostrophe.
 *   3. The description page's viewer strings and tree labels, and the
 *      repository page's tree labels, parse and keep their apostrophes.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const ENGINE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVEL_LABEL = "fonds' groups";
const VIEWER_STRING = "Expand the viewer's pane";

const TITLE = "Saint Mary's Archive";

function prepare(dir) {
  const file = path.join(dir, 'hugo.toml');
  const toml = fs.readFileSync(file, 'utf8')
    .replace(/^title = ".*"$/m, `title = "${TITLE}"`)
    .replace(/^theme = .*$/m, 'theme = ["site", "base"]');
  fs.writeFileSync(file, toml, 'utf8');

  const descFile = path.join(dir, 'exports', 'descriptions.json');
  const descriptions = JSON.parse(fs.readFileSync(descFile, 'utf8'));
  descriptions[0].iiif_manifest_url = 'https://example.org/iiif/manifest.json';
  descriptions[0].has_children = true;
  fs.writeFileSync(descFile, JSON.stringify(descriptions), 'utf8');

  const repoFile = path.join(dir, 'exports', 'repositories.json');
  const repositories = JSON.parse(fs.readFileSync(repoFile, 'utf8'));
  repositories[0].root_descriptions = [{ reference_code: descriptions[0].reference_code }];
  fs.writeFileSync(repoFile, JSON.stringify(repositories), 'utf8');

  const profile = yaml.load(fs.readFileSync(
    path.join(ENGINE_ROOT, 'themes', 'base', 'data', 'standards', 'isadg.yaml'), 'utf8'));
  profile.en.levelsPlural.fonds = LEVEL_LABEL;
  const standardsDir = path.join(dir, 'themes', 'site', 'data', 'standards');
  fs.mkdirSync(standardsDir, { recursive: true });
  fs.writeFileSync(path.join(standardsDir, 'isadg.yaml'), yaml.dump(profile), 'utf8');

  fs.mkdirSync(path.join(dir, 'i18n'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'i18n', 'en.toml'), `[description]\ntifyExpand = "${VIEWER_STRING}"\n`, 'utf8');
}

/** Every data-* attribute written in single quotes, as [name, raw value]. */
function singleQuotedData(html) {
  return [...html.matchAll(/\s(data-[a-z0-9-]+)='([^']*)'/g)].map((m) => [m[1], m[2]]);
}

/** Decode the entities an HTML parser would decode in an attribute value. */
function decode(value) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe("Site title with an apostrophe", () => {
  let dir;
  const pages = {};

  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-apostrophe-', prepare });
    for (const slug of ['buscar', 'entidades', 'lugares', 'ne-smoke-p1', 'nl-smoke-p1']) {
      pages[slug] = readPage(dir, slug);
    }
    const descriptions = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'descriptions.json'), 'utf8'));
    pages.description = readPage(dir, descriptions[0].reference_code);
    pages.repository = readPage(dir, 'co-smoke');
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('every single-quoted data attribute parses as JSON', () => {
    let checked = 0;
    for (const [slug, html] of Object.entries(pages)) {
      for (const [name, raw] of singleQuotedData(html)) {
        expect(() => JSON.parse(decode(raw)), `${slug} ${name}`).not.toThrow();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("the search page's strings carry the title with its apostrophe", () => {
    const attr = singleQuotedData(pages.buscar).find(([name]) => name === 'data-i18n');
    expect(attr).toBeDefined();
    expect(JSON.stringify(JSON.parse(decode(attr[1])))).toContain(TITLE);
  });

  it("the description page's viewer strings and tree labels keep their apostrophes", () => {
    const attrs = Object.fromEntries(singleQuotedData(pages.description));
    expect(attrs['data-i18n']).toBeDefined();
    expect(attrs['data-level-labels']).toBeDefined();
    expect(JSON.parse(decode(attrs['data-i18n'])).tifyExpand).toBe(VIEWER_STRING);
    expect(JSON.parse(decode(attrs['data-level-labels'])).fonds).toBe(LEVEL_LABEL);
  });

  it("the repository page's tree labels keep their apostrophes", () => {
    const attrs = Object.fromEntries(singleQuotedData(pages.repository));
    expect(attrs['data-level-labels']).toBeDefined();
    expect(JSON.parse(decode(attrs['data-level-labels'])).fonds).toBe(LEVEL_LABEL);
  });
});

// Version: v1.6.0
