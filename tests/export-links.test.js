/**
 * Links built from export data — Hugo render tests
 *
 * A few links are assembled as markup before Hugo sees them, because an
 * i18n sentence receives the link as a value: the catalogue licence on
 * description pages and the publisher's website in the colophon. Hugo's
 * own escaping does not reach markup built that way, so these tests feed
 * hostile values through repositories.json and publisher.json and check
 * that none comes out executable: a `javascript:` address gives plain text
 * instead of a link, and a language key that is not a language tag gives
 * no `lang` attribute and no markup of its own.
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
const DESC = 'co-smoke-f001';

function prepare(dir) {
  const exp = path.join(dir, 'exports');
  const repos = JSON.parse(fs.readFileSync(path.join(exp, 'repositories.json'), 'utf8'));
  repos[0].catalogue_licence = {
    uri: 'javascript:alert(document.domain)',
    label: { 'zz"><img src=x onerror=alert(1)>': 'Hostile licence' },
  };
  fs.writeFileSync(path.join(exp, 'repositories.json'), JSON.stringify(repos), 'utf8');
  const pub = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'publisher.json'), 'utf8'));
  pub.legal_name = 'Hostile Foundation';
  pub.website = 'javascript:alert(1)';
  fs.writeFileSync(path.join(exp, 'publisher.json'), JSON.stringify(pub), 'utf8');
}

describe('links built from export data', () => {
  let dir;
  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-export-links-', prepare });
  }, BUILD_TIMEOUT_MS);
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives no link for a javascript: catalogue licence', () => {
    const html = readPage(dir, DESC);
    expect(html).not.toMatch(/href=["']?javascript:/i);
    expect(html).toContain('Hostile licence');
  });

  it('lets no markup through a language key', () => {
    const html = readPage(dir, DESC);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/onerror=alert/);
  });

  it('gives no link for a javascript: publisher website', () => {
    const html = readPage(dir, 'colofon');
    expect(html).toContain('Hostile Foundation');
    expect(html).not.toMatch(/href=["']?javascript:/i);
  });
});

// Version: v1.6.0
