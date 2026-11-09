/**
 * Date and Number Format Tests
 *
 * Golden-file regression tests for `formatDateNarrative` and
 * `numberFormat`, the helpers that turn archival date strings such as
 * `1723-03-15` into prose and counts into grouped numbers, in the site's
 * language. Both take the site locale (the manifest's `[ui] language`).
 *
 * The Spanish cases are the output the engine wrote before it took the
 * language from the site, and must stay byte-identical: "15 de marzo de
 * 1723", "1.000". The English cases pin the US forms ("March 15, 1723",
 * "1,000"). The input range separator ` .. ` is a data convention and the
 * output separator ` – ` (U+2013) is the same in every language.
 *
 * This test imports directly from `scripts/enrichment/`. No build output
 * is required.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import { formatDateNarrative } from '../../scripts/enrichment/date-format.js';
import { numberFormat } from '../../scripts/enrichment/number-format.js';

describe('formatDateNarrative — Spanish (es-CO), unchanged output', () => {
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
    ['0950-07-04',                 '4 de julio de 0950'],
    ['1700-02-29',                 '29 de febrero de 1700'],
  ];

  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(formatDateNarrative(input, 'es-CO')).toBe(expected);
    });
  }

  it('writes every month as the earlier lowercase Spanish list did', () => {
    const months = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    months.forEach((name, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(formatDateNarrative(`1800-${mm}`, 'es-CO')).toBe(`${name} de 1800`);
      expect(formatDateNarrative(`1800-${mm}-09`, 'es')).toBe(`9 de ${name} de 1800`);
    });
  });
});

describe('formatDateNarrative — English (en-US)', () => {
  const cases = [
    ['1723-03-15',               'March 15, 1723'],
    ['1723-03',                  'March 1723'],
    ['1723',                     '1723'],
    ['1723-03-15 .. 1725-12-01', 'March 15, 1723 – December 1, 1725'],
    ['undated',                  'undated'],
  ];
  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(formatDateNarrative(input, 'en-US')).toBe(expected);
    });
  }

  it('passes an out-of-range month through unchanged', () => {
    expect(formatDateNarrative('1723-13-01', 'en-US')).toBe('1723-13-01');
  });
});

describe('numberFormat', () => {
  const es = [
    [1000,     '1.000'],
    [106529,   '106.529'],
    [1234567,  '1.234.567'],
    [0,        '0'],
    [null,     '0'],
    [undefined, '0'],
  ];
  for (const [input, expected] of es) {
    it(`es-CO formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(numberFormat(input, 'es-CO')).toBe(expected);
    });
  }

  it('groups four-digit numbers in Spanish, as the earlier formatter did', () => {
    expect(numberFormat(1000, 'es')).toBe('1.000');
  });

  const en = [
    [1000,    '1,000'],
    [106529,  '106,529'],
    [0,       '0'],
    [null,    '0'],
  ];
  for (const [input, expected] of en) {
    it(`en-US formats ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(numberFormat(input, 'en-US')).toBe(expected);
    });
  }

  it('passes a non-numeric value through as a string', () => {
    expect(numberFormat('n/a', 'en-US')).toBe('n/a');
  });
});

// Version: v1.6.0
