/**
 * Facet count maps in the explorers
 *
 * The entity explorer (`entity-explorer.js`) and the place explorer
 * (`place-explorer.js`) count facet values (entity and place types,
 * functions, years) into { facetKey: { value: count } } maps, from the
 * entities or places in the viewport and from Pagefind results. Values
 * come from the export, so a type code such as "__proto__" or
 * "constructor" must count like any other: in a plain object, assigning
 * "__proto__" is lost and reading an absent "constructor" gives an
 * inherited function. The helpers are loaded through `createRequire`, as
 * in the other explorer tests, and checked with those values.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const JS_DIR = path.join(__dirname, '..', 'themes', 'base', 'static', 'js');
const entityExplorer = require(path.join(JS_DIR, 'entity-explorer.js'));
const placeExplorer = require(path.join(JS_DIR, 'place-explorer.js'));

// A Pagefind-shaped result whose facet maps carry own "__proto__" keys
const SEARCH = JSON.parse(
  '{"results":[1,2,3],"filters":{"entity_type":{"__proto__":2,"person":1},"place_type":{"__proto__":2,"city":1}},'
  + '"totalFilters":{"entity_type":{"__proto__":4,"person":3},"place_type":{"__proto__":4,"city":3}}}',
);

describe('scopedFacetsFromEntities (entity-explorer.js)', () => {
  it('counts type and function codes that are inherited names', () => {
    const facets = entityExplorer.scopedFacetsFromEntities([
      { entity_type: '__proto__', primary_function: 'constructor', date_earliest: '1701', date_latest: '1702' },
      { entity_type: '__proto__', primary_function: 'constructor' },
      { entity_type: 'person' },
    ]);
    expect(Object.keys(facets.entity_type).sort()).toEqual(['__proto__', 'person']);
    expect(facets.entity_type.__proto__).toBe(2);
    expect(facets.primary_function.constructor).toBe(2);
    expect(facets.entity_type.constructor).toBeUndefined();
    expect(facets.year).toEqual(Object.assign(Object.create(null), { 1701: 1, 1702: 1 }));
    expect(facets.century['18']).toBe(1);
    expect(facets.decade['1700']).toBe(1);
  });
});

describe.each([
  ['entity-explorer.js', entityExplorer, 'entity_type', 'person'],
  ['place-explorer.js', placeExplorer, 'place_type', 'city'],
])('facet counts in %s', (_file, mod, key, plain) => {
  it('keeps a "__proto__" value from a search result', () => {
    const out = mod.scopedFacetCountsPure(SEARCH, {}, {});
    expect(Object.keys(out[key]).sort()).toEqual(['__proto__', plain]);
    expect(out[key].__proto__).toBe(2);
    expect(out[key][plain]).toBe(1);
  });

  it('reads totalFilters for an active facet', () => {
    const out = mod.scopedFacetCountsPure(SEARCH, { [key]: [plain, '__proto__'] }, {});
    expect(out[key].__proto__).toBe(4);
  });

  it('counts 0 for an inherited name the result lacks', () => {
    for (const value of ['constructor', 'toString', '__proto__']) {
      expect(mod.selectFacetCounts({ filters: { [key]: {} } }, key, value, {})).toBe(0);
    }
  });

  it('falls back to globalFilters without facet payloads', () => {
    const global = { [key]: { [plain]: 9 } };
    expect(mod.scopedFacetCountsPure(null, {}, global)[key]).toEqual({ [plain]: 9 });
  });
});

describe('viewportFacetsFromPlaces (place-explorer.js)', () => {
  it('counts a place type that is an inherited name', () => {
    const facets = placeExplorer.viewportFacetsFromPlaces([
      { place_type: '__proto__', latitude: 1, longitude: 2, has_tgn: true },
      { place_type: '__proto__', latitude: null, longitude: null },
      { place_type: 'constructor', latitude: 1, longitude: 2 },
      {},
    ]);
    expect(Object.keys(facets.place_type).sort()).toEqual(['__proto__', 'constructor', 'unknown']);
    expect(facets.place_type.__proto__).toBe(2);
    expect(facets.place_type.constructor).toBe(1);
    expect(facets.has_coordinates.true).toBe(2);
    expect(facets.has_coordinates.false).toBe(2);
    expect(facets.has_authority.true).toBe(1);
  });
});

// Version: v1.6.0
