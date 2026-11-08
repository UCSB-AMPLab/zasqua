/**
 * Home Repository Cards — Hugo Render Tests
 *
 * `index.html` renders one card per repository record (design §6.1,
 * question 9). These tests build the smoke instance once with four
 * records and read the home page:
 *
 *   - co-aem (home_order 1) and co-aeh (home_order 2), Fisqua records
 *     with contact.city and contact.region;
 *   - co-beta, no home_order, display_title null (the card falls back to
 *     name), contact.region null (the category drops the comma);
 *   - co-smoke, a 1.0 flat record with no home_order, subtitle or contact.
 *
 * Checks the order (home_order ascending, then name), the title fallback,
 * the category line, the /{code}/ links, the no-image card, and that the
 * 1.0 record still renders a card. A second build sets `home_cards` in
 * hugo.toml: one card takes another link and category, another only a
 * category and keeps its /{code}/ link.
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

function writeRepositories(dir) {
  const records = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'repositories.json'), 'utf8'));
  const flat = JSON.parse(fs.readFileSync(path.join(dir, 'exports', 'repositories.json'), 'utf8'));
  records.find(r => r.code === 'co-aem').home_order = 1;
  records.find(r => r.code === 'co-aeh').home_order = 2;
  const beta = {
    ...records[0],
    code: 'co-beta',
    name: 'Archivo Beta',
    display_title: null,
    home_order: null,
    contact: { city: 'Medellín', region: null, country: 'Colombia' },
  };
  fs.writeFileSync(
    path.join(dir, 'exports', 'repositories.json'),
    JSON.stringify([...flat, beta, ...records]),
    'utf8'
  );
}

// One card points elsewhere and names its own category; another sets only
// the category, so its link stays the repository page.
const HOME_CARDS = `[params.home_cards.co-aeh]
  link = "/co-aeh-fondo/"
  category = "Fuentes de ejemplo"
[params.home_cards.co-beta]
  category = "Solo categoría"`;

describe('home repository cards', () => {
  let dir;
  let home;

  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-home-cards-test-', prepare: writeRepositories });
    // The build is minified, which drops attribute quotes; put them back inside tags
    home = fs.readFileSync(path.join(dir, 'public', 'index.html'), 'utf8').replace(/<[^>]+>/g, tag =>
      tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('orders by home_order, then by name', () => {
    const hrefs = [...home.matchAll(/<a href="\/(co-[a-z]+)\/" class="repo-link/g)].map(m => m[1]);
    expect(hrefs).toEqual(['co-aem', 'co-aeh', 'co-beta', 'co-smoke']);
  });

  it('falls back to name when display_title is null', () => {
    expect(home).toContain('<h3 class="repo-caption-title">Archivo Beta</h3>');
  });

  it('builds the category line from contact.city and contact.region', () => {
    // co-aeh and co-aem share the city and region, so both cards carry this line.
    expect(home.split('<p class="repo-caption-category">Ciudad de Ejemplo, Región de Ejemplo</p>').length - 1).toBe(2);
  });

  it('drops an empty region with its comma', () => {
    expect(home).toContain('<p class="repo-caption-category">Medellín</p>');
  });

  it('renders a 1.0 flat record as a card with its flat city and no subtitle', () => {
    expect(home).toContain('<h3 class="repo-caption-title">Archivo de Humo</h3>');
    expect(home).toContain('<p class="repo-caption-category">Bogotá</p>');
    expect(home).toContain('<a href="/co-smoke/" class="repo-link repo-link-plain">');
  });

  it('gives a card without an image the plain class and no img', () => {
    expect(home).not.toContain('class="repo-image"');
    expect(home).toContain('repo-link-plain');
  });

  it('shows the subtitle in the record language when the site language lacks it', () => {
    expect(home).toMatch(/<span lang="es">Catálogos y materiales digitalizados en el Archivo Municipal de Ejemplo/);
  });
});

describe('home_cards setting', () => {
  let dir;
  let home;

  beforeAll(() => {
    dir = buildSmokeInstance(HOME_CARDS, { prefix: 'zasqua-home-cards-param-', prepare: writeRepositories });
    home = fs.readFileSync(path.join(dir, 'public', 'index.html'), 'utf8').replace(/<[^>]+>/g, tag =>
      tag.replace(/(\s[\w-]+)=([^\s"'>]+)/g, '$1="$2"'));
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('takes a card\'s link and category from home_cards', () => {
    expect(home).toContain('<a href="/co-aeh-fondo/" class="repo-link');
    expect(home).not.toContain('<a href="/co-aeh/"');
    expect(home).toContain('<p class="repo-caption-category">Fuentes de ejemplo</p>');
    // co-aem keeps its own place caption; co-aeh's is replaced by the category.
    expect(home.split('<p class="repo-caption-category">Ciudad de Ejemplo, Región de Ejemplo</p>').length - 1).toBe(1);
  });

  it('keeps the repository link when home_cards sets only the category', () => {
    expect(home).toContain('<a href="/co-beta/" class="repo-link');
    expect(home).toContain('<p class="repo-caption-category">Solo categoría</p>');
  });
});

// Version: v1.6.0
