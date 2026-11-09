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
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
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

describe('zasqua mets — stale output on rerun', () => {
  // A copy of the fixture whose exports can be changed between runs.
  function setup() {
    const instance = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-stale-instance-'));
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-stale-out-'));
    fs.cpSync(FIXTURE, instance, { recursive: true });
    return { instance, outDir };
  }
  function run(instance, outDir) {
    return spawnSync('node', [SCRIPT], {
      env: { ...process.env, INSTANCE_ROOT: instance, METS_DIR: outDir, DATA_DIR: '' },
      encoding: 'utf8',
    });
  }
  function cleanup(...dirs) {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }

  it('leaves no file for a record removed from the input, and logs how many files it removed', () => {
    const { instance, outDir } = setup();
    try {
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.existsSync(join(outDir, 'co-smoke-f002.xml'))).toBe(true);
      const inputPath = join(instance, 'exports', 'descriptions.json');
      const records = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      const kept = records.filter((r) => r.reference_code !== 'co-smoke-f002');
      expect(kept).toHaveLength(records.length - 1);
      fs.writeFileSync(inputPath, JSON.stringify(kept, null, 2), 'utf8');
      const second = run(instance, outDir);
      expect(second.status).toBe(0);
      expect(fs.existsSync(join(outDir, 'co-smoke-f002.xml'))).toBe(false);
      expect(fs.readdirSync(outDir).sort()).toEqual(['co-smoke-f001.xml']);
      expect(second.stdout).toMatch(/Removed \d+ xml files? from/);
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('keeps a file with another extension and anything in a subdirectory', () => {
    const { instance, outDir } = setup();
    try {
      fs.writeFileSync(join(outDir, 'notes.json'), 'keep', 'utf8');
      fs.mkdirSync(join(outDir, 'sub'));
      fs.writeFileSync(join(outDir, 'sub', 'inner.xml'), 'keep', 'utf8');
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.readFileSync(join(outDir, 'notes.json'), 'utf8')).toBe('keep');
      expect(fs.readFileSync(join(outDir, 'sub', 'inner.xml'), 'utf8')).toBe('keep');
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('removes a stale xml file that no input record produces', () => {
    const { instance, outDir } = setup();
    try {
      fs.writeFileSync(join(outDir, 'gone-record.xml'), 'stale', 'utf8');
      expect(run(instance, outDir).status).toBe(0);
      expect(fs.existsSync(join(outDir, 'gone-record.xml'))).toBe(false);
    } finally {
      cleanup(instance, outDir);
    }
  });

  it('leaves the previous output in place when the run fails before writing', () => {
    const { instance, outDir } = setup();
    try {
      expect(run(instance, outDir).status).toBe(0);
      const before = fs.readdirSync(outDir).sort();
      expect(before.length).toBeGreaterThan(0);
      fs.writeFileSync(join(instance, 'exports', 'descriptions.json'), '{ not json', 'utf8');
      const failed = run(instance, outDir);
      expect(failed.status).not.toBe(0);
      expect(fs.readdirSync(outDir).sort()).toEqual(before);
    } finally {
      cleanup(instance, outDir);
    }
  });
});

// Version: v1.6.0
