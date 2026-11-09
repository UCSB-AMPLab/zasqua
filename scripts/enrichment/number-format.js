/**
 * Number Formatter
 *
 * This module deals with formatting counts for display in the site's
 * language. Spanish writes the thousands separator as a period
 * ("106.529"), English as a comma ("106,529"). The catalogue shows
 * several such counts (descriptions per repository, linked documents per
 * entity, totals in the build log), and they all run through this one
 * function.
 *
 * `numberFormat(num, locale)` uses `Intl.NumberFormat` in the given
 * locale (the manifest's `[ui] language`, read through
 * `lib/site-language.js`). Grouping is set to `always`: CLDR leaves
 * four-digit numbers ungrouped in Spanish ("1000"), and Spanish sites
 * show "1.000".
 *
 * `null` and `undefined` return the string `"0"`, so templates never
 * need a null check around the call. A value that is not a number
 * passes through as a string.
 *
 * @version v1.6.0
 */

'use strict';

const { DEFAULT_LANGUAGE } = require('../../lib/site-language.js');

const formatters = new Map();

function numberFormat(num, locale = DEFAULT_LANGUAGE) {
  if (num === null || num === undefined) return '0';
  const n = Number(num);
  if (!Number.isFinite(n)) return String(num);
  if (!formatters.has(locale)) {
    formatters.set(locale, new Intl.NumberFormat(locale, { useGrouping: 'always', maximumFractionDigits: 20 }));
  }
  return formatters.get(locale).format(n);
}

module.exports = { numberFormat };

// Version: v1.6.0
