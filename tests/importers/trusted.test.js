/**
 * Import Sanitisation Setting Tests
 *
 * Whether an import sanitises HTML is a setting (`trusted`, CLI `--trusted`
 * and `--sanitize`), not a property of the input format's name. The
 * defaults stay as they were: the Fisqua format is copied unsanitised,
 * every other format is sanitised. The setting overrides either default.
 *
 * Covers:
 *   1. resolveTrusted: defaults per format, and the override both ways.
 *   2. fisqua adapter: trusted by default; `trusted: false` strips markup
 *      from every string value and leaves keys and non-strings alone.
 *   3. sanitize.js: `withSanitizing(false, fn)` turns the shared sanitiser
 *      off for the call, so a format that is sanitised by default can be
 *      imported as-is (checked with the CSV adapter).
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveTrusted } = require('../../lib/importers/dispatch.js');
const { run: runFisqua } = require('../../lib/importers/fisqua.js');
const { run: runCsv } = require('../../lib/importers/csv.js');
const { withSanitizing, sanitizeField } = require('../../lib/sanitize.js');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zasqua-trust-${label}-`));
}

function writeFisquaExport(dir) {
  fs.writeFileSync(path.join(dir, 'descriptions.json'), JSON.stringify([
    { id: 'a', reference_code: 'x-1', title: 'T <b>bold</b>', scope_content: '<p>One</p><script>alert(1)</script>', ocr_text: 'a {{ b }}', has_digital: true, child_count: 3 },
  ]));
}

describe('resolveTrusted', () => {
  it('defaults to trusted for fisqua and untrusted for every other format', () => {
    expect(resolveTrusted('fisqua', {})).toBe(true);
    for (const f of ['csv', 'ead3', 'collectiveaccess']) {
      expect(resolveTrusted(f, {})).toBe(false);
    }
  });
  it('lets the setting override either default', () => {
    expect(resolveTrusted('fisqua', { trusted: false })).toBe(false);
    expect(resolveTrusted('csv', { trusted: true })).toBe(true);
  });
});

describe('fisqua adapter sanitisation setting', () => {
  it('copies unchanged by default', async () => {
    const src = tmp('src'); const out = tmp('out');
    writeFisquaExport(src);
    await runFisqua({ src, stagingDir: out });
    const got = JSON.parse(fs.readFileSync(path.join(out, 'descriptions.json'), 'utf8'));
    expect(got[0].scope_content).toContain('<script>');
    expect(got[0].ocr_text).toBe('a {{ b }}');
  });
  it('strips markup from string values when trusted is false', async () => {
    const src = tmp('src'); const out = tmp('out');
    writeFisquaExport(src);
    await runFisqua({ src, stagingDir: out, trusted: false });
    const got = JSON.parse(fs.readFileSync(path.join(out, 'descriptions.json'), 'utf8'));
    expect(got[0].title).toBe('T bold');
    expect(got[0].scope_content).not.toContain('<');
    expect(got[0].has_digital).toBe(true);
    expect(got[0].child_count).toBe(3);
    expect(got[0].id).toBe('a');
  });
});

describe('shared sanitiser switch', () => {
  it('withSanitizing(false) passes strings through and restores afterwards', async () => {
    const seen = await withSanitizing(false, async () => sanitizeField('<b>x</b>'));
    expect(seen).toBe('<b>x</b>');
    expect(sanitizeField('<b>x</b>')).toBe('x');
  });
  it('restores the switch when the call throws', async () => {
    await expect(withSanitizing(false, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(sanitizeField('<b>x</b>')).toBe('x');
  });
  it('lets a default-sanitised format be imported as written', async () => {
    const src = tmp('csv');
    fs.writeFileSync(path.join(src, 'descriptions.csv'),
      'reference_code,title,description_level,repository_code\nr-1,"A <i>title</i>",fonds,rep\n');
    const outOn = tmp('on'); const outOff = tmp('off');
    await runCsv({ src, stagingDir: outOn });
    await withSanitizing(false, () => runCsv({ src, stagingDir: outOff }));
    const on = JSON.parse(fs.readFileSync(path.join(outOn, 'descriptions.json'), 'utf8'));
    const off = JSON.parse(fs.readFileSync(path.join(outOff, 'descriptions.json'), 'utf8'));
    expect(on[0].title).toBe('A title');
    expect(off[0].title).toBe('A <i>title</i>');
  });
});

// Version: v1.6.0
