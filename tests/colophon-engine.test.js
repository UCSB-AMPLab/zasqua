/**
 * Colophon Engine Section — Hugo Render Tests
 *
 * The colophon page (`colofon/list.html`) ends with a section on the
 * engine (`<section id="zasqua">`), on every site, with or without a
 * publisher.json. The engine draws no mark above the site's own text.
 * Builds the smoke instance (English by default; Spanish through hugo.toml) in four variants:
 * Spanish without publisher.json, Spanish with the publisher fixture,
 * Spanish with `logo` set, and English with the publisher fixture.
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
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

function writeColophon(dir) {
  fs.mkdirSync(path.join(dir, 'content', 'colofon'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'content', 'colofon', '_index.md'),
    '---\ntitle: Colophon\n---\n\nDeployer prose.\n',
    'utf8'
  );
}

/** The smoke instance is English; Hugo reads the interface language from hugo.toml. */
function spanish(dir) {
  const toml = path.join(dir, 'hugo.toml');
  fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8')
    .replace('languageCode = "en-US"', 'languageCode = "es-CO"')
    .replace('defaultContentLanguage = "en"', 'defaultContentLanguage = "es"'), 'utf8');
}

function withPublisher(dir) {
  fs.copyFileSync(path.join(FIXTURES, 'publisher.json'), path.join(dir, 'exports', 'publisher.json'));
}

/** The build is minified, which drops attribute quotes; put them back inside tags. */
function read(dir) {
  return fs.readFileSync(path.join(dir, 'public', 'colofon', 'index.html'), 'utf8').replace(/<[^>]+>/g, tag =>
    tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
}

function build(prefix, prepare, params = null) {
  const dir = buildSmokeInstance(params, { prefix, prepare });
  return { dir, html: read(dir) };
}

describe('colophon engine section', () => {
  let esNone, esPub, esLogo, enPub;

  beforeAll(() => {
    esNone = build('zasqua-ce-none-', d => { writeColophon(d); spanish(d); });
    esPub = build('zasqua-ce-pub-', d => { writeColophon(d); spanish(d); withPublisher(d); });
    esLogo = build('zasqua-ce-logo-', d => { writeColophon(d); spanish(d); }, '[params]\n  logo = "/img/site-logo.svg"');
    enPub = build('zasqua-ce-en-', d => { writeColophon(d); withPublisher(d); });
  }, BUILD_TIMEOUT_MS * 4);

  afterAll(() => {
    for (const b of [esNone, esPub, esLogo, enPub]) if (b) fs.rmSync(b.dir, { recursive: true, force: true });
  });

  it('closes a Spanish colophon without publisher.json with the engine section', () => {
    const h = esNone.html;
    expect(h).toMatch(/<section id="?zasqua"?[^>]*>/);
    expect(h).toContain('<img src="/img/zasqua-engine/mark.svg"');
    expect(h).toContain('El motor Zasqua');
    expect(h).toContain(`Este sitio está hecho con Zasqua, versión ${VERSION}, software de `);
    expect(h).toMatch(/<a href="https:\/\/github.com\/UCSB-AMPLab\/zasqua"[^>]*>código abierto<\/a>/);
    expect(h).toMatch(/<a href="https:\/\/ampl.clair.ucsb.edu"[^>]*>Laboratorio de Archivos, Memoria y Preservación \(AMPL\)<\/a>/);
    expect(h).not.toContain('Responsable del sitio');
    // the section is the last block of the article, with no other heading after it
    expect(h.slice(h.indexOf('id="zasqua"')).match(/<h2/g)).toHaveLength(1);
  });

  it('places the engine section after the publisher sections', () => {
    const h = esPub.html;
    expect(h).toContain('Responsable del sitio');
    expect(h.indexOf('Responsable del sitio')).toBeLessThan(h.indexOf('id="zasqua"'));
  });

  it('draws no engine mark above the site text when logo is set', () => {
    const h = esLogo.html;
    const body = h.slice(h.indexOf('<article'));
    expect(body.slice(0, body.indexOf('Deployer prose.'))).not.toContain('<img');
  });

  it('is English on an English site, with the publisher heading "Publisher"', () => {
    const h = enPub.html;
    expect(h).toContain('The Zasqua engine');
    expect(h).toContain('This site is built with Zasqua, version ');
    expect(h).toContain('>open-source</a>');
    expect(h).toContain('>Publisher<');
  });
});

// Version: v1.6.0
