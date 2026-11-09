/**
 * METS Link Tests
 *
 * A description page links to the record's METS file in its reuse section.
 * `deriveMetsUrl` in `scripts/generate-content.js` decides that link.
 * `zasqua mets` writes a METS file for every description, so every record
 * gets a link: the site's base plus the slug when `mets_base_url` is set,
 * else an inbound `mets_url`, else the default path. A `mets_url` written as
 * null or an empty string counts as absent; it never hides the link to a
 * file the engine wrote.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { deriveMetsUrl } = require('../scripts/generate-content.js');

const BASE = 'https://manifests.example.org/mets';

describe('deriveMetsUrl', () => {
  it('treats a null mets_url as absent', () => {
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: null }, BASE)).toBe(`${BASE}/xx-arch-001.xml`);
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: null }, null)).toBe('/mets/xx-arch-001.xml');
  });

  it('treats an empty mets_url as absent', () => {
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: '' }, BASE)).toBe(`${BASE}/xx-arch-001.xml`);
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: '' }, null)).toBe('/mets/xx-arch-001.xml');
  });

  it('uses the base and the slug when a base is set and the record has a URL', () => {
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: 'https://other.example.org/a.xml' }, BASE))
      .toBe(`${BASE}/xx-arch-001.xml`);
  });

  it('keeps the earlier behaviour when the record has no mets_url key', () => {
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001' }, BASE)).toBe(`${BASE}/xx-arch-001.xml`);
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001' }, null)).toBe('/mets/xx-arch-001.xml');
  });

  it('respects an inbound URL when no base is set', () => {
    expect(deriveMetsUrl({ reference_code: 'xx-arch-001', mets_url: '/files/a.xml' }, null)).toBe('/files/a.xml');
  });
});

// Version: v1.6.0
