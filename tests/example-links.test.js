/**
 * Explorer Logo and Example Links — Hugo Render Tests
 *
 * The entity explorer's empty state, the places explorer's intro and the
 * search landing show material that belongs to the site, not the engine:
 * the site's logo (site.Params.logo) and a short run of example entities and
 * places (site.Params.entity_examples, site.Params.place_examples). A fork
 * that sets none of them must get pages with no broken image and no buttons
 * pointing at records it does not hold.
 *
 * These tests render the real templates through Hugo, with the smoke-instance
 * build in tests/helpers/smoke-build.js, once with the settings and once
 * without.
 *
 * Behaviors asserted:
 *
 *   1. With a logo set, the entity empty state shows it, and the search page
 *      hands it to search.js in data-logo.
 *   2. With examples set, the entity empty state and the places intro render
 *      one button per complete example, carrying its code, joined as
 *      "A, B or C." after the introducing sentence. An example without a
 *      code or a label is skipped.
 *   3. On a Spanish site, the conjunction before the last example becomes
 *      "u" when that label starts with an /o/ sound (Ospina, Honda, Óbuda)
 *      and stays "o" before a /w/ sound (Huila) or any other start.
 *   4. Without the settings, no logo image, no data-logo, no example button
 *      and no introducing sentence appear, and no page names the old
 *      Neogranadina logo file.
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
 * Return the inner HTML of the entity explorer's empty state.
 */
function emptyState(html) {
  const m = html.match(/<div id="?graph-empty-state"?[^>]*>([\s\S]*?)<\/section>/);
  if (!m) throw new Error('graph-empty-state not found in rendered page');
  return m[1];
}

/**
 * Return the inner HTML of the places explorer's intro paragraph.
 */
function placeIntro(html) {
  const m = html.match(/<p class="?explorer-page-intro"?>([\s\S]*?)<\/p>/);
  if (!m) throw new Error('explorer-page-intro not found in rendered page');
  return m[1];
}

/**
 * Return the text of a fragment with tags removed and spaces collapsed.
 */
function text(fragment) {
  return fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Return every value of a data attribute in a fragment (minified HTML may
 * drop the attribute quotes).
 */
function attrValues(fragment, attr) {
  const re = new RegExp(`${attr}=(?:"([^"]*)"|([^\\s>]+))`, 'g');
  return [...fragment.matchAll(re)].map((m) => m[1] ?? m[2]);
}

// ---------------------------------------------------------------------------
// With the settings
// ---------------------------------------------------------------------------

describe('Explorer logo and examples — settings present', () => {
  let dir;

  beforeAll(() => {
    dir = buildSmokeInstance([
      '[params]',
      '  logo = "/img/site-mark.svg"',
      '  entity_examples = [',
      '    { code = "ne-smoke-p1", label = "First Entity" },',
      '    { code = "ne-smoke-p2", label = "Second Entity" },',
      '    { label = "No Code" },',
      '    { code = "ne-smoke-p3", label = "Third Entity" },',
      '  ]',
      '  place_examples = [',
      '    { code = "nl-smoke-p1", label = "First Place" },',
      '    { code = "nl-smoke-p2" },',
      '  ]',
    ].join('\n'), { prefix: 'zasqua-example-links-test-' });
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('entity empty state shows the site logo', () => {
    const state = emptyState(readPage(dir, 'entidades'));
    expect(attrValues(state, 'src')).toEqual(['/img/site-mark.svg']);
  });

  it('search page hands the logo to search.js', () => {
    expect(attrValues(readPage(dir, 'buscar'), 'data-logo')).toEqual(['/img/site-mark.svg']);
  });

  it('entity empty state lists the complete examples, joined', () => {
    const state = emptyState(readPage(dir, 'entidades'));
    expect(attrValues(state, 'data-entity')).toEqual(['ne-smoke-p1', 'ne-smoke-p2', 'ne-smoke-p3']);
    expect(text(state)).toContain(
      'Or start with one of these examples: First Entity, Second Entity or Third Entity.'
    );
  });

  it('places intro lists a single complete example', () => {
    const intro = placeIntro(readPage(dir, 'lugares'));
    expect(attrValues(intro, 'data-place')).toEqual(['nl-smoke-p1']);
    expect(text(intro)).toMatch(/Try First Place\.$/);
  });
});

// ---------------------------------------------------------------------------
// Spanish conjunction before an /o/ sound
// ---------------------------------------------------------------------------

describe('Explorer examples — Spanish "u" before an /o/ sound', () => {
  const cases = [
    ['Ospina', 'u'],
    ['Honda', 'u'],
    ['Óbuda', 'u'],
    ['Huila', 'o'],
    ['Cali', 'o'],
  ];
  let dir;

  beforeAll(() => {
    // The site is switched to Spanish. Each case gets a hand-written page
    // whose layout calls the partial with a two-item list ending on that
    // case's label, so the five cases share one build; the explorer pages
    // check that both callers pass the second key.
    dir = buildSmokeInstance([
      '[params]',
      '  entity_examples = [',
      '    { code = "ne-smoke-p1", label = "Primera" },',
      '    { code = "ne-smoke-p2", label = "Ospina" },',
      '  ]',
      '  place_examples = [',
      '    { code = "nl-smoke-p1", label = "Primero" },',
      '    { code = "nl-smoke-p2", label = "Huila" },',
      '  ]',
    ].join('\n'), {
      prefix: 'zasqua-example-links-test-',
      prepare: (instance) => {
        const hugoPath = path.join(instance, 'hugo.toml');
        const hugo = fs.readFileSync(hugoPath, 'utf8')
          .replace(/^languageCode = .*$/m, 'languageCode = "es-CO"')
          .replace(/^defaultContentLanguage = .*$/m, 'defaultContentLanguage = "es"');
        fs.writeFileSync(hugoPath, hugo, 'utf8');
        const layoutDir = path.join(instance, 'layouts', 'conj-case');
        fs.mkdirSync(layoutDir, { recursive: true });
        fs.writeFileSync(path.join(layoutDir, 'single.html'), [
          '<p id="case">{{ partial "example-links.html" (dict',
          '  "items" (slice (dict "code" "a" "label" "Primera") (dict "code" "b" "label" .Params.last))',
          '  "attr" "data-entity"',
          '  "conj" (i18n "entity.emptyState.examplesConj")',
          '  "conjBeforeO" (i18n "entity.emptyState.examplesConjBeforeO")) }}</p>',
        ].join('\n'), 'utf8');
        const contentDir = path.join(instance, 'content', 'conj-case');
        fs.mkdirSync(contentDir, { recursive: true });
        cases.forEach(([last], i) => {
          fs.writeFileSync(path.join(contentDir, `c${i}.md`), [
            '---',
            `title: "Case ${i}"`,
            `last: "${last}"`,
            `url: "/conj-case-${i}/"`,
            '---',
            '',
          ].join('\n'), 'utf8');
        });
      },
    });
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(cases.map((c, i) => [...c, i]))('before %s the conjunction is "%s"', (last, conj, i) => {
    const html = readPage(dir, `conj-case-${i}`);
    expect(text(html)).toContain(`Primera ${conj} ${last}.`);
  });

  it('entity empty state and places intro use the same rule', () => {
    expect(text(emptyState(readPage(dir, 'entidades')))).toContain('Primera u Ospina.');
    expect(text(placeIntro(readPage(dir, 'lugares')))).toContain('Primero o Huila.');
  });
});

// ---------------------------------------------------------------------------
// Without the settings
// ---------------------------------------------------------------------------

describe('Explorer logo and examples — settings absent', () => {
  let dir;

  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-example-links-test-' });
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('entity empty state has no image, button or introducing sentence', () => {
    const state = emptyState(readPage(dir, 'entidades'));
    expect(state).not.toContain('<img');
    expect(state).not.toContain('data-entity');
    expect(text(state)).not.toContain('Or start with one of these examples');
    expect(text(state)).toContain('filter the index by type and date.');
  });

  it('places intro has no button or introducing word', () => {
    const intro = placeIntro(readPage(dir, 'lugares'));
    expect(intro).not.toContain('data-place');
    expect(text(intro)).not.toMatch(/\bTry\b/);
  });

  it('search page carries no data-logo', () => {
    expect(readPage(dir, 'buscar')).not.toContain('data-logo');
  });

  it('no page names the old Neogranadina logo file', () => {
    for (const slug of ['entidades', 'lugares', 'buscar']) {
      expect(readPage(dir, slug)).not.toContain('zasqua-3-burgundy');
    }
  });
});

// Version: v1.6.0
