/**
 * Language Names Tests
 *
 * `themes/base/data/languages.yaml` maps three-letter language codes to
 * names in English and Spanish. `scripts/generate-language-names.js`
 * writes it from the CLDR data in Node. These tests check that the file
 * names the codes the repository page needs, that every entry has an
 * English name, that the committed file agrees with what the generator
 * produces on the running Node (so a CLDR change shows up as a diff to
 * review), and that no Spanish name is invented for a code CLDR lacks.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { buildLanguages } = require('../scripts/generate-language-names.js');

const file = path.join(__dirname, '..', 'themes', 'base', 'data', 'languages.yaml');
const languages = yaml.load(fs.readFileSync(file, 'utf8'));

describe('languages.yaml', () => {
  it('names Spanish, English and Quechua in both languages', () => {
    expect(languages.spa).toEqual({ en: 'Spanish', es: 'español' });
    expect(languages.eng).toEqual({ en: 'English', es: 'inglés' });
    expect(languages.que).toEqual({ en: 'Quechua', es: 'quechua' });
  });

  it('keys every entry by a three-letter code and gives it an English name', () => {
    for (const [code, entry] of Object.entries(languages)) {
      expect(code, code).toMatch(/^[a-z]{3}$/);
      expect(typeof entry.en, code).toBe('string');
      if ('es' in entry) expect(typeof entry.es, code).toBe('string');
    }
  });

  it('agrees with the generator on this Node', () => {
    expect(languages).toEqual(buildLanguages());
  });
});

// Version: v1.6.0
