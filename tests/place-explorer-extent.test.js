/**
 * Place Explorer Map Extent Tests
 *
 * Tests `computeMapExtent` in `static/js/place-explorer.js`, which
 * gives the bounding box the map is fitted to once the site's places
 * are loaded. The explorer is a classic script, so the helper is
 * loaded through `createRequire`. With no places that have
 * coordinates the helper returns null and the map keeps its world view.
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { computeMapExtent, parseBounds, resolveInitialBounds, MAP_FIT_MAX_ZOOM } = require('../themes/base/static/js/place-explorer.js');

describe('computeMapExtent', () => {
  it('returns the bounding box of places with coordinates', () => {
    const box = computeMapExtent([
      { latitude: 10, longitude: -70 },
      { latitude: -3, longitude: 20 },
      { latitude: 40, longitude: 5 },
    ]);
    expect(box).toEqual([[-70, -3], [20, 40]]);
  });

  it('ignores places without coordinates', () => {
    const box = computeMapExtent([
      { latitude: null, longitude: null },
      { latitude: 4, longitude: -74 },
      {},
    ]);
    expect(box).toEqual([[-74, 4], [-74, 4]]);
  });

  it('returns null for no places, so the map keeps the world view', () => {
    expect(computeMapExtent([])).toBeNull();
    expect(computeMapExtent(undefined)).toBeNull();
    expect(computeMapExtent([{ latitude: null, longitude: null }])).toBeNull();
  });

  it('keeps a zoom cap for single-place sites', () => {
    expect(MAP_FIT_MAX_ZOOM).toBeGreaterThan(0);
    expect(MAP_FIT_MAX_ZOOM).toBeLessThan(12);
  });
});

describe('resolveInitialBounds', () => {
  const places = [{ latitude: 40, longitude: -3 }, { latitude: 4, longitude: -74 }];
  const configured = '[[-80, -5], [-60, 14]]';

  it('uses the configured bounds when the setting is present', () => {
    expect(resolveInitialBounds(configured, places)).toEqual([[-80, -5], [-60, 14]]);
  });
  it('fits to the places when the setting is absent', () => {
    expect(resolveInitialBounds('', places)).toEqual([[-74, 4], [-3, 40]]);
    expect(resolveInitialBounds(undefined, places)).toEqual([[-74, 4], [-3, 40]]);
  });
  it('ignores a malformed setting and fits to the places', () => {
    for (const bad of ['nope', '[1,2]', '[[1,2],[3]]', '[[10,0],[5,5]]', '[["a",1],[2,3]]']) {
      expect(parseBounds(bad)).toBeNull();
      expect(resolveInitialBounds(bad, places)).toEqual([[-74, 4], [-3, 40]]);
    }
  });
  it('returns null with no setting and no places', () => {
    expect(resolveInitialBounds('', [])).toBeNull();
  });
});

// Version: v1.6.0
