/**
 * Search-Index Language Tests
 *
 * The search-index generator (`scripts/generate-pagefind-indices.js`)
 * tells Pagefind which language each record is in, and Pagefind picks
 * its word stemmer from that. The language is the base subtag of the
 * site's `[ui] language` setting: `es` for `es-CO`, `en` for `en-US`.
 * These tests pin `indexLanguage` and check that no corpus field map
 * carries a language of its own, so the descriptions, entities and
 * places indexes all follow the site setting.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { indexLanguage, FIELD_MAP } = require('../scripts/generate-pagefind-indices.js');

describe('indexLanguage', () => {
  it('uses the base subtag of the site language', () => {
    expect(indexLanguage({ ui: { language: 'es-CO' } })).toBe('es');
    expect(indexLanguage({ ui: { language: 'en-US' } })).toBe('en');
    expect(indexLanguage({ ui: { language: 'pt-BR' } })).toBe('pt');
  });

  it('falls back to the engine default language when the setting is absent', () => {
    expect(indexLanguage({ modules: {} })).toBe('en');
  });

  it('leaves no fixed language in any corpus field map', () => {
    for (const corpus of ['descriptions', 'entities', 'places']) {
      expect(FIELD_MAP[corpus]).toBeDefined();
      expect(FIELD_MAP[corpus].language).toBeUndefined();
    }
  });
});

// Version: v1.6.0
