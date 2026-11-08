/**
 * Narrative Date Formatter
 *
 * This module deals with turning archival date strings into readable
 * prose in the site's language. Archival records store dates in terse
 * ISO-like forms — `1723-03-15`, `1723-03`, `1723`, or a range
 * `1723-03-15 .. 1725-12-01` — because that is what standards like
 * ISAD(G) expect. Readers expect prose: "15 de marzo de 1723" on a
 * Spanish site, "March 15, 1723" on an English one.
 *
 * `formatDateNarrative(dateStr, locale)` formats with the JavaScript
 * `Intl.DateTimeFormat` API in the given locale (the manifest's
 * `[ui] language`, read through `lib/site-language.js`), so month names
 * and word order come from the CLDR data that ships with Node. The
 * Gregorian calendar is fixed, because archival dates are recorded in it
 * whatever the site's language. The output takes the year straight
 * from the input string, so a year before 1000 keeps its four digits
 * ("0950"). Spanish sites depend on the exact `es-CO` output ("15 de
 * marzo de 1723"); the tests pin it.
 *
 * Conventions:
 *   - The range separator in the INPUT is ` .. ` (space-dot-dot-space).
 *     It is a data convention of the export, not a language feature, so
 *     it is the same for every site.
 *   - The range separator in the OUTPUT is ` – ` (space-U+2013-space).
 *   - Empty, null, or undefined input returns an empty string.
 *   - Unrecognised input (free text, a bare year, an out-of-range month
 *     or day) passes through unchanged.
 *
 * @version v1.6.0
 */

'use strict';

const { DEFAULT_LANGUAGE } = require('../../lib/site-language.js');

const formatters = new Map();

function formatterFor(locale, withDay) {
  const key = `${locale}|${withDay ? 'ymd' : 'ym'}`;
  if (!formatters.has(key)) {
    const opts = { timeZone: 'UTC', calendar: 'gregory', year: 'numeric', month: 'long' };
    if (withDay) opts.day = 'numeric';
    formatters.set(key, new Intl.DateTimeFormat(locale, opts));
  }
  return formatters.get(key);
}

// Formats month (1-12) and optional day in the locale, then puts the
// input's own year string where the formatter wrote its year. A leap
// year (2000) stands in for the real one so that 29 February is valid.
function formatParts(locale, yearStr, month, day) {
  if (month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(2000, month - 1, day || 1));
  if (day && date.getUTCDate() !== day) return null;
  return formatterFor(locale, !!day)
    .formatToParts(date)
    .map(p => (p.type === 'year' ? yearStr : p.value))
    .join('');
}

/**
 * @param {string|null|undefined} dateStr — archival date string
 * @param {string} [locale] — BCP 47 tag of the site language
 * @returns {string}
 */
function formatDateNarrative(dateStr, locale = DEFAULT_LANGUAGE) {
  if (!dateStr) return '';

  if (dateStr.indexOf(' .. ') !== -1) {
    const [start, end] = dateStr.split(' .. ');
    return formatDateNarrative(start, locale) + ' – ' + formatDateNarrative(end, locale);
  }

  const ymd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const out = formatParts(locale, ymd[1], parseInt(ymd[2], 10), parseInt(ymd[3], 10));
    return out === null ? dateStr : out;
  }

  const ym = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const out = formatParts(locale, ym[1], parseInt(ym[2], 10), 0);
    return out === null ? dateStr : out;
  }

  return dateStr;
}

module.exports = { formatDateNarrative };

// Version: v1.6.0
