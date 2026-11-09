/**
 * Footer and Colophon — Hugo Render Tests
 *
 * The footer (`_partials/footer.html`) and the colophon page
 * (`colofon/list.html`) read the publisher record (design §5.2). These
 * tests build the smoke instance three times and read /colofon/ and the
 * home page footer:
 *
 *   - "fixture": the Fisqua fixture publisher.json as exported (legal
 *     name, tax id, location, website, email; no logo, texts or credits).
 *   - "full": the same record with a logo, bilingual texts (one with only
 *     the English member), citation templates, credits (one with a logo)
 *     and a footer_tagline; repositories with catalogue licences.
 *   - "none": no publisher.json. The footer is today's footer and the
 *     colophon shows only the page content.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSmokeInstance, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'fisqua-institutions');
const YEAR = String(new Date().getFullYear());

function readPublisher() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, 'publisher.json'), 'utf8'));
}

function writeColophon(dir) {
  fs.mkdirSync(path.join(dir, 'content', 'colofon'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'content', 'colofon', '_index.md'),
    '---\ntitle: Colophon\n---\n\nDeployer prose.\n',
    'utf8'
  );
}

function prepareFixture(dir) {
  writeColophon(dir);
  fs.copyFileSync(path.join(FIXTURES, 'publisher.json'), path.join(dir, 'exports', 'publisher.json'));
}

function prepareFull(dir) {
  writeColophon(dir);
  const pub = readPublisher();
  pub.logo_url = 'https://example.org/logo.svg';
  pub.description = { es: null, en: 'About **the publisher**.' };
  pub.terms_of_use = { es: null, en: 'Terms of use text.' };
  pub.privacy = { es: 'Texto de privacidad.', en: null };
  pub.takedown = { es: 'Retiro en español.', en: 'Takedown text.' };
  pub.citation_template = {
    site: { es: null, en: '{site}, {url}, {year}, v{version}. Kept: {title}.' },
    record: { es: null, en: null },
  };
  pub.credits = [
    { name: 'Partner Lab', role: 'partner', url: 'https://lab.example.org', logo_url: 'https://example.org/lab.png' },
    { name: 'Funder Fund', role: 'funder', url: null, logo_url: null },
  ];
  fs.writeFileSync(path.join(dir, 'exports', 'publisher.json'), JSON.stringify(pub), 'utf8');

  const records = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'repositories.json'), 'utf8'));
  const flat = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'repositories.json'), 'utf8'));
  records[0].catalogue_licence = {
    uri: 'https://creativecommons.org/licenses/by/4.0/',
    label: { es: 'CC BY 4.0', en: null },
  };
  fs.writeFileSync(path.join(dir, 'exports', 'repositories.json'), JSON.stringify([...records, ...flat]), 'utf8');

  const toml = path.join(dir, 'hugo.toml');
  fs.appendFileSync(toml, '\n[params]\n  version = "9.9.9"\n  footer_tagline = "A tagline."\n', 'utf8');
}

/** The build is minified, which drops attribute quotes; put them back inside tags. */
function read(dir, rel) {
  return fs.readFileSync(path.join(dir, 'public', rel), 'utf8').replace(/<[^>]+>/g, tag =>
    tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
}

function build(prefix, prepare) {
  const dir = buildSmokeInstance(null, { prefix, prepare });
  return { dir, colophon: read(dir, 'colofon/index.html'), home: read(dir, 'index.html') };
}

describe('footer and colophon', () => {
  const dirs = [];
  let fixture, full, none, stars;

  beforeAll(() => {
    // The full variant adds a [params] table itself, so it passes through prepare
    fixture = build('zasqua-fc-fixture-', prepareFixture);
    full = build('zasqua-fc-full-', prepareFull);
    none = build('zasqua-fc-none-', writeColophon);
    // A site title with Markdown characters is shown as written
    stars = build('zasqua-fc-stars-', dir => {
      prepareFull(dir);
      const toml = path.join(dir, 'hugo.toml');
      fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8').replace('title = "Smoke Test Archive"', 'title = "*Archive*"'), 'utf8');
    });
    dirs.push(fixture.dir, full.dir, none.dir, stars.dir);
  }, BUILD_TIMEOUT_MS * 4);

  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  describe('without publisher.json', () => {
    it('keeps today\'s footer', () => {
      expect(none.home).toContain(`<p class="footer-copyright">© ${YEAR}.`);
      expect(none.home).not.toContain('footer-tagline');
      expect(none.home).not.toContain('footer-seals');
      expect(none.home).not.toContain('footer-seal"');
      expect(none.home).not.toContain('footer-mark');
    });

    it('shows only the page content in the colophon', () => {
      expect(none.colophon).toContain('Deployer prose.');
      expect(none.colophon).not.toMatch(/<h2[^>]*>(Publisher|Credits|Represented archives|How to cite|License|Privacy and data|Takedown policy|Contact)</);
    });
  });

  describe('fixture publisher.json', () => {
    it('puts the legal name in the copyright line', () => {
      expect(fixture.home).toContain(`© ${YEAR} Fundación Archivo de Ejemplo.`);
    });

    it('omits tagline and seals when none is set', () => {
      expect(fixture.home).not.toContain('footer-tagline');
      expect(fixture.home).not.toContain('footer-seals');
      expect(fixture.home).not.toContain('footer-mark');
    });

    it('renders the publisher and contact sections only', () => {
      expect(fixture.colophon).toContain('>Publisher<');
      expect(fixture.colophon).toContain('NIT 000.000.000-0');
      expect(fixture.colophon).toContain('Bogotá, Colombia');
      expect(fixture.colophon).toContain('<a href="mailto:contacto@example.org">');
      expect(fixture.colophon).toContain('>Contact<');
      expect(fixture.colophon).not.toContain('>Credits<');
      expect(fixture.colophon).not.toContain('>How to cite<');
      expect(fixture.colophon).not.toContain('>License<');
      expect(fixture.colophon).not.toContain('>Privacy and data<');
      expect(fixture.colophon).not.toContain('>Takedown policy<');
    });

    it('lists the represented archives, linked and sorted by name', () => {
      expect(fixture.colophon).toContain('>Represented archives<');
      expect(fixture.colophon).toContain('<a href="/co-smoke/">Archivo de Humo</a> — Bogotá, Colombia');
      const names = [...fixture.colophon.matchAll(/<li><a href="\/[a-z-]+\/">([^<]+)</g)].map(m => m[1]);
      expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y)));
    });
  });

  describe('full publisher.json', () => {
    it('renders tagline, the publisher mark and seals in the footer', () => {
      expect(full.home).toContain('<p class="footer-tagline">A tagline.</p>');
      expect(full.home).toContain('<div class="footer-seals">');
      expect(full.home).toMatch(/<a href="https:\/\/example.org"[^>]*><img src="https:\/\/example.org\/logo.svg" alt="Archivo de Ejemplo" class="footer-mark">/);
      expect(full.home).toMatch(/<a href="https:\/\/lab.example.org"[^>]*><img src="https:\/\/example.org\/lab.png" alt="Partner Lab" class="footer-seal">/);
      expect(full.home).not.toContain('Funder Fund');
    });

    it('renders the credits with role labels', () => {
      expect(full.colophon).toContain('>Credits<');
      expect(full.colophon).toMatch(/<a href="https:\/\/lab.example.org"[^>]*>Partner Lab<\/a> · Partner/);
      expect(full.colophon).toContain('Funder Fund · Funder');
    });

    it('renders prose with Markdown, marked with lang when the other language is shown', () => {
      expect(full.colophon).toContain('<strong>the publisher</strong>');
      expect(full.colophon).not.toContain('<div lang="en">');
      expect(full.colophon).toContain('Terms of use text.');
      expect(full.colophon).toMatch(/<div lang="?es"?>\s*<p>Texto de privacidad\.<\/p>\s*<\/div>/);
      expect(full.colophon).toContain('Takedown text.');
      expect(full.colophon).not.toContain('Retiro en español.');
    });

    it('fills the site citation placeholders and leaves the others', () => {
      expect(full.colophon).toContain(`Smoke Test Archive, https://example.com/, ${YEAR}, v9.9.9. Kept: {title}.`);
    });

    it('fills the site citation after rendering, so a site title is not read as Markdown', () => {
      expect(stars.colophon).toContain(`*Archive*, https://example.com/, ${YEAR}, v9.9.9. Kept: {title}.`);
      expect(stars.colophon).not.toContain('<em>Archive</em>, https');
    });

    it('lists the repositories that have a catalogue licence', () => {
      expect(full.colophon).toContain('>License<');
      expect(full.colophon).toMatch(/<li>[^<]*: <span lang="?es"?><a href="https:\/\/creativecommons.org\/licenses\/by\/4.0\/"[^>]*>CC BY 4.0<\/a><\/span><\/li>/);
      expect(full.colophon.match(/CC BY 4\.0/g)).toHaveLength(1);
    });
  });
});

// Version: v1.6.0
