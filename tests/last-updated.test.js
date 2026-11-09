/**
 * Last-updated line on record pages
 *
 * Description, entity and place pages show "Esta descripción se actualizó por
 * última vez el {date}." from the record's `modified_at`, which the contract
 * makes optional. An export without it, such as Fisqua's, must not print
 * Hugo's zero date (0001-01-01); the line is left out instead. This builds the
 * smoke instance once, gives one description, one entity and one place a
 * `modified_at`, and checks that those three pages show the date and that the
 * records without one show no line.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const DATED = { descriptions: 'co-smoke-f001', entities: 'ne-smoke-p1', places: 'nl-smoke-p1' };
const UNDATED = ['co-smoke-f002', 'ne-smoke-c1', 'nl-smoke-r1'];
const CODE = { descriptions: 'reference_code', entities: 'entity_code', places: 'place_code' };

function prepare(dir) {
  const exp = path.join(dir, 'exports');
  for (const [file, code] of Object.entries(DATED)) {
    const p = path.join(exp, `${file}.json`);
    const records = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const r of records) {
      delete r.modified_at;
      if (r[CODE[file]] === code) r.modified_at = '2026-10-31';
    }
    fs.writeFileSync(p, JSON.stringify(records), 'utf8');
  }
}

describe('last-updated line', () => {
  let dir;
  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-lastmod-', prepare });
  }, BUILD_TIMEOUT_MS);
  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows the date of a record that has modified_at', () => {
    for (const slug of Object.values(DATED)) {
      expect(readPage(dir, slug), slug).toContain('2026-10-31');
    }
  });

  it('leaves the line out, never 0001-01-01, for a record without one', () => {
    for (const slug of UNDATED) {
      const html = readPage(dir, slug);
      expect(html, slug).not.toContain('0001-01-01');
      expect(html, slug).not.toContain('actualizó por última vez');
    }
  });
});

// Version: v1.6.0
