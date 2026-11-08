/**
 * Site-Name Interface Strings Tests
 *
 * Interface strings that named the site with a fixed word now name it with
 * the template field `{{ .Site }}`, and each caller passes the site title.
 * These tests parse both bundles to check that no such string keeps the
 * fixed name, then build a small Hugo site titled "Archivo de Prueba" from
 * the real bundles and check that the title appears where the fixed name
 * used to: the description reuse blurbs, the entity explorer intro, the
 * entity focal tail, the graph and connected-documents sentences, and the
 * search page's hosted-images filter option and pill.
 *
 * Version: v1.6.0
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parse } = require('smol-toml');
const { REQUIRED_KEYS } = require('../lib/i18n-keys.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const I18N = path.join(ROOT, 'themes', 'base', 'i18n');
const HUGO = path.join(ROOT, 'node_modules', '.bin', 'hugo');
const TITLE = 'Archivo de Prueba';

const KEYS = [
  'search.landingP1',
  'description.reuseBlurbIiif',
  'description.reuseBlurb',
  'entity.explorerIntro',
  'entity.reuseBlurb',
  'entity.focal.tail',
  'place.explorerIntro',
  'place.reuseBlurb',
  'search.digitalStatus.hosted',
  'search.digitalStatusPill.hosted',
];
const PLURALS = ['graph.connectedToSite', 'entity.connectedOtherDocs'];

const get = (t, k) => k.split('.').reduce((o, p) => o[p], t);

describe('bundles', () => {
  for (const lang of ['en', 'es']) {
    const t = parse(fs.readFileSync(path.join(I18N, `${lang}.toml`), 'utf8'));
    it(`${lang}: site-naming strings use {{ .Site }}, not a fixed name`, () => {
      for (const k of KEYS) {
        expect(get(t, k), k).toContain('{{ .Site }}');
        expect(get(t, k), k).not.toMatch(/Zasqua/);
      }
      for (const k of PLURALS) {
        for (const form of ['one', 'other']) {
          expect(get(t, k)[form], `${k}.${form}`).toContain('{{ .Site }}');
          expect(get(t, k)[form], `${k}.${form}`).not.toMatch(/Zasqua/);
          expect(get(t, k)[form], `${k}.${form}`).toContain('{count}');
        }
      }
    });
    it(`${lang}: connectedToZasqua stays as a deprecated alias`, () => {
      expect(t.graph.connectedToZasqua.one).toContain('Zasqua');
    });
  }
  it('registers connectedToSite and not the old key', () => {
    expect(REQUIRED_KEYS).toContain('graph.connectedToSite');
    expect(REQUIRED_KEYS).not.toContain('graph.connectedToZasqua');
  });
});

describe('rendered with a site titled "Archivo de Prueba"', () => {
  let dir;
  const out = {};
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-sitename-test-'));
    for (const lang of ['en', 'es']) {
      const sub = lang === 'en' ? 'en' : 'es';
      fs.mkdirSync(path.join(dir, 'i18n'), { recursive: true });
      fs.copyFileSync(path.join(I18N, `${lang}.toml`), path.join(dir, 'i18n', `${sub}.toml`));
      fs.mkdirSync(path.join(dir, 'layouts'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, `hugo.${lang}.toml`),
        `title = "${TITLE}"\ndefaultContentLanguage = "${lang}"\ndisableKinds = ["taxonomy","term","section","page","sitemap","RSS"]\n`
      );
    }
    const S = '(dict "Site" site.Title)';
    const plural = (k, n) => `(i18n "${k}" (dict "Count" ${n} "Site" site.Title))`;
    fs.writeFileSync(
      path.join(dir, 'layouts', 'home.html'),
      [
        `reuseIiif=${'{{ i18n "description.reuseBlurbIiif" ' + S + ' }}'}`,
        `reuse=${'{{ i18n "description.reuseBlurb" ' + S + ' }}'}`,
        `intro=${'{{ i18n "entity.explorerIntro" ' + S + ' }}'}`,
        `tail=${'{{ i18n "entity.focal.tail" ' + S + ' }}'}`,
        `landing=${'{{ i18n "search.landingP1" ' + S + ' }}'}`,
        `hosted=${'{{ i18n "search.digitalStatus.hosted" ' + S + ' }}'}`,
        `pill=${'{{ i18n "search.digitalStatusPill.hosted" ' + S + ' }}'}`,
        `graph1=${'{{ ' + plural('graph.connectedToSite', 1) + ' }}'}`,
        `graph2=${'{{ ' + plural('graph.connectedToSite', 2) + ' }}'}`,
        `docs1=${'{{ ' + plural('entity.connectedOtherDocs', 1) + ' }}'}`,
        `docs2=${'{{ ' + plural('entity.connectedOtherDocs', 2) + ' }}'}`,
      ].join('\n')
    );
    for (const lang of ['en', 'es']) {
      const dest = path.join(dir, `out-${lang}`);
      execFileSync(HUGO, ['--quiet', '--config', `hugo.${lang}.toml`, '-d', dest], {
        cwd: dir,
        stdio: 'pipe',
      });
      const html = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
      out[lang] = Object.fromEntries(
        html
          .replace(/&#34;/g, '"')
          .split('\n')
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
      );
    }
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('names the site in the hosted-images strings and the graph sentence', () => {
    expect(out.es.hosted).toBe(`Sí, disponibles en ${TITLE}`);
    expect(out.es.pill).toBe(`Disponibles en ${TITLE}`);
    expect(out.es.graph1).toBe(`Conectado a {count} entidad más en ${TITLE}.`);
    expect(out.en.pill).toBe(`Available on ${TITLE}`);
    expect(out.en.graph1).toBe(`Connected to {count} more entity in ${TITLE}.`);
  });

  for (const lang of ['en', 'es']) {
    it(`${lang}: the title replaces the fixed name`, () => {
      for (const [name, text] of Object.entries(out[lang])) {
        expect(text, name).toContain(TITLE);
        expect(text, name).not.toMatch(/Zasqua/);
      }
    });
    it(`${lang}: {count} survives for the client and the plural form is chosen`, () => {
      expect(out[lang].graph1).toContain('{count}');
      expect(out[lang].graph1).not.toBe(out[lang].graph2);
      expect(out[lang].docs1).toContain('{count}');
      expect(out[lang].docs1).not.toBe(out[lang].docs2);
    });
  }
});

// Version: v1.6.0
