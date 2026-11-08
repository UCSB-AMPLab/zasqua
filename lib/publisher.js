/**
 * Publisher and Bilingual Fields — shared readers for the METS and EAC steps
 *
 * This module deals with the two things the METS and EAC generators take from
 * Fisqua's institution records: the publisher (`exports/publisher.json`, one
 * JSON object naming the legal entity behind the site) and the bilingual
 * fields (`{es, en}` objects) that repository records carry.
 *
 * `readPublisher(dataDir)` returns the parsed object, or null when the file is
 * absent (a 1.0 export has none) or does not hold an object.
 * `publisherLine(publisher)` joins `legal_name`, `tax_id` and `location` as
 * "<legal_name> (<tax_id>), <location>", dropping empty parts; it returns ''
 * when there is no `legal_name`.
 * `pickLang(field, lang)` returns the member for `lang`, else the other
 * member, else ''; a plain string is returned as it is.
 *
 * @version v1.6.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readPublisher(dataDir) {
  const file = path.join(dataDir, 'publisher.json');
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function publisherLine(publisher) {
  const name = text(publisher && publisher.legal_name);
  if (!name) return '';
  const taxId = text(publisher.tax_id);
  const location = text(publisher.location);
  let line = name;
  if (taxId) line += ` (${taxId})`;
  if (location) line += `, ${location}`;
  return line;
}

function pickLang(field, lang) {
  if (typeof field === 'string') return text(field);
  if (!field || typeof field !== 'object') return '';
  const other = lang === 'es' ? 'en' : 'es';
  return text(field[lang]) || text(field[other]);
}

module.exports = { readPublisher, publisherLine, pickLang };

// Version: v1.6.0
