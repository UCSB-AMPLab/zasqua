/**
 * Facet Auto-Suppression Unit Tests
 *
 * Tests for `suppressSingleValuedFacets`, the pure helper that removes
 * single- or zero-valued facets from the tally object before it is
 * serialised to the sidecar JSON files. The helper lives in
 * `scripts/generate-pagefind-indices.js`. A facet with only one possible
 * value adds clutter without ever narrowing a search, so it is dropped.
 *
 * Four behaviors covered:
 *
 *   1. A key with exactly 1 distinct value is omitted entirely from the
 *      result — the key must be absent, not present as an empty object.
 *
 *   2. A key with 0 distinct values (empty object) is also omitted.
 *
 *   3. A key with 2 or more distinct values is copied through unchanged.
 *
 *   4. A force_keep list re-includes an otherwise-suppressed single-valued
 *      key — the override must be granular so deployers can keep a
 *      meaningful one-value facet (e.g. a collection with a single country).
 *
 * All tests operate on in-memory tally objects that mirror the
 * `Object.create(null)` maps produced inside `buildIndex` — no full
 * corpus, no file I/O.
 *
 * Real-corpus note: on a large corpus every facet typically has two or more
 * distinct values (several repositories, nine description levels, multiple
 * countries, and so on), so `suppressSingleValuedFacets` returns the tally
 * unchanged. The suppression logic runs but finds nothing to suppress.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { suppressSingleValuedFacets } = require('../scripts/generate-pagefind-indices.js');

// ---------------------------------------------------------------------------
// Behavior 1: key with exactly 1 distinct value is omitted
// ---------------------------------------------------------------------------

describe('suppressSingleValuedFacets — 1 distinct value', () => {
  it('omits a key with exactly one distinct value entirely (key must be absent)', () => {
    const tally = {
      country: { Colombia: 42 },           // 1 distinct value → suppress
      level: { Expediente: 10, Fondo: 5 }, // 2 distinct values → keep
    };
    const result = suppressSingleValuedFacets(tally, []);
    expect(Object.prototype.hasOwnProperty.call(result, 'country')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'level')).toBe(true);
  });

  it('suppressed key is not present as an empty object', () => {
    const tally = { country: { Colombia: 42 } };
    const result = suppressSingleValuedFacets(tally, []);
    expect(result.country).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: key with 0 distinct values is omitted
// ---------------------------------------------------------------------------

describe('suppressSingleValuedFacets — 0 distinct values', () => {
  it('omits a key whose value map is empty', () => {
    const tally = {
      country: {},                           // 0 distinct values → suppress
      level: { Expediente: 10, Fondo: 5 },  // 2 → keep
    };
    const result = suppressSingleValuedFacets(tally, []);
    expect(Object.prototype.hasOwnProperty.call(result, 'country')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'level')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: key with 2+ distinct values passes through unchanged
// ---------------------------------------------------------------------------

describe('suppressSingleValuedFacets — 2 or more distinct values', () => {
  it('preserves a key with exactly 2 distinct values unchanged', () => {
    const tally = {
      digital_status: { zasqua: 80, none: 20 },
    };
    const result = suppressSingleValuedFacets(tally, []);
    expect(result.digital_status).toEqual({ zasqua: 80, none: 20 });
  });

  it('preserves a key with many distinct values unchanged', () => {
    const values = { Bogotá: 10, Medellín: 8, Cali: 6, Popayán: 4, Cartagena: 2 };
    const tally = { repository: values };
    const result = suppressSingleValuedFacets(tally, []);
    expect(result.repository).toEqual(values);
  });

  it('all-multi-valued tally passes through entirely (real-corpus scenario)', () => {
    const tally = {
      country: { Colombia: 100, Perú: 50 },
      digital_status: { zasqua: 80, none: 70 },
      level: { Expediente: 60, Fondo: 40, Serie: 30 },
      repository: { AHR: 50, AGN: 40, BNC: 30 },
      year: { '1780': 10, '1790': 12 },
    };
    const result = suppressSingleValuedFacets(tally, []);
    // Every key passes through — nothing suppressed
    for (const key of Object.keys(tally)) {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: force_keep list re-includes a suppressed single-valued key
// ---------------------------------------------------------------------------

describe('suppressSingleValuedFacets — force_keep override', () => {
  it('re-includes a single-valued key when it is in the force_keep list', () => {
    const tally = {
      country: { Colombia: 42 }, // 1 distinct value → would be suppressed without override
      level: { Expediente: 10, Fondo: 5 },
    };
    const result = suppressSingleValuedFacets(tally, ['country']);
    // force_keep overrides suppression
    expect(Object.prototype.hasOwnProperty.call(result, 'country')).toBe(true);
    expect(result.country).toEqual({ Colombia: 42 });
    // non-suppressed keys still pass through
    expect(result.level).toEqual({ Expediente: 10, Fondo: 5 });
  });

  it('zero-valued key with force_keep is still re-included', () => {
    const tally = { country: {} };
    const result = suppressSingleValuedFacets(tally, ['country']);
    expect(Object.prototype.hasOwnProperty.call(result, 'country')).toBe(true);
  });

  it('force_keep does not affect keys not in the list', () => {
    const tally = {
      country: { Colombia: 42 }, // 1 distinct value
      digital_status: { zasqua: 5 }, // 1 distinct value — NOT in force_keep
    };
    const result = suppressSingleValuedFacets(tally, ['country']);
    expect(Object.prototype.hasOwnProperty.call(result, 'country')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'digital_status')).toBe(false);
  });

  it('accepts null or undefined force_keep gracefully (defaults to no override)', () => {
    const tally = { country: { Colombia: 42 } };
    // both null and undefined should behave like an empty array
    const result1 = suppressSingleValuedFacets(tally, null);
    const result2 = suppressSingleValuedFacets(tally, undefined);
    expect(Object.prototype.hasOwnProperty.call(result1, 'country')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result2, 'country')).toBe(false);
  });
});

// Version: v0.1.0
