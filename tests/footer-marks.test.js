/**
 * Footer Marks — Hugo Render Tests
 *
 * The footer (`_partials/footer.html`) draws the site's mark and seals
 * from two optional settings, `footer_logo` and `footer_seals`, and the
 * engine's own credit with its pomegranate (`framework-credit.html`).
 * These tests build the smoke instance four times and read the home page:
 *
 *   - "set": both settings present; one seal has an href, one does not.
 *   - "bare": no settings and no publisher.json.
 *   - "empty": `footer_seals = []` with the full publisher record.
 *   - "publisher": the full publisher record and no settings.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSmokeInstance, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'fisqua-institutions');

function writePublisher(dir) {
  const pub = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'publisher.json'), 'utf8'));
  pub.logo_url = 'https://example.org/logo.svg';
  pub.credits = [
    { name: 'Partner Lab', role: 'partner', url: 'https://lab.example.org', logo_url: 'https://example.org/lab.png' },
    { name: 'Funder Fund', role: 'funder', url: null, logo_url: null },
  ];
  fs.writeFileSync(path.join(dir, 'exports', 'publisher.json'), JSON.stringify(pub), 'utf8');
}

/** The build is minified, which drops attribute quotes; put them back inside tags. */
function readHome(dir) {
  return fs.readFileSync(path.join(dir, 'public', 'index.html'), 'utf8').replace(/<[^>]+>/g, tag =>
    tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
}

const SET_PARAMS = `
[params]
  [params.footer_logo]
    src = "/img/site-mark.svg"
    alt = "Site"
    href = "https://example.org/"
  [[params.footer_seals]]
    src = "/img/seal-a.svg"
    alt = "Seal A"
    href = "https://a.example.org/"
  [[params.footer_seals]]
    src = "/img/seal-b.svg"
    alt = "Seal B"
`;

describe('footer marks', () => {
  const dirs = [];
  let set, bare, empty, publisher, three, noHref, noSrc;

  beforeAll(() => {
    const make = (params, prefix, prepare) => {
      const dir = buildSmokeInstance(params, { prefix, prepare });
      dirs.push(dir);
      return readHome(dir);
    };
    set = make(SET_PARAMS, 'zasqua-fm-set-');
    bare = make(null, 'zasqua-fm-bare-');
    empty = make('\n[params]\n  footer_seals = []\n', 'zasqua-fm-empty-', writePublisher);
    publisher = make(null, 'zasqua-fm-pub-', writePublisher);
    three = make(`
[params]
  [[params.footer_seals]]
    src = "/img/s1.svg"
    alt = "S1"
  [[params.footer_seals]]
    src = "/img/s2.svg"
    alt = "S2"
  [[params.footer_seals]]
    src = "/img/s3.svg"
    alt = "S3"
`, 'zasqua-fm-three-');
    noHref = make('\n[params]\n  [params.footer_logo]\n    src = "/img/plain.svg"\n    alt = "Plain"\n', 'zasqua-fm-nohref-');
    noSrc = make('\n[params]\n  [params.footer_logo]\n    alt = "Nothing"\n', 'zasqua-fm-nosrc-', writePublisher);
  }, BUILD_TIMEOUT_MS * 7);

  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  describe('footer_logo and footer_seals set', () => {
    it('draws the mark linked to its href', () => {
      expect(set).toMatch(/<a href="https:\/\/example.org\/"[^>]*><img src="\/img\/site-mark.svg" alt="Site" class="footer-mark">/);
    });

    it('draws both seals, the one without href as a plain image', () => {
      expect(set.match(/class="footer-seal"/g)).toHaveLength(2);
      expect(set).toMatch(/<a href="https:\/\/a.example.org\/"[^>]*><img src="\/img\/seal-a.svg" alt="Seal A" class="footer-seal">/);
      expect(set).toMatch(/<img src="\/img\/seal-b.svg" alt="Seal B" class="footer-seal">/);
      expect(set).not.toMatch(/<a [^>]*><img src="\/img\/seal-b.svg"/);
    });

    it('draws the rule', () => {
      expect(set).toContain('footer-rule');
    });
  });

  describe('nothing set, no publisher.json', () => {
    it('draws no mark, rule or seals block', () => {
      expect(bare).not.toContain('footer-mark');
      expect(bare).not.toContain('footer-rule');
      expect(bare).not.toContain('footer-seals');
    });

    it('draws the engine credit with its pomegranate linked to the colophon section', () => {
      expect(bare).toContain('footer-engine');
      expect(bare).toMatch(/<a href="\/colofon\/#zasqua"[^>]*><img src="\/img\/zasqua-engine\/mark-small.svg"/);
    });
  });

  describe('footer_seals = [] with the full publisher record', () => {
    it('draws no seals and no rule, and does not fall back to the credits', () => {
      expect(empty).not.toContain('footer-seal');
      expect(empty).not.toContain('footer-rule');
    });

    it('still draws the publisher logo as the mark', () => {
      expect(empty).toContain('class="footer-mark"');
    });
  });

  describe('publisher record, no settings', () => {
    it('draws the publisher logo as the mark, linked to its website', () => {
      expect(publisher).toMatch(/<a href="https:\/\/example.org"[^>]*><img src="https:\/\/example.org\/logo.svg" alt="Archivo de Ejemplo" class="footer-mark">/);
    });

    it('draws the credit logos as seals', () => {
      expect(publisher.match(/class="footer-seal"/g)).toHaveLength(1);
      expect(publisher).toMatch(/<a href="https:\/\/lab.example.org"[^>]*><img src="https:\/\/example.org\/lab.png" alt="Partner Lab" class="footer-seal">/);
      expect(publisher).toContain('footer-rule');
    });
  });

  describe('three seals', () => {
    it('keeps the second and later seals together in .footer-seals-more, after the first', () => {
      expect(three.match(/class="footer-seal"/g)).toHaveLength(3);
      const block = three.slice(three.indexOf('<div class="footer-seals">'));
      const more = block.indexOf('<div class="footer-seals-more">');
      expect(more).toBeGreaterThan(block.indexOf('s1.svg'));
      expect(block.indexOf('s2.svg')).toBeGreaterThan(more);
      expect(block.indexOf('s3.svg')).toBeGreaterThan(more);
      expect(block.slice(0, more)).not.toContain('s2.svg');
    });

    it('draws no wrapper for a single seal', () => {
      expect(publisher).not.toContain('footer-seals-more');
    });
  });

  describe('footer_logo without href', () => {
    it('draws a plain image', () => {
      expect(noHref).toMatch(/<img src="\/img\/plain.svg" alt="Plain" class="footer-mark">/);
      expect(noHref).not.toMatch(/<a [^>]*><img src="\/img\/plain.svg"/);
    });
  });

  describe('footer_logo without src', () => {
    it('falls back to the publisher logo', () => {
      expect(noSrc).toMatch(/<img src="https:\/\/example.org\/logo.svg" alt="Archivo de Ejemplo" class="footer-mark">/);
      expect(noSrc).not.toContain('Nothing');
    });
  });

  it('keeps the credit comment in framework-credit.html', () => {
    const src = fs.readFileSync(path.join(ENGINE_ROOT, 'themes/base/layouts/_partials/framework-credit.html'), 'utf8');
    expect(src).toContain('We would be grateful if you kept this credit.');
  });
});

// Version: v1.6.0
