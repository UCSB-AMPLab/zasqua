/**
 * Colombian Spanish Narrative Date Formatter
 *
 * This module deals with turning archival date strings into readable
 * Colombian Spanish prose for the public catalogue. Archival records
 * store dates in terse ISO-like forms — `1723-03-15`, `1723-03`, `1723`,
 * or a range `1723-03-15 .. 1725-12-01` — because that's what standards
 * like ISAD(G) expect. Readers, though, expect prose: "15 de marzo de
 * 1723".
 *
 * `formatDateNarrative` carries forward the date-formatting logic that
 * produced this site's dates before the move to Hugo, first shipped in
 * v0.1. Byte-for-byte fidelity is non-negotiable — the golden-file tests
 * embed eight real cases taken from the live site, and any drift (wrong
 * month name, hyphen instead of en-dash, missing space, etc.) is a
 * regression that invalidates the migration.
 *
 * Conventions:
 *   - Lowercase month names in Colombian Spanish: enero, febrero, etc.
 *   - Range separator in the INPUT is ` .. ` (space-dot-dot-space)
 *   - Range separator in the OUTPUT is ` – ` (space-U+2013-space), NOT a hyphen
 *   - Empty, null, or undefined input returns empty string
 *   - Unrecognised input (e.g. "fecha desconocida") passes through unchanged
 *
 * @version v1.0.0
 */

'use strict';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDateNarrative(dateStr) {
  if (!dateStr) return '';

  if (dateStr.indexOf(' .. ') !== -1) {
    const [start, end] = dateStr.split(' .. ');
    return formatDateNarrative(start) + ' – ' + formatDateNarrative(end);
  }

  const ymd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const day = parseInt(ymd[3], 10);
    const month = SPANISH_MONTHS[parseInt(ymd[2], 10) - 1];
    return `${day} de ${month} de ${ymd[1]}`;
  }

  const ym = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (ym) {
    const month = SPANISH_MONTHS[parseInt(ym[2], 10) - 1];
    return `${month} de ${ym[1]}`;
  }

  return dateStr;
}

module.exports = { SPANISH_MONTHS, formatDateNarrative };
