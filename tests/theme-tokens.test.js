/**
 * Neutral Theme Tokens — Unit Tests
 *
 * The base theme names its colour tokens by role (`primary`, `accent`, ...)
 * and keeps the older palette names (`burgundy`, `periwinkle`, ...) as
 * deprecated aliases. These tests compile the real `base.css` through
 * Tailwind v4 (the same compiler Hugo's css.TailwindCSS pipe calls), with
 * a site token block appended the way an overlay theme's `tokens.css` is
 * imported after `base.css`, and then resolve every `var()` the way a
 * browser does to check which colour each token and utility class ends
 * up with.
 *
 * Behaviors asserted:
 *
 *   1. A site that sets only the old palette names (the token block an
 *      existing overlay ships) gets those colours on the new tokens, on the
 *      old utility classes, and on the graph and map tokens.
 *   2. A site that sets only the new names gets them on the old utility
 *      classes too.
 *   3. A site that sets neither gets the base theme's neutral greys.
 *   4. Every old utility class an overlay may use still compiles.
 *   5. The base layouts and the base stylesheet's own rules use only the
 *      new names.
 *   6. The graph and map scripts carry no palette hex value and no old
 *      token name; they read colours through `theme-colors.js`, which
 *      returns the token's value or a neutral default.
 *   7. The graph scripts draw canvas labels in the font family computed
 *      for the graph's container, read through `theme-colors.js`, with a
 *      generic sans-serif when none is computed; no family name is
 *      written into the scripts.
 *
 * Tailwind emits a theme variable only when something uses it, so each
 * scenario passes the utility classes it checks as candidates, as Hugo
 * does from hugo_stats.json.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { compile } from '@tailwindcss/node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.join(__dirname, '..');
const BASE_CSS = path.join(ENGINE_ROOT, 'themes/base/assets/css/base.css');
const JS_DIR = path.join(ENGINE_ROOT, 'themes/base/static/js');
const LAYOUTS = path.join(ENGINE_ROOT, 'themes/base/layouts');

// The token block an existing overlay ships: old palette names only.
const OLD_NAMES_SITE = `
@theme {
  --color-burgundy: #8B2942;
  --color-burgundy-deep: #6B1F33;
  --color-burgundy-light: #B14D66;
  --color-burgundy-dark: #4A1522;
  --color-pale-rose: #F5E6EA;
  --color-ochre: #C5965F;
  --color-sage: #8A9B8E;
  --color-periwinkle: #C9D5FF;
  --color-bg: #FAFAF9;
}
`;

const NEW_NAMES_SITE = `
@theme {
  --color-primary: #123456;
  --color-primary-deep: #0a1f33;
  --color-primary-light: #4a6f99;
  --color-primary-dark: #050f1a;
  --color-primary-pale: #e8eef5;
  --color-secondary: #997700;
  --color-tertiary: #557755;
  --color-accent: #ffcc00;
  --color-bg: #fefefe;
}
`;

const OLD_UTILITIES = [
  'bg-burgundy', 'bg-burgundy-deep', 'bg-burgundy-light', 'bg-burgundy-dark',
  'bg-pale-rose', 'bg-ochre', 'bg-sage', 'bg-periwinkle',
  'text-burgundy', 'hover:text-burgundy-light', 'hover:text-periwinkle',
  'hover:bg-burgundy',
];
const NEW_UTILITIES = [
  'bg-primary', 'bg-primary-deep', 'bg-primary-light', 'bg-primary-dark',
  'bg-primary-pale', 'bg-secondary', 'bg-tertiary', 'bg-accent',
  'text-primary', 'hover:text-primary-light', 'hover:text-accent',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildCss(siteTokens) {
  const css = fs.readFileSync(BASE_CSS, 'utf8') + '\n' + siteTokens;
  const compiler = await compile(css, { base: ENGINE_ROOT, onDependency() {} });
  return compiler.build([...OLD_UTILITIES, ...NEW_UTILITIES]);
}

/**
 * Collect the custom properties declared on :root in compiled CSS, in
 * source order, so a later declaration wins as it does in the cascade
 * (all :root rules here have the same specificity, and the theme layer
 * comes before the unlayered :root rules).
 */
function rootProperties(css) {
  const props = {};
  const blockRe = /(?:^|[\s}])(:root(?:,\s*:host)?)\s*\{([^{}]*)\}/g;
  for (const m of css.matchAll(blockRe)) {
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      props[d[1]] = d[2].trim();
    }
  }
  return props;
}

/**
 * Substitute var() references the way a browser computes a custom
 * property: the referenced value if defined, else the fallback.
 */
function resolve(value, props, depth = 0) {
  if (depth > 20) throw new Error('var() cycle: ' + value);
  const re = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/;
  let out = value;
  let m;
  while ((m = out.match(re))) {
    const ref = props[m[1]];
    const replacement = ref !== undefined
      ? resolve(ref, props, depth + 1)
      : (m[2] !== undefined ? resolve(m[2].trim(), props, depth + 1) : '<unset>');
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
  }
  return out;
}

function token(css, name) {
  const props = rootProperties(css);
  if (props[name] === undefined) return '<unset>';
  return resolve(props[name], props);
}

/**
 * Return the resolved value of `property` in the rule for a utility class.
 */
function utility(css, cls, property) {
  const escaped = cls.replace(/:/g, '\\\\:');
  const re = new RegExp('\\.' + escaped + '\\s*\\{([\\s\\S]*?)\\}');
  const m = css.match(re);
  if (!m) return '<missing>';
  const d = m[1].match(new RegExp(property + '\\s*:\\s*([^;]+);'));
  if (!d) return '<missing>';
  return resolve(d[1].trim(), rootProperties(css));
}

// ---------------------------------------------------------------------------
// Compiled-token scenarios
// ---------------------------------------------------------------------------

describe('Site sets only the old palette names', () => {
  let css;
  beforeAll(async () => { css = await buildCss(OLD_NAMES_SITE); });

  it('new tokens take the old colours', () => {
    expect(token(css, '--color-primary')).toBe('#8B2942');
    expect(token(css, '--color-primary-deep')).toBe('#6B1F33');
    expect(token(css, '--color-primary-light')).toBe('#B14D66');
    expect(token(css, '--color-primary-dark')).toBe('#4A1522');
    expect(token(css, '--color-accent')).toBe('#C9D5FF');
    expect(token(css, '--color-bg')).toBe('#FAFAF9');
  });

  it('old utility classes keep their colours', () => {
    expect(utility(css, 'bg-burgundy-dark', 'background-color')).toBe('#4A1522');
    expect(utility(css, 'hover:text-periwinkle', 'color')).toBe('#C9D5FF');
    expect(utility(css, 'hover:text-burgundy-light', 'color')).toBe('#B14D66');
    expect(utility(css, 'bg-pale-rose', 'background-color')).toBe('#F5E6EA');
    expect(utility(css, 'bg-ochre', 'background-color')).toBe('#C5965F');
    expect(utility(css, 'bg-sage', 'background-color')).toBe('#8A9B8E');
  });

  it('graph and map tokens come out as the colours the scripts used to hard-code', () => {
    expect(token(css, '--graph-person')).toBe('#8B2942');
    expect(token(css, '--graph-corporate')).toBe('#6666BB');
    expect(token(css, '--graph-document')).toBe('#A09888');
    expect(token(css, '--graph-document-hover')).toBe('#807060');
    expect(token(css, '--graph-document-dimmed')).toBe('#E8E4E0');
    expect(token(css, '--graph-entity-dimmed')).toBe('#DDD8E0');
    expect(token(css, '--graph-node-fill')).toBe('#FAFAF9');
    expect(token(css, '--graph-link')).toBe('#E0DDD8');
    expect(token(css, '--graph-link-faint')).toBe('rgba(160, 152, 136, 0.3)');
    expect(token(css, '--map-marker')).toBe('#8B2942');
  });
});

describe('Site sets only the new names', () => {
  let css;
  beforeAll(async () => { css = await buildCss(NEW_NAMES_SITE); });

  it('old utility classes follow the new names', () => {
    expect(utility(css, 'bg-burgundy', 'background-color')).toBe('#123456');
    expect(utility(css, 'bg-burgundy-dark', 'background-color')).toBe('#050f1a');
    expect(utility(css, 'hover:text-periwinkle', 'color')).toBe('#ffcc00');
    expect(utility(css, 'bg-pale-rose', 'background-color')).toBe('#e8eef5');
    expect(utility(css, 'bg-ochre', 'background-color')).toBe('#997700');
    expect(utility(css, 'bg-sage', 'background-color')).toBe('#557755');
  });

  it('new utility classes and graph tokens take the new names', () => {
    expect(utility(css, 'bg-primary', 'background-color')).toBe('#123456');
    expect(token(css, '--graph-person')).toBe('#123456');
    expect(token(css, '--map-marker')).toBe('#123456');
    expect(token(css, '--graph-node-fill')).toBe('#fefefe');
  });
});

describe('Site sets no colour tokens', () => {
  let css;
  beforeAll(async () => { css = await buildCss(''); });

  it('tokens and both sets of utility classes resolve to the neutral greys', () => {
    expect(token(css, '--color-primary')).toBe('#888');
    expect(token(css, '--color-accent')).toBe('#ddd');
    expect(utility(css, 'bg-burgundy', 'background-color')).toBe('#888');
    expect(utility(css, 'bg-primary', 'background-color')).toBe('#888');
    expect(token(css, '--graph-person')).toBe('#888');
    expect(token(css, '--graph-node-fill')).toBe('#ffffff');
  });

  it('every old and new utility class compiles', () => {
    for (const cls of [...OLD_UTILITIES, ...NEW_UTILITIES]) {
      const property = cls.includes('text-') ? 'color' : 'background-color';
      expect(utility(css, cls, property), cls).not.toMatch(/<missing>|<unset>/);
    }
  });
});

// ---------------------------------------------------------------------------
// Source checks
// ---------------------------------------------------------------------------

const OLD_NAME_RE = /burgundy|periwinkle|pale-rose|ochre|\bsage\b/;

describe('Base theme uses only the new names', () => {
  it('no base layout uses an old token name or utility class', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.html')) {
          fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            if (/(?:class=|style=|var\()[^\n]*?(burgundy|periwinkle|pale-rose|ochre)/.test(line)
                || /(?:text|bg|border)-sage\b/.test(line)) {
              offenders.push(`${path.relative(ENGINE_ROOT, p)}:${i + 1}`);
            }
          });
        }
      }
    };
    walk(LAYOUTS);
    expect(offenders).toEqual([]);
  });

  it('base.css names an old token only in the alias declarations', () => {
    const lines = fs.readFileSync(BASE_CSS, 'utf8').split('\n');
    const offenders = lines
      .map((line, i) => [line, i + 1])
      .filter(([line]) => /var\(--color-(burgundy|periwinkle|pale-rose|ochre|sage)/.test(line)
        || /@apply[^;]*(burgundy|periwinkle|pale-rose|ochre|sage)/.test(line))
      // The alias declarations: a new token falling back to its old name.
      .filter(([line]) => !/^\s*--color-(primary|secondary|tertiary|accent)[\w-]*:\s*var\(--color-/.test(line))
      .map(([, n]) => n);
    expect(offenders).toEqual([]);
  });
});

const GRAPH_SCRIPTS = [
  'entity.js', 'entity-explorer.js', 'infinite-bipartite-explorer.js',
  'place.js', 'place-explorer.js',
];
const PALETTE_HEX_RE = /#(8B2942|6666BB|A09888|E8E4E0|807060|FAFAF9|DDD8E0|E0DDD8)\b|rgba\(\s*160\s*,\s*152\s*,\s*136/i;

describe('Graph and map scripts read colours from tokens', () => {
  for (const file of GRAPH_SCRIPTS) {
    it(`${file} holds no palette hex value and no old token name`, () => {
      const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
      const hits = src.split('\n')
        .map((line, i) => [line, i + 1])
        .filter(([line]) => PALETTE_HEX_RE.test(line) || /--color-(burgundy|periwinkle)/.test(line))
        .map(([line, n]) => `${n}: ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});

describe('theme-colors.js', () => {
  function sandbox(props, fonts = new Map()) {
    const src = fs.readFileSync(path.join(JS_DIR, 'theme-colors.js'), 'utf8');
    const documentElement = {};
    const body = {};
    const context = {
      document: { documentElement, body },
      getComputedStyle(el) {
        return {
          // The key 'body' stands for document.body, which the sandbox creates.
          fontFamily: fonts.get(el === body ? 'body' : el) || '',
          getPropertyValue: (name) => {
            expect(el).toBe(documentElement);
            return props[name] !== undefined ? props[name] : '';
          },
        };
      },
    };
    context.window = context;
    vm.runInNewContext(src, context);
    return context;
  }

  function load(props) {
    return sandbox(props).zasquaThemeColor;
  }

  it('returns the trimmed token value when the stylesheet sets it', () => {
    const color = load({ '--graph-person': ' #8B2942' });
    expect(color('graph-person')).toBe('#8B2942');
  });

  it('returns a neutral default when the stylesheet does not set the token', () => {
    const color = load({});
    for (const name of ['graph-person', 'graph-corporate', 'graph-document', 'graph-document-hover',
      'graph-document-dimmed', 'graph-entity-dimmed', 'graph-node-fill', 'graph-link',
      'graph-link-faint', 'map-marker']) {
      const value = color(name);
      expect(value, name).toBeTruthy();
      expect(value, name).not.toMatch(PALETTE_HEX_RE);
    }
  });

  it('returns the font family the given element is drawn in', () => {
    const canvasHost = {};
    const family = '"DM Sans", ui-sans-serif, system-ui, sans-serif';
    const ctx = sandbox({}, new Map([[canvasHost, family]]));
    expect(ctx.zasquaThemeFont(canvasHost)).toBe(family);
  });

  it('reads the body font when no element is given', () => {
    const ctx = sandbox({}, new Map([['body', 'Georgia, serif']]));
    expect(ctx.zasquaThemeFont()).toBe('Georgia, serif');
  });

  it('falls back to a generic sans-serif when no family is computed', () => {
    const ctx = sandbox({});
    expect(ctx.zasquaThemeFont({})).toBe('sans-serif');
  });
});

describe('Graph label font', () => {
  for (const file of ['entity.js', 'infinite-bipartite-explorer.js']) {
    it(`${file} draws labels in the page font, not a named family`, () => {
      const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
      expect(src).not.toMatch(/DM Sans/);
      expect(src).toMatch(/zasquaThemeFont/);
    });
  }
});

// Version: v1.6.0
