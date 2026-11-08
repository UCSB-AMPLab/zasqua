/**
 * Century Label Tests
 *
 * The search page (`static/js/search.js`) and the entity explorer
 * (`static/js/entity-explorer.js`) show a date tree whose top level is
 * the century. The label comes from the i18n `ui.centuryLabel` pattern
 * ("Siglo {roman}" in Spanish, "{roman} century" in English); the facet
 * key the indexer writes is the bare roman numeral ("XVII"). These tests
 * check, for both files, that the label follows the pattern in either
 * language, that the facet key comes from the filter's years and not
 * from the label text, and that no Spanish word is left in either file
 * for the century code to strip.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const JS_DIR = path.join(__dirname, '..', 'themes', 'base', 'static', 'js');

const files = {
  'search.js': require(path.join(JS_DIR, 'search.js')),
  'entity-explorer.js': require(path.join(JS_DIR, 'entity-explorer.js')),
};

function centuryYears(n) {
  const base = (n - 1) * 100 + 1;
  return Array.from({ length: 100 }, (_, i) => String(base + i));
}

for (const [name, mod] of Object.entries(files)) {
  describe(`${name} century labels`, () => {
    it('builds the label from the Spanish pattern unchanged', () => {
      expect(mod.centuryLabel('Siglo {roman}', 17)).toBe('Siglo XVII');
      expect(mod.centuryLabel('Siglo {roman}', 1)).toBe('Siglo I');
    });

    it('builds the label from the English pattern', () => {
      expect(mod.centuryLabel('{roman} century', 18)).toBe('XVIII century');
    });

    it('derives the facet key from the years, whatever the label says', () => {
      for (const label of ['Siglo XVII', 'XVII century', 'anything']) {
        expect(mod.centuryPivotValue({ level: 'century', label, years: centuryYears(17) })).toBe('XVII');
      }
      // A date-tree click passes only the years that have results.
      expect(mod.centuryPivotValue({ level: 'century', label: 'x', years: ['1750', '1801'] })).toBe('XVIII');
    });

    it('returns null when the filter has no years', () => {
      expect(mod.centuryPivotValue({ level: 'century', label: 'Siglo XVII', years: [] })).toBeNull();
      expect(mod.centuryPivotValue(null)).toBeNull();
    });

    it('holds no Spanish century word', () => {
      const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
      expect(src).not.toMatch(/siglo/i);
    });
  });
}

// Version: v1.6.0
