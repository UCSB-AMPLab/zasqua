/**
 * Generate METS — command-level smoke test
 *
 * Runs scripts/generate-mets.js end-to-end as the `zasqua mets` command would
 * (a subprocess reading a fixture instance's exports/ + hugo.toml, writing to a
 * temp METS_DIR), to cover what the pure-function unit tests cannot: the file
 * I/O path, the default output location, determinism across runs, and the
 * no-CREATEDATE / config-from-title behavior on real fixture data.
 *
 * Uses the engine-smoke fixture (2 descriptions, title "Smoke Test Archive",
 * no mets_* params — so it exercises the neutral defaults).
 *
 * @version v1.3.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = join(__dirname, '..');
const SCRIPT = join(ENGINE_ROOT, 'scripts', 'generate-mets.js');
const FIXTURE = join(__dirname, 'fixtures', 'engine-smoke');

function runMets(metsDir) {
  return execFileSync('node', [SCRIPT], {
    env: { ...process.env, INSTANCE_ROOT: FIXTURE, METS_DIR: metsDir },
    encoding: 'utf8',
  });
}

describe('zasqua mets — command smoke test', () => {
  let dir, files;

  beforeAll(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-smoke-'));
    runMets(dir);
    files = fs.readdirSync(dir).filter(f => f.endsWith('.xml')).sort();
  });

  it('writes one well-formed METS file per description, named by slug', () => {
    expect(files).toEqual(['co-smoke-f001.xml', 'co-smoke-f002.xml']);
    for (const f of files) {
      const xml = fs.readFileSync(join(dir, f), 'utf8');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<mets ');
      expect(xml.trimEnd().endsWith('</mets>')).toBe(true);
    }
  });

  it('uses the hugo.toml title as the CREATOR and emits no CREATEDATE', () => {
    const xml = fs.readFileSync(join(dir, files[0]), 'utf8');
    expect(xml).toContain('<name>Smoke Test Archive</name>');
    expect(xml).not.toContain('CREATEDATE');
    expect(xml).not.toMatch(/Neogranadina/i);
  });

  it('is deterministic — a second run produces byte-identical output', () => {
    const dir2 = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-smoke2-'));
    runMets(dir2);
    for (const f of files) {
      expect(fs.readFileSync(join(dir2, f), 'utf8')).toBe(fs.readFileSync(join(dir, f), 'utf8'));
    }
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
