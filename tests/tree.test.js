/**
 * Collection Tree Tests
 *
 * Tests for the pure rules in `themes/base/static/js/tree.js`, the script
 * that draws the Miller-column collection tree, and for the data the tree
 * reads. The script is a classic browser file; it exports its rule functions
 * for Node only when `module` exists, so these tests need no DOM.
 *
 * Four groups:
 *
 *   1. Item numbers — the tree shows the record's `local_identifier`. A
 *      present value is shown, null or an empty string means no number, and
 *      a record that does not carry the field at all (an export that predates
 *      it) falls back to the deprecated parse of the reference code.
 *
 *   2. Child-count labels — the level comes from the record's
 *      `children_level`; when that is absent or null, from the most common
 *      `description_level` among the children the tree already holds; when
 *      neither is known, from the generic i18n unit. Checked in English and
 *      Spanish against the real standards profiles and i18n bundles, for
 *      all three profiles.
 *
 *   3. No hard-coded vocabulary — the script has no Spanish literals and no
 *      list of container words.
 *
 *   4. Root stubs — the repository page's first column carries
 *      `local_identifier` and `children_level` when the record has them.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { parse } = require('smol-toml');
const tree = require('../themes/base/static/js/tree.js');
const { deriveRootDescriptions } = require('../scripts/generate-content.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TREE_JS = path.join(ROOT, 'themes/base/static/js/tree.js');

/**
 * Build the strings the tree-strings partial writes into the page, from the
 * real profile and bundle files. Mirrors the partial: singular labels fall
 * back to the lowercased `levels` label when a profile has none.
 */
function stringsFor(standard, lang) {
  const profile = yaml.load(
    fs.readFileSync(path.join(ROOT, `themes/base/data/standards/${standard}.yaml`), 'utf8')
  )[lang];
  const bundle = parse(fs.readFileSync(path.join(ROOT, `themes/base/i18n/${lang}.toml`), 'utf8'));
  const singular = {};
  for (const key of Object.keys(profile.levelsPlural)) {
    singular[key] = profile.levelsSingular?.[key] || String(profile.levels[key] || '').toLowerCase();
  }
  return {
    locale: lang,
    i18n: {
      contentLabel: bundle.tree.contentLabel,
      filterPlaceholder: bundle.tree.filterPlaceholder,
      viewRecord: bundle.tree.viewRecord,
      childUnit: bundle.tree.childUnit,
    },
    levelsPlural: profile.levelsPlural,
    levelsSingular: singular,
  };
}

// ---------------------------------------------------------------------------
// 1. Item numbers
// ---------------------------------------------------------------------------

describe('itemNumber', () => {
  it('shows a present local_identifier', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003', local_identifier: 'D 3' })).toBe('D 3');
  });

  it('prefers local_identifier over anything the reference code would give', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003', local_identifier: 'fol. 12' })).toBe('fol. 12');
  });

  it('shows no number when local_identifier is null, with no fallback', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003', local_identifier: null })).toBeNull();
  });

  it('shows no number when local_identifier is the empty string, with no fallback', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003', local_identifier: '' })).toBeNull();
  });

  it('treats whitespace alone as empty', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003', local_identifier: '  ' })).toBeNull();
  });

  it('falls back to the reference-code parse when the field is absent altogether', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-d003' })).toBe('003');
    expect(tree.itemNumber({ reference_code: 'xx-arch-001-n007' })).toBe('007');
    expect(tree.itemNumber({ reference_code: 'xx-arch-box001-fold002-004' })).toBe('004');
  });

  it('gives no number from the fallback when the code has no number', () => {
    expect(tree.itemNumber({ reference_code: 'xx-arch-letters' })).toBeNull();
    expect(tree.itemNumber({ reference_code: null })).toBeNull();
  });

  it('keeps the fallback in one function named as deprecated', () => {
    expect(typeof tree.deprecatedNumberFromReferenceCode).toBe('function');
    const src = fs.readFileSync(TREE_JS, 'utf8');
    expect(src).toMatch(/deprecated[\s\S]{0,200}2\.0\.0/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Child-count labels
// ---------------------------------------------------------------------------

describe('childLevelKey', () => {
  it('uses the record children_level when present', () => {
    const item = { children_level: 'file' };
    expect(tree.childLevelKey(item, [{ description_level: 'item' }])).toBe('file');
  });

  it('uses the most common description_level of the loaded children when children_level is null', () => {
    const kids = [
      { description_level: 'item' },
      { description_level: 'file' },
      { description_level: 'item' },
    ];
    expect(tree.childLevelKey({ children_level: null }, kids)).toBe('item');
  });

  it('does the same when children_level is absent', () => {
    expect(tree.childLevelKey({}, [{ description_level: 'series' }])).toBe('series');
  });

  it('returns null when nothing is known', () => {
    expect(tree.childLevelKey({ children_level: null }, undefined)).toBeNull();
    expect(tree.childLevelKey({}, [])).toBeNull();
    expect(tree.childLevelKey({}, [{ description_level: null }, {}])).toBeNull();
  });
});

describe('childCountText', () => {
  const cases = [
    ['isadg', 'en', 'file', '1 file', '12 files'],
    ['isadg', 'es', 'file', '1 expediente', '12 expedientes'],
    ['dacs', 'en', 'item', '1 item', '12 items'],
    ['dacs', 'es', 'item', '1 [STUB] documento', '12 [STUB] documentos'],
    ['rad', 'en', 'subseries', '1 [STUB] subseries', '12 [STUB] subseries'],
    ['rad', 'es', 'collection', '1 [STUB] colección', '12 [STUB] colecciones'],
  ];

  for (const [standard, lang, level, one, many] of cases) {
    it(`${standard} ${lang}: ${level} gives "${one}" and "${many}"`, () => {
      const s = stringsFor(standard, lang);
      expect(tree.childCountText(1, level, s)).toBe(one);
      expect(tree.childCountText(12, level, s)).toBe(many);
    });
  }

  it('uses the generic unit when no level is known, in English', () => {
    const s = stringsFor('isadg', 'en');
    expect(tree.childCountText(1, null, s)).toBe('1 unit');
    expect(tree.childCountText(12, null, s)).toBe('12 units');
  });

  it('uses the generic unit when no level is known, in Spanish', () => {
    const s = stringsFor('isadg', 'es');
    expect(tree.childCountText(1, null, s)).toBe('1 unidad');
    expect(tree.childCountText(12, null, s)).toBe('12 unidades');
  });

  it('uses the generic unit for a level the profile does not name', () => {
    const s = stringsFor('isadg', 'en');
    expect(tree.childCountText(3, 'no-such-level', s)).toBe('3 units');
  });

  it('formats large counts with the locale and still picks the plural', () => {
    const s = stringsFor('isadg', 'en');
    expect(tree.childCountText(1234, 'file', s)).toBe('1,234 files');
  });

  it('shows the bare number when the page carries no strings at all', () => {
    expect(tree.childCountText(5, 'file', { locale: 'en' })).toBe('5');
  });
});

describe('every profile names every level in both forms, in both languages', () => {
  for (const standard of ['isadg', 'dacs', 'rad']) {
    for (const lang of ['en', 'es']) {
      it(`${standard} ${lang}: levelsSingular covers levelsPlural`, () => {
        const profile = yaml.load(
          fs.readFileSync(path.join(ROOT, `themes/base/data/standards/${standard}.yaml`), 'utf8')
        )[lang];
        expect(profile.levelsSingular, 'levelsSingular must exist').toBeDefined();
        expect(Object.keys(profile.levelsSingular).sort()).toEqual(Object.keys(profile.levelsPlural).sort());
        for (const label of Object.values(profile.levelsSingular)) {
          expect(typeof label).toBe('string');
          expect(label.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. No hard-coded vocabulary in the script
// ---------------------------------------------------------------------------

describe('tree.js carries no corpus vocabulary', () => {
  const src = fs.readFileSync(TREE_JS, 'utf8');

  it('has no container word list', () => {
    expect(src).not.toMatch(/\b(caja|carpeta|legajo|tomo)\b/i);
  });

  it('has no Spanish interface literals', () => {
    expect(src).not.toMatch(/Ver registro|unidades?\b|Filtrar|Contenido/);
  });

  it('cites no real reference code in its comments', () => {
    expect(src).not.toMatch(/co-ahr/);
  });
});

// ---------------------------------------------------------------------------
// 4. Root stubs on the repository page
// ---------------------------------------------------------------------------

describe('deriveRootDescriptions', () => {
  const base = {
    reference_code: 'xx-arch-001',
    title: 'Root',
    description_level: 'fonds',
    repository_code: 'xx',
    parent_id: null,
  };

  it('passes children_level and local_identifier through when the record has them', () => {
    const roots = deriveRootDescriptions([
      { id: 1, ...base, children_level: 'series', local_identifier: 'F 1' },
    ]).get('xx');
    expect(roots[0].children_level).toBe('series');
    expect(roots[0].local_identifier).toBe('F 1');
  });

  it('keeps null as null', () => {
    const roots = deriveRootDescriptions([
      { id: 1, ...base, children_level: null, local_identifier: null },
    ]).get('xx');
    expect(roots[0].children_level).toBeNull();
    expect(roots[0].local_identifier).toBeNull();
  });

  it('leaves both keys out when the record does not carry them', () => {
    const roots = deriveRootDescriptions([{ id: 1, ...base }]).get('xx');
    expect('children_level' in roots[0]).toBe(false);
    expect('local_identifier' in roots[0]).toBe(false);
  });
});

// Version: v1.6.0
