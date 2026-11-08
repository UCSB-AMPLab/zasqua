/**
 * Description Page and Publisher Record — Hugo Render Tests
 *
 * `descripcion/single.html` reads the record's repository and the
 * publisher record (design §3.8, §3.9, §5.2). These tests build the smoke
 * instance three times, with `co-smoke-f001` given an IIIF manifest so the
 * Images sub-block applies, and read that page:
 *
 *   - "full": the repository has a catalogue licence (label only in
 *     Spanish, on an English site) and an attribution (Spanish only);
 *     publisher.json has a record citation template that uses every
 *     placeholder plus an unknown one.
 *   - "fallback": no catalogue licence, no attribution, an
 *     image_reproduction_text; no publisher.json.
 *   - "empty": none of these fields; no publisher.json.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'fisqua-institutions');
const YEAR = String(new Date().getFullYear());
const SLUG = 'co-smoke-f001';

function prepare(dir, { repo = {}, publisher = null, title = null }) {
  const exp = path.join(dir, 'exports');
  const repos = JSON.parse(fs.readFileSync(path.join(exp, 'repositories.json'), 'utf8'));
  Object.assign(repos[0], repo);
  fs.writeFileSync(path.join(exp, 'repositories.json'), JSON.stringify(repos), 'utf8');

  const descs = JSON.parse(fs.readFileSync(path.join(exp, 'descriptions.json'), 'utf8'));
  descs[0].iiif_manifest_url = 'https://example.org/manifest.json';
  descs[0].date_expression = '1800 .. 1900';
  if (title) descs[0].title = title;
  fs.writeFileSync(path.join(exp, 'descriptions.json'), JSON.stringify(descs), 'utf8');

  if (publisher) {
    const pub = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'publisher.json'), 'utf8'));
    Object.assign(pub, publisher);
    fs.writeFileSync(path.join(exp, 'publisher.json'), JSON.stringify(pub), 'utf8');
  }
  fs.appendFileSync(path.join(dir, 'hugo.toml'), '\n[params]\n  version = "9.9.9"\n', 'utf8');
}

/** The build is minified, which drops attribute quotes; put them back inside tags. */
function build(prefix, opts) {
  const dir = buildSmokeInstance(null, { prefix, prepare: d => prepare(d, opts) });
  const html = readPage(dir, SLUG).replace(/<[^>]+>/g, tag =>
    tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
  return { dir, html };
}

describe('description page and publisher record', () => {
  /** The visible citation element. */
  const shown = h => h.match(/<(p|div) class="citation-text"[\s\S]*?<\/\1>/)[0];
  /** The copy text of the first citation button; the minifier may single-quote it. */
  const copyText = h => (h.match(/data-copy-url=(?:"([^"]*)"|'([^']*)')/) || []).slice(1).find(Boolean);
  let full, fallback, empty, md, hostile, block, links, collide, dest, forged, pct, nested;

  beforeAll(() => {
    full = build('zasqua-dp-full-', {
      repo: {
        catalogue_licence: { uri: 'https://creativecommons.org/licenses/by/4.0/', label: { es: 'CC BY 4.0', en: null } },
        attribution: { es: 'Imágenes cortesía del Archivo de Humo.', en: null },
        image_reproduction_text: 'Old reproduction text.',
        display_title: 'Smoke Display Title',
      },
      publisher: {
        citation_template: {
          site: { es: null, en: null },
          record: {
            es: null,
            en: '{title} | {date} | {reference_code} | {repository} | {url} | {site} | v{version} | {year} | {unknown}',
          },
        },
      },
    });
    fallback = build('zasqua-dp-fallback-', { repo: { image_reproduction_text: 'Reproduction text only.' } });
    empty = build('zasqua-dp-empty-', {});
    const tpl = en => ({ citation_template: { site: { es: null, en: null }, record: { es: null, en } } });
    md = build('zasqua-dp-md-', {
      publisher: tpl('*{title}* ({reference_code}). {repository}. {url}'),
    });
    hostile = build('zasqua-dp-hostile-', {
      title: '*stars* _under_ <b>x</b> {url} & "q"',
      publisher: tpl('*{title}* {foo} [x](javascript:alert(1)) [ok](https://example.org/a)'),
    });
    block = build('zasqua-dp-block-', {
      publisher: tpl('First *line*.\n\nSecond {reference_code}.'),
    });
    links = build('zasqua-dp-links-', {
      title: 'javascript:alert(1)',
      publisher: tpl('[Open]({title}) [x](vbscript:msgbox) [y](JaVaScRiPt:1) [z]( data:text/html,1) [ok](/a) [m](mailto:a@b.org)'),
    });
    collide = build('zasqua-dp-collide-', {
      title: '\ue000a\ue001 zqc7zq',
      publisher: tpl('{title} ({year}) <table>'),
    });
    dest = build('zasqua-dp-dest-', {
      publisher: tpl('[A]({url}) [B](https://example.org/{reference_code}) [C]({title})'),
      title: 'javascript:alert(1)',
    });
    forged = build('zasqua-dp-forged-', {
      title: 'Example record',
      publisher: tpl('&#xE000;a&#xE001; &#57344;a&#57345; &#x0e000;a&#X0E001;|x'),
    });
    pct = build('zasqua-dp-pct-', {
      title: '%EE%80%80e%EE%80%81 and %ee%80%80e%ee%80%81',
      publisher: tpl('{title} [L]({url}) {year}'),
    });
    nested = build('zasqua-dp-nested-', {
      title: 'Example record',
      publisher: tpl('&#xE0&#xE002;00;a&#xE0&#xE002;01;|x'),
    });
  }, BUILD_TIMEOUT_MS * 12);

  afterAll(() => {
    for (const b of [full, fallback, empty, md, hostile, block, links, collide, dest, forged, pct, nested]) if (b) fs.rmSync(b.dir, { recursive: true, force: true });
  });

  describe('catalogue licence line', () => {
    it('names the site and links the licence label to its uri', () => {
      expect(full.html).toMatch(
        /Smoke Test Archive's catalogs and descriptions are published under the <span lang="?es"?><a href="?https:\/\/creativecommons.org\/licenses\/by\/4.0\/"?[^>]*>CC BY 4\.0<\/a><\/span> license\./
      );
      expect(full.html).not.toContain('freely accessible');
    });

    it('falls back to the free-access sentence with the site title', () => {
      expect(fallback.html).toContain("Smoke Test Archive's catalogs and descriptions are freely accessible.");
      expect(fallback.html).not.toContain('published under the');
      expect(fallback.html).not.toContain('{{');
    });
  });

  describe('Images sub-block', () => {
    it('prints the attribution, marked with the language shown', () => {
      expect(full.html).toMatch(/<span lang="?es"?>Imágenes cortesía del Archivo de Humo\.<\/span>/);
      expect(full.html).not.toContain('Old reproduction text.');
    });

    it('falls back to image_reproduction_text', () => {
      expect(fallback.html).toContain('Reproduction text only.');
      expect(fallback.html).toContain('>Images<');
    });

    it('is omitted when both are empty', () => {
      expect(empty.html).not.toContain('>Images<');
    });
  });

  describe('Cómo citar', () => {
    it('fills every placeholder and leaves unknown ones', () => {
      const text = `Fondo de Humo | 1800 – 1900 | co-smoke-f001 | Smoke Display Title | https://example.com/${SLUG}/ | Smoke Test Archive | v9.9.9 | ${YEAR} | {unknown}`;
      expect(full.html).toContain('>How to cite<');
      expect(full.html).toContain(`<p class="citation-text">${text}</p>`);
      expect(full.html).toContain(`data-copy-url="${text}"`);
      expect(full.html).toContain('class="reuse-copy-btn"');
    });

    it('renders the template as inline Markdown; the copy text has no markup', () => {
      const copy = `Fondo de Humo (co-smoke-f001). Archivo de Humo. https://example.com/${SLUG}/`;
      expect(md.html).toMatch(/<p class="citation-text"><em>Fondo de Humo<\/em> \(co-smoke-f001\)\./);
      expect(copyText(md.html)).toBe(copy);
    });

    it('shows record values literally, in the page and in the copy text', () => {
      // The page and the copy text carry the title as written; "<b>" never
      // becomes an element, and the asterisks and underscores never become
      // emphasis. The build's minifier shortens "&gt;" to ">" in text.
      expect(hostile.html).toMatch(/<em>\*stars\* _under_ &lt;b>?(&gt;)?x&lt;\/b>?(&gt;)? /);
      expect(shown(hostile.html)).not.toContain('<b>x</b>');
      expect(hostile.html).not.toMatch(/<em>[^<]*<em>/);
      expect(copyText(hostile.html)).toContain('*stars* _under_ <b>x</b>');
    });

    it('does not fill a placeholder that a value contains, and keeps unknown ones', () => {
      expect(shown(hostile.html)).not.toContain('https://example.com/');
      expect(hostile.html).toMatch(/\{url\} &(amp;)? "?q/);
      expect(hostile.html).toContain('{foo}');
      expect(copyText(hostile.html)).toContain('{url}');
      expect(copyText(hostile.html)).toContain('{foo}');
    });

    it('rewrites script link targets to #', () => {
      expect(hostile.html).toMatch(/<a href="#">x<\/a>/);
      expect(hostile.html).not.toContain('javascript:');
      expect(hostile.html).toContain('href="https://example.org/a"');
      expect(copyText(hostile.html)).toMatch(/ x ok$/);
    });

    it('allows only http, https, mailto, root-relative and fragment link targets', () => {
      const h = shown(links.html);
      expect(h).not.toMatch(/javascript:|vbscript:|data:/i);
      expect(h.match(/href="#"/g)).toHaveLength(4);
      expect(h).toContain('href="/a"');
      expect(h).toContain('href="mailto:a@b.org"');
    });

    it('fills placeholders in link destinations', () => {
      const h = shown(dest.html);
      expect(h).toContain(`<a href="https://example.com/${SLUG}/">A</a>`);
      expect(h).toContain('href="https://example.org/co-smoke-f001"');
      expect(h).toContain('<a href="#">C</a>');
    });

    it('does not turn character references into sentinels', () => {
      expect(copyText(forged.html)).toBe('a a a|x');
      expect(shown(forged.html)).not.toContain('Example record');
      expect(copyText(forged.html)).not.toContain('Example record');
    });

    it('shows a title that looks like an encoded sentinel as written', () => {
      const t = '%EE%80%80e%EE%80%81 and %ee%80%80e%ee%80%81';
      expect(shown(pct.html)).toContain(t);
      expect(copyText(pct.html)).toBe(`${t} L ${YEAR}`);
    });

    it('does not turn nested character references into sentinels', () => {
      expect(shown(nested.html)).not.toContain('Example record');
      expect(copyText(nested.html)).not.toContain('Example record');
    });

    it('cannot be given a sentinel by a title', () => {
      expect(copyText(collide.html)).toBe(`a zqc7zq (${YEAR}) <table>`);
    });

    it('uses a div when the template has several paragraphs', () => {
      expect(block.html).toMatch(/<div class="citation-text"><p>First <em>line<\/em>\.<\/p>\s*<p>Second co-smoke-f001\.<\/p><\/div>/);
      expect(copyText(block.html)).toBe('First line. Second co-smoke-f001.');
    });

    it('is absent without publisher.json', () => {
      expect(empty.html).not.toContain('citation-text');
      expect(empty.html).not.toContain('>How to cite<');
      expect(fallback.html).not.toContain('citation-text');
    });
  });
});

// Version: v1.6.0
