/**
 * Generate Linked Places Unit Tests
 *
 * Tests for the pure builder in `scripts/generate-places.js`, which writes one
 * Linked Places Format (LPF v1.3) record per place (the `zasqua places`
 * command). The generator gives every place in the place contract a
 * gazetteer record that the World Historical Gazetteer and other LPF
 * consumers can ingest, with no institution-specific text baked in.
 *
 * Behaviors covered:
 *   1. Identity and required members — @id is the place page URL, type is
 *      "Feature", properties carry title and fclasses, and the keys come in
 *      LPF order.
 *   2. Site base URL — normalised to exactly one trailing slash.
 *   3. Names — one name from display_name, cited to the site, with lang only
 *      when a language is configured.
 *   4. Geometry — a GeoJSON Point [longitude, latitude] when both
 *      coordinates are present, null when both are absent; one coordinate,
 *      a string coordinate or an out-of-range coordinate throws, naming the
 *      record.
 *   5. fclass — upper-cased when it is one of the seven LPF classes,
 *      otherwise a throw naming the record.
 *   6. Required fields — a blank place_code or display_name, or a code that
 *      is not an NMTOKEN, throws.
 *   7. No institution string and no date in the output.
 *   8. Types — city, river and region map to Getty AAT feature types; any
 *      other place_type leaves types out.
 *   9. Further names — label (when it differs from display_name) and the
 *      name variants, trimmed and deduplicated, without citations; a
 *      non-array name_variants throws, naming the record.
 *  10. Links — closeMatch links to WHG, TGN and Wikidata in that order; an
 *      id that does not match its pattern is dropped with a warning, and
 *      hgis_id is never emitted.
 *  11. Attested years — the year range of the dated descriptions linked to
 *      each place, and the `when` it becomes on the feature (end omitted
 *      when it equals start).
 *  12. Config — readPlacesConfig reads baseURL, title, places_language and
 *      places_base_url from hugo.toml, trimmed, with neutral defaults.
 *  13. Filenames and per-record plan — placesSlug, and planPlaceRecord
 *      refusing the reserved slug "index" and a case-insensitive repeat.
 *  14. Collections and serialization — buildFeatureCollection and serialize.
 *  15. isUnderPublic / isUnderDir — the off-domain check matches public/
 *      and its subdirectories, not a sibling such as public-staging, and
 *      treats a child named "..x" as inside.
 *  16. readDescriptionDates — descriptions.json parsed keeping only the
 *      fields attestedYears reads.
 *
 * @version v1.5.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  buildPlaceFeature, attestedYears, readPlacesConfig, placesSlug, planPlaceRecord,
  buildFeatureCollection, serialize, LPF_CONTEXT, isUnderPublic, readDescriptionDates,
} = require('../scripts/generate-places.js');
const { isUnderDir } = require('../lib/under-dir.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PLACE = {
  id: 101787,
  place_code: 'nl-qfsbu',
  label: 'Abades',
  display_name: 'Abades',
  place_type: 'city',
  fclass: 'P',
  latitude: 1.4,
  longitude: -77.2,
  country_code: '',
  name_variants: [],
  wikidata_id: '',
  whg_id: '',
  tgn_id: '',
  hgis_id: '',
  admin_level_1: '',
  admin_level_2: '',
  colonial_gobernacion: '',
  colonial_partido: '',
  colonial_region: '',
  modified_at: '2026-04-14',
};

const OPTS = { siteBaseUrl: 'https://example.com/', siteTitle: 'Smoke Test Archive', language: 'en' };

describe('buildPlaceFeature — identity and required members', () => {
  it('emits @id as the place page URL, type Feature, title and fclasses, in that key order', () => {
    const f = buildPlaceFeature(PLACE, OPTS);
    expect(Object.keys(f)).toEqual(['@id', 'type', 'properties', 'names', 'types', 'geometry']);
    expect(f['@id']).toBe('https://example.com/nl-qfsbu/');
    expect(f.type).toBe('Feature');
    expect(f.properties).toEqual({ title: 'Abades', fclasses: ['P'] });
  });
  it('normalises the site base URL to one trailing slash', () => {
    expect(buildPlaceFeature(PLACE, { ...OPTS, siteBaseUrl: 'https://example.com' })['@id']).toBe('https://example.com/nl-qfsbu/');
    expect(buildPlaceFeature(PLACE, { ...OPTS, siteBaseUrl: 'https://example.com//' })['@id']).toBe('https://example.com/nl-qfsbu/');
  });
  it('emits one name with the site as its citation, with lang only when configured', () => {
    const f = buildPlaceFeature(PLACE, OPTS);
    expect(f.names).toEqual([{ toponym: 'Abades', lang: 'en', citations: [{ label: 'Smoke Test Archive', '@id': 'https://example.com/nl-qfsbu/' }] }]);
    expect(buildPlaceFeature(PLACE, { ...OPTS, language: null }).names[0]).not.toHaveProperty('lang');
  });
  it('emits a Point [longitude, latitude] when both coordinates are present, null when both are absent', () => {
    expect(buildPlaceFeature(PLACE, OPTS).geometry).toEqual({ type: 'Point', coordinates: [-77.2, 1.4] });
    expect(buildPlaceFeature({ ...PLACE, latitude: null, longitude: null }, OPTS).geometry).toBeNull();
  });
  it('throws, naming the record, on one coordinate, a string coordinate, or an out-of-range coordinate', () => {
    expect(() => buildPlaceFeature({ ...PLACE, longitude: null }, OPTS)).toThrow(/nl-qfsbu.*coordinates/);
    expect(() => buildPlaceFeature({ ...PLACE, latitude: '1.4' }, OPTS)).toThrow(/nl-qfsbu.*coordinates/);
    expect(() => buildPlaceFeature({ ...PLACE, latitude: 91 }, OPTS)).toThrow(/nl-qfsbu.*coordinates/);
  });
  it('upper-cases a known fclass and throws on an unknown one', () => {
    expect(buildPlaceFeature({ ...PLACE, fclass: 'h' }, OPTS).properties.fclasses).toEqual(['H']);
    expect(() => buildPlaceFeature({ ...PLACE, fclass: 'X' }, OPTS)).toThrow(/nl-qfsbu.*fclass/);
    expect(() => buildPlaceFeature({ ...PLACE, fclass: '' }, OPTS)).toThrow(/nl-qfsbu.*fclass/);
  });
  it('throws on a blank place_code or display_name, or a code that is not an NMTOKEN', () => {
    expect(() => buildPlaceFeature({ ...PLACE, place_code: '' }, OPTS)).toThrow(/missing place_code/);
    expect(() => buildPlaceFeature({ ...PLACE, display_name: ' ' }, OPTS)).toThrow(/nl-qfsbu.*missing display_name/);
    expect(() => buildPlaceFeature({ ...PLACE, place_code: 'nl a/b' }, OPTS)).toThrow(/NMTOKEN/);
  });
  it('contains no institution string and no date', () => {
    const s = JSON.stringify(buildPlaceFeature(PLACE, OPTS));
    // \bAMPL: the fixture URL example.com itself contains "ampl".
    expect(s).not.toMatch(/Neogranadina|UCSB|\bAMPL/i);
    expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('buildPlaceFeature — types', () => {
  it('matches place_type case-insensitively after trimming', () => {
    expect(buildPlaceFeature({ ...PLACE, place_type: ' City ' }, OPTS).types).toEqual(buildPlaceFeature({ ...PLACE, place_type: 'city' }, OPTS).types);
  });
  it('maps city, river and region to AAT identifiers and omits types for other', () => {
    expect(buildPlaceFeature(PLACE, OPTS).types).toEqual([{ identifier: 'http://vocab.getty.edu/aat/300008347', label: 'inhabited places' }]);
    expect(buildPlaceFeature({ ...PLACE, place_type: 'river', fclass: 'H' }, OPTS).types[0].identifier).toBe('http://vocab.getty.edu/aat/300008707');
    expect(buildPlaceFeature({ ...PLACE, place_type: 'other' }, OPTS)).not.toHaveProperty('types');
  });
});
describe('buildPlaceFeature — further names', () => {
  it('adds label when it differs from display_name, then variants, deduplicated and trimmed, without citations', () => {
    const f = buildPlaceFeature({ ...PLACE, label: 'Abades (Pasto)', name_variants: [' Abades ', 'Abadés', 'Abadés', '', null] }, OPTS);
    expect(f.names.map(n => n.toponym)).toEqual(['Abades', 'Abades (Pasto)', 'Abadés']);
    expect(f.names[1]).toEqual({ toponym: 'Abades (Pasto)', lang: 'en' });
    expect(f.names[1]).not.toHaveProperty('citations');
  });
  it('throws on a non-array name_variants and treats null as none', () => {
    expect(() => buildPlaceFeature({ ...PLACE, name_variants: 'Abadés' }, OPTS)).toThrow(/nl-qfsbu.*name_variants/);
    expect(buildPlaceFeature({ ...PLACE, name_variants: null }, OPTS).names).toHaveLength(1);
  });
});
describe('buildPlaceFeature — links', () => {
  it('emits closeMatch links for WHG, TGN and Wikidata in that order, with verified URL patterns', () => {
    const f = buildPlaceFeature({ ...PLACE, whg_id: '176861', tgn_id: '1024345', wikidata_id: 'Q42', hgis_id: 'lugares13k_rel:176861' }, OPTS);
    expect(f.links).toEqual([
      { type: 'closeMatch', identifier: 'https://whgazetteer.org/places/176861/detail' },
      { type: 'closeMatch', identifier: 'http://vocab.getty.edu/tgn/1024345' },
      { type: 'closeMatch', identifier: 'http://www.wikidata.org/entity/Q42' },
    ]);
    expect(JSON.stringify(f)).not.toMatch(/hgis|lugares13k/);
  });
  it('omits links when no id is populated and drops an id that does not match its pattern, with a warning', () => {
    expect(buildPlaceFeature(PLACE, OPTS)).not.toHaveProperty('links');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildPlaceFeature({ ...PLACE, whg_id: 'https://whgazetteer.org/places/1' }, OPTS)).not.toHaveProperty('links');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/nl-qfsbu: ignoring whg_id/));
    warn.mockRestore();
  });
  it('keeps the key order with types and links present', () => {
    const f = buildPlaceFeature({ ...PLACE, whg_id: '1' }, OPTS);
    expect(Object.keys(f)).toEqual(['@id', 'type', 'properties', 'names', 'types', 'geometry', 'links']);
  });
});

describe('attestedYears', () => {
  const DESCRIPTIONS = [
    { reference_code: 'co-a-001', date_start: '1650-03-01' },
    { reference_code: 'co-a-002', date_start: '1702' },
    { reference_code: 'co-a-003', date_start: '' },
    { reference_code: 'co-a-004' },
  ];
  it('takes the min and max leading year of the dated linked descriptions, ignoring undated ones', () => {
    const years = attestedYears([
      { place_code: 'nl-a', reference_code: 'co-a-002' },
      { place_code: 'nl-a', reference_code: 'co-a-001' },
      { place_code: 'nl-a', reference_code: 'co-a-003' },
    ], DESCRIPTIONS);
    expect(years.get('nl-a')).toEqual({ start: '1650', end: '1702', count: 2 });
  });
  it('leaves out places with no dated link and ignores unknown reference codes', () => {
    const years = attestedYears([
      { place_code: 'nl-b', reference_code: 'co-a-004' },
      { place_code: 'nl-c', reference_code: 'co-missing' },
      { place_code: 'nl-d', reference_code: 'co-a-001' },
    ], DESCRIPTIONS);
    expect(years.has('nl-b')).toBe(false);
    expect(years.has('nl-c')).toBe(false);
    expect(years.get('nl-d')).toEqual({ start: '1650', end: '1650', count: 1 });
  });
  it('takes the end year from the last year in date_expression', () => {
    const years = attestedYears([{ place_code: 'nl-e', reference_code: 'co-e-001' }], [
      { reference_code: 'co-e-001', date_start: '1630-01-04', date_expression: '1630-01-04 .. 1788-02-02' },
    ]);
    expect(years.get('nl-e')).toEqual({ start: '1630', end: '1788', count: 1 });
  });
  it('counts a description with no date_start but a dated date_expression', () => {
    const years = attestedYears([{ place_code: 'nl-f', reference_code: 'co-f-001' }], [
      { reference_code: 'co-f-001', date_start: null, date_expression: '1780-1822' },
    ]);
    expect(years.get('nl-f')).toEqual({ start: '1780', end: '1822', count: 1 });
  });
  it('throws on non-array inputs', () => {
    expect(() => attestedYears(null, DESCRIPTIONS)).toThrow(/array/);
    expect(() => attestedYears([], {})).toThrow(/array/);
  });
});

describe('buildPlaceFeature — when', () => {
  it('emits when after properties from the attested years', () => {
    const f = buildPlaceFeature({ ...PLACE, whg_id: '1' }, { ...OPTS, attested: { start: '1650', end: '1702', count: 2 } });
    expect(f.when).toEqual({ timespans: [{ start: { in: '1650' }, end: { in: '1702' } }] });
    expect(Object.keys(f)).toEqual(['@id', 'type', 'properties', 'when', 'names', 'types', 'geometry', 'links']);
  });
  it('omits end when start equals end, and omits when without attested years', () => {
    const f = buildPlaceFeature(PLACE, { ...OPTS, attested: { start: '1650', end: '1650', count: 1 } });
    expect(f.when).toEqual({ timespans: [{ start: { in: '1650' } }] });
    expect(buildPlaceFeature(PLACE, OPTS)).not.toHaveProperty('when');
  });
});

describe('readPlacesConfig', () => {
  const dirs = [];
  const instance = (toml) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-places-cfg-'));
    dirs.push(dir);
    if (toml !== undefined) fs.writeFileSync(path.join(dir, 'hugo.toml'), toml, 'utf8');
    return dir;
  };
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('reads the site values and the places params, trimmed, with trailing slashes stripped', () => {
    const dir = instance([
      'baseURL = " https://example.org/ "',
      'title = " Archive "',
      'defaultContentLanguage = "en"',
      '[params]',
      'places_language = " es-CO "',
      'places_base_url = "https://data.example.org/places//"',
    ].join('\n'));
    expect(readPlacesConfig(dir)).toEqual({
      siteBaseUrl: 'https://example.org/', siteTitle: 'Archive', language: 'es-CO',
      placesBaseUrl: 'https://data.example.org/places',
    });
  });
  it('does not fall back to defaultContentLanguage, and treats blank values as unset', () => {
    const dir = instance('baseURL = "  "\ntitle = ""\ndefaultContentLanguage = "en"\n[params]\nplaces_language = " "\nplaces_base_url = " "\n');
    expect(readPlacesConfig(dir)).toEqual({ siteBaseUrl: '/', siteTitle: 'Zasqua', language: null, placesBaseUrl: null });
    expect(readPlacesConfig(instance('defaultContentLanguage = "en"\n')).language).toBeNull();
  });
  it('yields the defaults without params and without hugo.toml', () => {
    expect(readPlacesConfig(instance('title = "T"\n'))).toEqual({ siteBaseUrl: '/', siteTitle: 'T', language: null, placesBaseUrl: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readPlacesConfig(instance())).toEqual({ siteBaseUrl: '/', siteTitle: 'Zasqua', language: null, placesBaseUrl: null });
    warn.mockRestore();
  });
});

describe('placesSlug and planPlaceRecord', () => {
  it('strips ?, # and / from the trimmed code', () => {
    expect(placesSlug(' nl-a?b#c/d ')).toBe('nl-abcd');
    expect(placesSlug(undefined)).toBe('');
  });
  it('plans a write, then refuses a case-insensitive repeat and the reserved slug index', () => {
    const owners = new Map();
    expect(planPlaceRecord({ place_code: 'nl-a' }, owners)).toEqual({ write: true, code: 'nl-a', slug: 'nl-a' });
    expect(planPlaceRecord({ place_code: 'NL-A' }, owners)).toEqual({
      write: false, code: 'NL-A', slug: 'NL-A', reason: 'slug "NL-A" already written by nl-a',
    });
    expect(planPlaceRecord({ place_code: 'Index' }, owners)).toEqual({
      write: false, code: 'Index', slug: 'Index', reason: 'slug "index" is reserved for the corpus file',
    });
  });
  it('treats NFC and NFD spellings of the same code as one slug', () => {
    const nfc = 'nl-é'.normalize('NFC');
    const nfd = 'nl-é'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    const owners = new Map();
    expect(planPlaceRecord({ place_code: nfc }, owners).write).toBe(true);
    const plan = planPlaceRecord({ place_code: nfd }, owners);
    expect(plan.write).toBe(false);
    expect(plan.reason).toMatch(/already written by/);
  });
});

describe('buildFeatureCollection and serialize', () => {
  it('wraps features in a FeatureCollection with the LPF context', () => {
    const f = buildPlaceFeature(PLACE, OPTS);
    const fc = buildFeatureCollection([f]);
    expect(Object.keys(fc)).toEqual(['type', '@context', 'features']);
    expect(fc).toEqual({ type: 'FeatureCollection', '@context': LPF_CONTEXT, features: [f] });
  });
  it('serializes with two-space indentation and a final newline', () => {
    expect(serialize({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });
});

describe('isUnderPublic', () => {
  it('matches public/ and its subdirectories but not a sibling with the same prefix', () => {
    const root = path.join(os.tmpdir(), 'inst');
    expect(isUnderPublic(path.join(root, 'public'), root)).toBe(true);
    expect(isUnderPublic(path.join(root, 'public', 'places'), root)).toBe(true);
    expect(isUnderPublic(path.join(root, 'public-staging', 'places'), root)).toBe(false);
    expect(isUnderPublic(path.join(root, 'staging'), root)).toBe(false);
    expect(isUnderPublic(path.join(root, 'public', '..x'), root)).toBe(true);
  });
  it('isUnderDir: a child named "..x" is inside, ".." and a sibling are not', () => {
    expect(isUnderDir('/srv/p', '/srv/p')).toBe(true);
    expect(isUnderDir('/srv/p/..x', '/srv/p')).toBe(true);
    expect(isUnderDir('/srv/p/a/b', '/srv/p')).toBe(true);
    expect(isUnderDir('/srv', '/srv/p')).toBe(false);
    expect(isUnderDir('/srv/p-x', '/srv/p')).toBe(false);
    expect(isUnderDir('/srv/q/..x', '/srv/p')).toBe(false);
  });
});

describe('readDescriptionDates', () => {
  it('keeps only reference_code, date_start and date_expression on each record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-places-desc-'));
    try {
      const file = path.join(dir, 'descriptions.json');
      fs.writeFileSync(file, JSON.stringify([
        { reference_code: 'co-a', date_start: '1700-01-01', date_expression: '1700', title: 'T', scope: { nested: [1] } },
        { reference_code: 'co-b', date_start: null, extent: '1 f.' },
      ]), 'utf8');
      expect(readDescriptionDates(file)).toEqual([
        { reference_code: 'co-a', date_start: '1700-01-01', date_expression: '1700' },
        { reference_code: 'co-b', date_start: null },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Version: v1.5.0
