/**
 * Year Range — Shared Year Derivation for Descriptions and Entities
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
 * Entities carry their own `date_earliest` and `date_latest`, which the
 * contract allows as "YYYY" or "YYYY-MM-DD", and some exports send as an
 * integer year. Anything that buckets them by year reads the year through
 * `contractYear`, so a full date and a bare year land in the same century
 * and decade.
 *
 * Public API:
 *
 *   descriptionYearRange(record)
 *     Returns { startYear, endYear } as numbers, or nulls when undated.
 *
 *   contractYear(value)
 *     Returns the year of a "YYYY", "YYYY-MM" or "YYYY-MM-DD" string or an
 *     integer year, as a number, or null when there is none.
 *
 * @version v1.6.0
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

function contractYear(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4})(?:-|$)/);
  return m ? Number(m[1]) : null;
}

module.exports = { descriptionYearRange, contractYear };

// Version: v1.6.0
