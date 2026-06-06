/**
 * Spanish Thousands-Separator Number Formatter
 *
 * This module deals with formatting counts for display. In Spanish
 * typographic convention the thousands separator is a period, not a
 * comma — so 106,529 records is written "106.529" to Colombian readers.
 * The catalogue shows several such counts (number of descriptions per
 * repository, linked documents per entity, total results on a search
 * page), and they all run through this one function.
 *
 * `numberFormat` carries forward the number-formatting logic used before
 * the move to Hugo. `null` and `undefined` inputs return the string `"0"` —
 * keeps templates simple by never needing a null check around the filter.
 *
 * @version v1.0.0
 */

'use strict';

function numberFormat(num) {
  if (num === null || num === undefined) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

module.exports = { numberFormat };
