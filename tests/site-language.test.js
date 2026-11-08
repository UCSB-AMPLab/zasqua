/**
 * Site Language Unit Tests
 *
 * Tests for `siteLanguage`, the helper in `lib/site-language.js` that
 * reads the site's interface language from the manifest's `[ui] language`
 * setting. The build pipeline, the content generator and the search-index
 * generator all take the language from this one helper, so the Hugo
 * bundle, the formatted dates and numbers, and the Pagefind stemming
 * language agree.
 *
 * Covered: a regional tag splits into the full locale and the base
 * subtag; a bare tag is its own base; a missing [ui] section or a missing
 * manifest object falls back to the engine default `en-US`, the same
 * default the pipeline has always used; the base subtag is lower-cased.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { siteLanguage, DEFAULT_LANGUAGE } = require('../lib/site-language.js');

describe('siteLanguage', () => {
  it('splits a regional tag into locale and base subtag', () => {
    expect(siteLanguage({ ui: { language: 'es-CO' } })).toEqual({ locale: 'es-CO', base: 'es' });
    expect(siteLanguage({ ui: { language: 'en-US' } })).toEqual({ locale: 'en-US', base: 'en' });
  });

  it('treats a bare language tag as its own base', () => {
    expect(siteLanguage({ ui: { language: 'fr' } })).toEqual({ locale: 'fr', base: 'fr' });
  });

  it('lower-cases the base subtag', () => {
    expect(siteLanguage({ ui: { language: 'ES-co' } }).base).toBe('es');
  });

  it('falls back to en-US when the manifest has no [ui] language', () => {
    expect(DEFAULT_LANGUAGE).toBe('en-US');
    expect(siteLanguage({ modules: {} })).toEqual({ locale: 'en-US', base: 'en' });
    expect(siteLanguage({ ui: {} })).toEqual({ locale: 'en-US', base: 'en' });
    expect(siteLanguage(undefined)).toEqual({ locale: 'en-US', base: 'en' });
  });
});

// Version: v1.6.0
