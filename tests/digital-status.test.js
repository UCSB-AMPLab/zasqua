/**
 * Digital-Status Filter Value Tests
 *
 * The search facet for digitised records used the value `zasqua`, a
 * site name, for "digitised and hosted on this site". The value is
 * now `hosted`. These tests cover the three places that deal with it:
 * the index generator (`FIELD_MAP.descriptions`), the client helper
 * `normalizeDigitalStatus` in `static/js/search.js`, which maps the
 * old value to the new one so existing filter URLs keep selecting the
 * same records, and the interface strings, which name the site by
 * its title instead of a fixed word.
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { FIELD_MAP } = require('../scripts/generate-pagefind-indices.js');
const { normalizeDigitalStatus } = require('../themes/base/static/js/search.js');
const { parse } = require('smol-toml');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('index generator digital_status value', () => {
  it('writes hosted for a record with digitised images', () => {
    const f = FIELD_MAP.descriptions.filters({ has_digital: true });
    expect(f.digital_status).toEqual(['hosted']);
  });
  it('writes none for a record without', () => {
    expect(FIELD_MAP.descriptions.filters({}).digital_status).toEqual(['none']);
  });
  it('writes hosted in the result metadata too', () => {
    expect(FIELD_MAP.descriptions.meta({ has_digital: true }).digital_status).toBe('hosted');
  });
});

describe('normalizeDigitalStatus', () => {
  it('reads the old value zasqua as hosted', () => {
    expect(normalizeDigitalStatus('zasqua')).toBe('hosted');
  });
  it('leaves other values alone', () => {
    expect(normalizeDigitalStatus('hosted')).toBe('hosted');
    expect(normalizeDigitalStatus('none')).toBe('none');
    expect(normalizeDigitalStatus('external')).toBe('external');
  });
});

describe('interface strings', () => {
  for (const lang of ['en', 'es']) {
    const t = parse(fs.readFileSync(path.join(ROOT, 'themes/base/i18n', `${lang}.toml`), 'utf8'));
    it(`${lang}: the hosted labels use the site title, not a fixed name`, () => {
      expect(t.search.digitalStatus.hosted).toContain('{{ .Site }}');
      expect(t.search.digitalStatusPill.hosted).toContain('{{ .Site }}');
      expect(t.search.digitalStatus.hosted).not.toMatch(/Zasqua/);
      expect(t.search.digitalStatusPill.hosted).not.toMatch(/Zasqua/);
    });
  }
});

// Version: v1.6.0
