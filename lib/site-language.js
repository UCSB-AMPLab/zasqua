/**
 * Site Language — the interface language every build step shares
 *
 * This module deals with reading the site's interface language from the
 * capability manifest. A site declares one BCP 47 tag in
 * `zasqua.manifest.toml` under `[ui] language` (for example `es-CO` or
 * `en-US`). That tag is the only source of the site's language: the
 * build pipeline passes it to Hugo, which picks the i18n bundle and
 * writes `<html lang>`; the content generator formats dates and numbers
 * with it; the search-index generator gives Pagefind its base subtag so
 * that stemming follows the language of the catalogue.
 *
 * `siteLanguage(manifest)` returns `{ locale, base }`: `locale` is the
 * full tag as written, and `base` is the lower-cased language subtag
 * (`es` from `es-CO`), which names the i18n bundle and the Pagefind
 * language. A manifest without a `[ui] language` falls back to
 * `DEFAULT_LANGUAGE`, `en-US`, the neutral default the manifest loader
 * and `zasqua init` already use.
 *
 * @version v1.6.0
 */

'use strict';

const DEFAULT_LANGUAGE = 'en-US';

/**
 * @param {object} [manifest] — the object returned by loadManifest
 * @returns {{locale: string, base: string}}
 */
function siteLanguage(manifest) {
  const tag = (manifest && manifest.ui && manifest.ui.language) || DEFAULT_LANGUAGE;
  const locale = String(tag);
  return { locale, base: locale.split('-')[0].toLowerCase() };
}

module.exports = { siteLanguage, DEFAULT_LANGUAGE };

// Version: v1.6.0
