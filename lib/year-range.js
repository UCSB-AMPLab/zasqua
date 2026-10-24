/**
 * Description Year Range — Shared Year Derivation for Descriptions
 *
 * Several engine scripts need the span of years a description covers: the
 * Pagefind indices use it for the date facets, and the Linked Places
 * generator uses it for the years in which a place is attested. The export
 * does not carry year fields, so the range is derived from the two date
 * fields the description contract does carry:
 *
 *   start — the four digits at the start of `date_start` (ISO YYYY-MM-DD,
 *           surrounding whitespace ignored),
 *           else the first four-digit year in `date_expression`
 *   end   — the last four-digit year in `date_expression` (e.g. "1780.. 1822",
 *           "1620 - 1623", "fl. 1911")
 *
 * When only one of the two is found, the other takes its value. A
 * description with neither returns nulls and counts as undated.
 *
 * Public API:
 *
 *   descriptionYearRange(record)
 *     Returns { startYear, endYear } as numbers, or nulls when undated.
 *
 * @version v1.5.0
 */

'use strict';

// Description year derivation. Enriched JSON does NOT carry
// `date_start_year`/`date_end_year` — derive from `date_start`
// (ISO YYYY-MM-DD) when present, otherwise scrape years from
// `date_expression` (e.g. "1780.. 1822", "1620 - 1623", "fl. 1911").
function descriptionYearRange(record) {
  let s = null;
  let e = null;
  if (record.date_start && typeof record.date_start === 'string') {
    const m = record.date_start.trim().match(/^(\d{4})/);
    if (m) s = Number(m[1]);
  }
  if (record.date_expression && typeof record.date_expression === 'string') {
    const matches = record.date_expression.match(/\d{4}/g);
    if (matches && matches.length) {
      if (s == null) s = Number(matches[0]);
      e = Number(matches[matches.length - 1]);
    }
  }
  if (s != null && e == null) e = s;
  if (s == null && e != null) s = e;
  return { startYear: s, endYear: e };
}

module.exports = { descriptionYearRange };

// Version: v1.5.0
