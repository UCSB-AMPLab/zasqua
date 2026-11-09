/**
 * Year-range tests — descriptionYearRange and contractYear in lib/year-range.js
 *
 * descriptionYearRange is shared by the Pagefind date facets and the Linked
 * Places `when` block, so its reading of `date_start` and `date_expression` is
 * pinned here once rather than through either consumer. contractYear reads an
 * entity's `date_earliest` or `date_latest`, which the contract allows as
 * "YYYY", "YYYY-MM-DD" or an integer year; the last block checks that the
 * entity search index takes the year from each form.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
const { descriptionYearRange, contractYear } = require('../lib/year-range.js');
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

describe('contractYear', () => {
  it('reads the year from each form the contract allows', () => {
    expect(contractYear('1818')).toBe(1818);
    expect(contractYear('1818-01-01')).toBe(1818);
    expect(contractYear('1818-06')).toBe(1818);
    expect(contractYear(1818)).toBe(1818);
    expect(contractYear(' 1818-01-01 ')).toBe(1818);
  });
  it('returns null for an empty or unreadable value', () => {
    expect(contractYear(null)).toBe(null);
    expect(contractYear(undefined)).toBe(null);
    expect(contractYear('')).toBe(null);
    expect(contractYear('s. XVIII')).toBe(null);
    expect(contractYear(Number.NaN)).toBe(null);
  });
});

describe('entity search index: dates', () => {
  const entity = { entity_code: 'ne-aaaaaa', display_name: 'A', date_earliest: '1818-01-01', date_latest: '1820-12-31' };

  it('builds year, century and decade filters from full dates', () => {
    const f = pagefind.FIELD_MAP.entities.filters(entity);
    expect(f.year).toEqual(['1818']);
    expect(f.century).toEqual(['XIX']);
    expect(f.decade).toEqual(['1810', '1820']);
  });
  it('gives the result card and the sort the years, not the dates', () => {
    const m = pagefind.FIELD_MAP.entities.meta(entity);
    expect(m.date_earliest).toBe('1818');
    expect(m.date_latest).toBe('1820');
    expect(pagefind.FIELD_MAP.entities.sort(entity).date).toBe('1818');
  });
  it('builds the same filters from bare years', () => {
    const f = pagefind.FIELD_MAP.entities.filters({ ...entity, date_earliest: '1818', date_latest: '1820' });
    expect(f).toMatchObject({ year: ['1818'], century: ['XIX'], decade: ['1810', '1820'] });
  });
  it('emits no date filter for an undated entity', () => {
    const f = pagefind.FIELD_MAP.entities.filters({ ...entity, date_earliest: null, date_latest: null });
    expect(f.year).toBeUndefined();
    expect(f.century).toBeUndefined();
  });
});

// Version: v1.6.0
