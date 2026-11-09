/**
 * Level Order and Dublin Core Type Data Tests
 *
 * The level sort order (search page) and the level-to-Dublin-Core-type map
 * (METS generator) live in the descriptive-standard profiles as
 * language-independent keys: `level_order` (a list, because Hugo does not
 * keep YAML map order) and `dc_types`. These tests pin the values to what
 * the engine used when they were hard-coded in `search.js` and
 * `generate-mets.js`, and check that both consumers read the profiles.
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = require('js-yaml');
const { loadStandardData, dcTypeFor, clearCache } = require('../lib/standards.js');
const { makeLevelSort } = require('../themes/base/static/js/search.js');
const { buildMets, DC_TYPE_MAP } = require('../scripts/generate-mets.js');

const PREVIOUS_ORDER = ['fonds', 'subfonds', 'collection', 'section', 'series', 'subseries', 'file', 'volume', 'item'];
const PREVIOUS_TYPES = {
  fonds: 'Collection', subfonds: 'Collection', series: 'Collection', subseries: 'Collection',
  collection: 'Collection', section: 'Collection', file: 'Collection', item: 'Text', volume: 'Text',
};

describe('standards profiles carry level_order and dc_types', () => {
  for (const std of ['isadg', 'dacs', 'rad']) {
    it(`${std}: level_order is a list in the previous order`, () => {
      const data = yaml.load(fs.readFileSync(path.join(ROOT, 'themes/base/data/standards', `${std}.yaml`), 'utf8'));
      expect(Array.isArray(data.level_order)).toBe(true);
      expect(data.level_order).toEqual(PREVIOUS_ORDER);
    });
    it(`${std}: dc_types equals the previous map`, () => {
      expect(loadStandardData(std).dc_types).toEqual(PREVIOUS_TYPES);
    });
  }
});

describe('METS generator', () => {
  it('exports the ISAD(G) map from the profile', () => {
    expect(DC_TYPE_MAP).toEqual(PREVIOUS_TYPES);
  });
  it('writes the same dc:type for every current level', () => {
    for (const [level, type] of Object.entries(PREVIOUS_TYPES)) {
      const xml = buildMets({ reference_code: 'x', title: 't', description_level: level }, null,
        { creatorName: 'c', creatorNote: '', defaultRights: '' });
      expect(xml).toContain(`<dc:type>${type}</dc:type>`);
    }
  });
  it('leaves dc:type out for an unknown level', () => {
    const xml = buildMets({ reference_code: 'x', title: 't', description_level: 'caja' }, null,
      { creatorName: 'c', creatorNote: '', defaultRights: '' });
    expect(xml).not.toContain('<dc:type>');
  });
  it('takes the map from a site copy of the profile, key by key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-std-'));
    const dir = path.join(root, 'themes', 'mine', 'data', 'standards');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'isadg.yaml'), 'dc_types:\n  item: Image\nes: {}\n');
    clearCache();
    expect(dcTypeFor('isadg', 'item', root)).toBe('Image');
    expect(loadStandardData('isadg', root).level_order).toEqual(PREVIOUS_ORDER);
    clearCache();
  });
  it('reads the site copies in the order hugo.toml lists the themes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-std-order-'));
    const write = (dir, type) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'isadg.yaml'), `dc_types:\n  item: ${type}\nes: {}\n`);
    };
    write(path.join(root, 'themes', 'aaa', 'data', 'standards'), 'FromAaa');
    write(path.join(root, 'themes', 'zzz', 'data', 'standards'), 'FromZzz');
    fs.writeFileSync(path.join(root, 'hugo.toml'), 'title = "t"\ntheme = ["zzz", "aaa", "base"]\n');
    clearCache();
    expect(dcTypeFor('isadg', 'item', root)).toBe('FromZzz');
    clearCache();
  });
  it('falls back to isadg for an unknown standard', () => {
    expect(dcTypeFor('nope', 'fonds')).toBe('Collection');
  });
});

describe('search page level sort', () => {
  const entries = [['item', 5], ['zzz', 9], ['fonds', 1], ['aaa', 2], ['series', 3], ['file', 4]];
  it('puts known levels first in profile order, others by count', () => {
    const sorted = entries.slice().sort(makeLevelSort(PREVIOUS_ORDER)).map(e => e[0]);
    expect(sorted).toEqual(['fonds', 'series', 'file', 'item', 'zzz', 'aaa']);
  });
  it('sorts everything by count when no order is given', () => {
    const sorted = entries.slice().sort(makeLevelSort([])).map(e => e[0]);
    expect(sorted).toEqual(['zzz', 'item', 'file', 'series', 'aaa', 'fonds']);
  });
  it('search.js has no fixed level list', () => {
    const src = fs.readFileSync(path.join(ROOT, 'themes/base/static/js/search.js'), 'utf8');
    expect(src).not.toMatch(/'fonds',\s*'subfonds'/);
  });
  it('the search layout passes the order from the ISAD(G) profile', () => {
    const tpl = fs.readFileSync(path.join(ROOT, 'themes/base/layouts/buscar/list.html'), 'utf8');
    expect(tpl).toContain('data-level-order');
    expect(tpl).toContain('level_order');
  });
});

// Version: v1.6.0
