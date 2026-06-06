/**
 * Date Format Invariant Test
 *
 * Golden-file regression test for `formatDateNarrative`, the helper
 * that turns archival date strings like `1723-03-15` into
 * Colombian-Spanish prose ("15 de marzo de 1723"). The original
 * Eleventy build embedded this logic as a template filter
 * (`eleventy.config.js:37-64`); the v1.0.0 rebuild moved it into
 * `scripts/enrichment/date-format.js` so Hugo templates can consume
 * the pre-formatted string from enriched JSON instead of running a
 * filter at render time.
 *
 * Note the range separator: input " .. " (space-dot-dot-space),
 * output " – " (space-endash-space, U+2013). Month names are
 * lowercase Colombian Spanish.
 *
 * This test lives in the engine package and imports directly from
 * `scripts/enrichment/`. No build output and no Backblaze B2 data are
 * required.
 *
 * @version v2.0.0
 */

import { describe, it, expect } from 'vitest';
import { formatDateNarrative, SPANISH_MONTHS } from '../../scripts/enrichment/date-format.js';
import { numberFormat } from '../../scripts/enrichment/number-format.js';

describe('formatDateNarrative', () => {
  const cases = [
    ['1723-03-15',                 '15 de marzo de 1723'],
    ['1723-03',                    'marzo de 1723'],
    ['1723',                       '1723'],
    ['1723-03-15 .. 1725-12-01',   '15 de marzo de 1723 – 1 de diciembre de 1725'],
    ['',                           ''],
    ['fecha desconocida',          'fecha desconocida'],
    [null,                         ''],
    [undefined,                    ''],
    ['1723-03-15 .. 1723-03-15',   '15 de marzo de 1723 – 15 de marzo de 1723'],
  ];

  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(formatDateNarrative(input)).toBe(expected);
    });
  }

  it('exports SPANISH_MONTHS in the canonical lowercase Colombian Spanish order', () => {
    expect(SPANISH_MONTHS).toEqual([
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ]);
  });
});

describe('numberFormat', () => {
  const cases = [
    [1000,     '1.000'],
    [106529,   '106.529'],
    [0,        '0'],
    [null,     '0'],
    [undefined, '0'],
  ];

  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(numberFormat(input)).toBe(expected);
    });
  }
});

// Version: v2.0.0
