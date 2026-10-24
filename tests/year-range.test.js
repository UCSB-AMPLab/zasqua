/**
 * Year-range tests — descriptionYearRange in lib/year-range.js
 *
 * The helper is shared by the Pagefind date facets and the Linked Places
 * `when` block, so its reading of `date_start` and `date_expression` is pinned
 * here once rather than through either consumer.
 *
 * @version v1.5.0
 */

import { describe, it, expect } from 'vitest';
const { descriptionYearRange } = require('../lib/year-range.js');
const pagefind = require('../scripts/generate-pagefind-indices.js');

describe('descriptionYearRange', () => {
  it('reads the start from an ISO date_start and the end from date_expression', () => {
    expect(descriptionYearRange({ date_start: '1630-01-04', date_expression: '1630-01-04 .. 1788-02-02' }))
      .toEqual({ startYear: 1630, endYear: 1788 });
  });
  it('ignores whitespace around date_start', () => {
    expect(descriptionYearRange({ date_start: ' 1630-01-01' })).toEqual({ startYear: 1630, endYear: 1630 });
    expect(descriptionYearRange({ date_start: '1630-01-01 \n' })).toEqual({ startYear: 1630, endYear: 1630 });
  });
  it('falls back to the expression when date_start is null', () => {
    expect(descriptionYearRange({ date_start: null, date_expression: '1780-1822' })).toEqual({ startYear: 1780, endYear: 1822 });
  });
  it('uses a single year for both ends', () => {
    expect(descriptionYearRange({ date_expression: 'fl. 1911' })).toEqual({ startYear: 1911, endYear: 1911 });
    expect(descriptionYearRange({ date_start: '1700-05-05' })).toEqual({ startYear: 1700, endYear: 1700 });
  });
  it('returns an inverted expression as written; callers order the ends', () => {
    expect(descriptionYearRange({ date_expression: '1788 .. 1630' })).toEqual({ startYear: 1788, endYear: 1630 });
  });
  it('returns nulls for undated or malformed values without throwing', () => {
    expect(descriptionYearRange({})).toEqual({ startYear: null, endYear: null });
    expect(descriptionYearRange({ date_start: 1630, date_expression: 42 })).toEqual({ startYear: null, endYear: null });
    expect(descriptionYearRange({ date_start: 's. XVII', date_expression: 'sin fecha' })).toEqual({ startYear: null, endYear: null });
    expect(descriptionYearRange({ date_start: '', date_expression: '' })).toEqual({ startYear: null, endYear: null });
  });
  it('is the same function the Pagefind index generator exports', () => {
    expect(pagefind.descriptionYearRange).toBe(descriptionYearRange);
  });
});

// Version: v1.5.0
