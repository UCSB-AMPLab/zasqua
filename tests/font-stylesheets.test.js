/**
 * Font Stylesheets Setting — Hugo Render Tests
 *
 * The layout shell links the site's web-font stylesheets in the page
 * head. A site names them in `site.Params.font_stylesheets` (one URL or a
 * list); without the setting the shell links the three Google Fonts
 * families the engine has always loaded, a default deprecated for 2.0.0.
 * The Material Symbols icon font is linked in every case, because the
 * templates draw their icons with it.
 *
 * These tests render the real templates through Hugo, with the
 * smoke-instance build in tests/helpers/smoke-build.js. The same builds
 * check that the shell loads theme-colors.js before the page scripts.
 *
 * Behaviors asserted:
 *
 *   1. With a list of URLs, the head links each of them and not the
 *      default families.
 *   2. With a single URL as a string, the head links that URL.
 *   3. With an empty list, the head links no font stylesheet other than
 *      Material Symbols.
 *   4. Without the setting, the head links today's default families.
 *   5. The shell loads theme-colors.js before the entity page's script.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const DEFAULT_FONTS = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&family=Crimson+Text:wght@400;700&family=Cormorant+Garamond:wght@300;600&display=swap';
const SYMBOLS = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined';

/**
 * Return the href of every stylesheet link in a page (minified HTML may
 * drop the attribute quotes), with &amp; decoded.
 */
function stylesheetHrefs(html) {
  const links = html.match(/<link[^>]*rel=(?:"stylesheet"|stylesheet)[^>]*>/g) || [];
  return links
    .map((l) => {
      const m = l.match(/href=(?:"([^"]*)"|([^\s>]+))/);
      return m && (m[1] ?? m[2]);
    })
    .filter(Boolean)
    .map((h) => h.replace(/&amp;/g, '&'));
}

function fontHrefs(html) {
  return stylesheetHrefs(html).filter((h) => !h.startsWith(SYMBOLS) && !h.startsWith('/css/'));
}

function hasSymbols(html) {
  return stylesheetHrefs(html).some((h) => h.startsWith(SYMBOLS));
}

function withBuild(paramsToml, prefix, body) {
  let dir;
  beforeAll(() => { dir = buildSmokeInstance(paramsToml, { prefix }); }, BUILD_TIMEOUT_MS);
  afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
  body(() => dir);
}

describe('font_stylesheets — list of URLs', () => {
  withBuild([
    '[params]',
    '  font_stylesheets = [',
    '    "https://fonts.example.org/one.css",',
    '    "/fonts/two.css",',
    '  ]',
  ].join('\n'), 'zasqua-fonts-list-', (dir) => {
    it('links each URL, in order, and not the default families', () => {
      const html = readPage(dir(), '');
      expect(fontHrefs(html)).toEqual(['https://fonts.example.org/one.css', '/fonts/two.css']);
      expect(hasSymbols(html)).toBe(true);
    });
  });
});

describe('font_stylesheets — single URL', () => {
  withBuild('[params]\n  font_stylesheets = "https://fonts.example.org/only.css"', 'zasqua-fonts-one-', (dir) => {
    it('links that URL', () => {
      expect(fontHrefs(readPage(dir(), ''))).toEqual(['https://fonts.example.org/only.css']);
    });
  });
});

describe('font_stylesheets — empty list', () => {
  withBuild('[params]\n  font_stylesheets = []', 'zasqua-fonts-none-', (dir) => {
    it('links no font stylesheet but Material Symbols', () => {
      const html = readPage(dir(), '');
      expect(fontHrefs(html)).toEqual([]);
      expect(hasSymbols(html)).toBe(true);
    });
  });
});

describe('font_stylesheets — absent', () => {
  withBuild(null, 'zasqua-fonts-default-', (dir) => {
    it('links the default families, as before 1.6.0', () => {
      const html = readPage(dir(), '');
      expect(fontHrefs(html)).toEqual([DEFAULT_FONTS]);
      expect(hasSymbols(html)).toBe(true);
    });

    it('loads theme-colors.js before the page scripts', () => {
      const html = readPage(dir(), 'entidades');
      const colors = html.indexOf('/js/theme-colors.js');
      const graph = html.indexOf('/js/infinite-bipartite-explorer.js');
      expect(colors).toBeGreaterThan(-1);
      expect(graph).toBeGreaterThan(colors);
    });
  });
});

// Version: v1.6.0
