/**
 * Repository Page — Hugo Render Tests
 *
 * `repository/single.html` renders the institution record of a repository
 * (design §5.1): a contact strip, a closed-by-default details bar holding
 * the sections, and the collection tree. These tests build the smoke
 * instance once, with three repository records, and read the rendered
 * pages:
 *
 *   - co-aeh, the full Fisqua fixture with a website, email, telephone
 *     and street address added, and raw HTML and a javascript: link added
 *     to its history. Checks the bar (present, not open), the strip, the
 *     sections, the funders list, the Markdown history, and that the HTML
 *     is escaped.
 *   - co-aem, the sparser Fisqua fixture (no holdings, history or access
 *     text, no contact links): those sections and the contact strip are
 *     absent.
 *   - co-smoke, a 1.0 flat record: the page builds, shows the flat city
 *     and country and the document count, and has no strip.
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

function writeRepositories(dir) {
  const records = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'repositories.json'), 'utf8'));
  const flat = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'repositories.json'), 'utf8'));
  const full = records.find(r => r.code === 'co-aeh');
  full.contact = {
    ...full.contact,
    street_address: 'Palacio de Justicia, Calle 1',
    postal_code: '000000',
    website: 'https://juzgado.example.org/archivo',
    email: 'archivo@example.org',
    telephone: '+57 4 123 4567',
  };
  full.history.es += '\n\n<script>alert(1)</script> y <b>negrita</b>\n\n[enlace](javascript:alert(2)) y *cursiva*';
  fs.writeFileSync(
    path.join(dir, 'exports', 'repositories.json'),
    JSON.stringify([...records, ...flat]),
    'utf8'
  );
  // The fixtures' text is Spanish
  const toml = path.join(dir, 'hugo.toml');
  fs.writeFileSync(
    toml,
    fs.readFileSync(toml, 'utf8').replace('defaultContentLanguage = "en"', 'defaultContentLanguage = "es"'),
    'utf8'
  );
}

/**
 * The build is minified, which drops attribute quotes. Put them back inside
 * tags so the assertions can read ordinary markup.
 */
function readRepo(dir, code) {
  return readPage(dir, code).replace(/<[^>]+>/g, tag =>
    tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
}

describe('repository page', () => {
  let dir;
  let full;
  let sparse;
  let flat;

  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-repo-page-test-', prepare: writeRepositories });
    full = readRepo(dir, 'co-aeh');
    sparse = readRepo(dir, 'co-aem');
    flat = readRepo(dir, 'co-smoke');
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('full record (co-aeh)', () => {
    it('has the record bar, closed by default', () => {
      expect(full).toMatch(/<details class="repo-record">/);
      expect(full).not.toMatch(/<details[^>]*\bopen\b/);
      expect(full).toContain('Sobre el repositorio');
    });

    it('has the contact strip with a host-text website, mailto and tel links', () => {
      expect(full).toContain('class="repo-keyinfo"');
      expect(full).toContain('<a href="https://juzgado.example.org/archivo">juzgado.example.org</a>');
      expect(full).toContain('href="mailto:archivo@example.org"');
      expect(full).toContain('href="tel:+5741234567"');
      expect(full.indexOf('repo-keyinfo')).toBeLessThan(full.indexOf('<details'));
    });

    it('shows the place and count in the header', () => {
      expect(full).toMatch(/Ciudad de Ejemplo, Región de Ejemplo, Colombia · 276 documentos/);
    });

    it('has the sections that have content', () => {
      for (const h of ['Identificación', 'Descripción', 'Servicios', 'Reutilización', 'Financiación y proyectos', 'Control']) {
        expect(full).toContain(`<h3>${h}</h3>`);
      }
      expect(full).not.toContain('<h3>Acceso</h3>');
      expect(full).toContain('<div class="desc-notice-title">Contacto</div>');
      expect(full).toContain('Example Historical Archive, Archivo del Juzgado de Ejemplo');
      expect(full).toContain('Palacio de Justicia, Calle 1');
      expect(full).toContain('Ciudad de Ejemplo, Región de Ejemplo, Colombia 000000');
    });

    it('lists the funders with programme, project id and link', () => {
      expect(full).toContain('<a href="https://example.org/ex-0001">Fundación de Ejemplo — Programa de Archivos en Riesgo (EX-0001)</a>');
      expect(full).toContain('<li>Universidad de Ejemplo</li>');
    });

    it('links the image licence and shows the attribution', () => {
      expect(full).toContain('<a href="http://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>');
      expect(full).toContain('Digitalizado en el marco del Programa de Archivos en Riesgo');
    });

    it('renders the history from Markdown, in two paragraphs', () => {
      expect(full).toMatch(/<p>Los expedientes de este archivo/);
      expect(full).toMatch(/<p>Los expedientes se clasificaron/);
      expect(full).toContain('<em>cursiva</em>');
    });

    it('does not render HTML or javascript: links from a prose field', () => {
      expect(full).not.toContain('<script>alert');
      expect(full).not.toContain('<b>negrita</b>');
      expect(full).not.toMatch(/href="javascript:/i);
      expect(full).toContain('&lt;b>negrita&lt;/b>');
    });

    it('shows the date of description from updated_at', () => {
      expect(full).toContain('Esta descripción se actualizó por última vez el 2026-11-03.');
    });

    it('omits the language row when description_language is null', () => {
      expect(full).not.toContain('Idioma de la descripción');
    });
  });

  describe('sparse record (co-aem)', () => {
    it('omits the sections with no content and the contact strip', () => {
      for (const h of ['Descripción', 'Acceso']) {
        expect(sparse).not.toContain(`<h3>${h}</h3>`);
      }
      expect(sparse).not.toContain('class="repo-keyinfo"');
    });

    it('keeps the identification, control and contact sections', () => {
      expect(sparse).toContain('<h3>Identificación</h3>');
      expect(sparse).toContain('<h3>Control</h3>');
      expect(sparse).toContain('<h3>Servicios</h3>');
      expect(sparse).toContain('<li>Alcaldía de Ejemplo</li>');
      expect(sparse).toContain('<div class="desc-notice-title">Contacto</div>');
      expect(sparse).toContain('Ciudad de Ejemplo, Región de Ejemplo, Colombia');
      expect(sparse).not.toContain('Otras formas del nombre');
    });

    it('still renders the tree section and the bar', () => {
      expect(sparse).toContain('<h3>Fondos y colecciones</h3>');
      expect(sparse).toMatch(/<details class="repo-record">/);
    });
  });

  describe('flat 1.0 record (co-smoke)', () => {
    it('builds and shows the flat city and country with the count', () => {
      expect(flat).toContain('Bogotá, Colombia · 2 documentos');
      expect(flat).toContain('<h1 class="repo-header-title font-sans text-white">Archivo de Humo</h1>');
    });

    it('has no contact strip and no optional sections', () => {
      expect(flat).not.toContain('class="repo-keyinfo"');
      for (const h of ['Descripción', 'Acceso', 'Servicios', 'Reutilización', 'Financiación y proyectos']) {
        expect(flat).not.toContain(`<h3>${h}</h3>`);
      }
      expect(flat).toContain('<div class="desc-notice-title">Contacto</div>');
    });
  });
});

// Version: v1.6.0
