/**
 * Browser Narrative-Date Tests
 *
 * The entity page (`static/js/entity.js`) and the connection graph
 * (`static/js/infinite-bipartite-explorer.js`) format archival dates in
 * the browser, in the language of the page's `<html lang>`. Each file
 * carries the same `narrativeDate(dateStr, locale)` function between
 * `narrative-date:start` and `narrative-date:end` markers. This test
 * lifts that block out of each file, runs it under Node, and checks it
 * against the build-time formatter (`scripts/enrichment/date-format.js`)
 * in Spanish and English, so a record's date reads the same on the
 * record page and in the explorers. It also checks that neither file
 * falls back to a fixed language or branches on English.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { formatDateNarrative } = require('../scripts/enrichment/date-format.js');

const JS_DIR = path.join(__dirname, '..', 'themes', 'base', 'static', 'js');
const FILES = ['entity.js', 'infinite-bipartite-explorer.js', 'place.js'];

function extract(src, name) {
  const m = src.match(/\/\/ narrative-date:start\n([\s\S]*?)\/\/ narrative-date:end/);
  if (!m) throw new Error(`no narrative-date block in ${name}`);
  return new Function(`${m[1]}\nreturn narrativeDate;`)();
}

const INPUTS = [
  '1723-03-15', '1723-03', '1723', '1723-03-15 .. 1725-12-01',
  '0950-07-04', '1700-02-29', 'sin fecha', '', '1723-13-01',
];

for (const name of FILES) {
  describe(`${name} narrativeDate`, () => {
    const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
    const narrativeDate = extract(src, name);

    for (const locale of ['es-CO', 'en-US']) {
      it(`matches the build-time formatter in ${locale}`, () => {
        for (const input of INPUTS) {
          expect(narrativeDate(input, locale)).toBe(formatDateNarrative(input, locale));
        }
      });
    }

    it('writes the Spanish form unchanged', () => {
      expect(narrativeDate('1723-03-15', 'es-CO')).toBe('15 de marzo de 1723');
    });

    it('has no fixed-language fallback and no English branch', () => {
      expect(src).not.toMatch(/\|\|\s*['"]es-CO['"]/);
      expect(src).not.toMatch(/_isEn|IsEn\b/);
    });
  });
}

// Version: v1.6.0
