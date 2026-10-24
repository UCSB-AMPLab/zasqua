/**
 * Generate EAC-CPF — command-level smoke test
 *
 * Runs scripts/generate-eac.js end-to-end as the `zasqua eac` command would
 * (a subprocess reading a fixture instance's exports/ + hugo.toml, writing to
 * a temp EAC_DIR), to cover what the pure-function unit tests cannot: the
 * file I/O path, one file per entity named by entity_code, determinism across
 * runs, the agency name taken from the site title, and a record that fails
 * to build, or whose filename is already taken, being skipped with a warning
 * rather than stopping the run or overwriting the earlier file. A packaging
 * check confirms that package.json `files` lists every script the CLI runs.
 *
 * Uses the engine-smoke fixture (3 entities: a person, a corporate body and a
 * family; title "Smoke Test Archive", no eac_* params, so it exercises the
 * neutral defaults).
 *
 * @version v1.5.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = join(__dirname, '..');
const SCRIPT = join(ENGINE_ROOT, 'scripts', 'generate-eac.js');
const FIXTURE = join(__dirname, 'fixtures', 'engine-smoke');

function runEac(eacDir, instanceRoot = FIXTURE) {
  return execFileSync('node', [SCRIPT], {
    env: { ...process.env, INSTANCE_ROOT: instanceRoot, EAC_DIR: eacDir },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('zasqua eac — command smoke test', () => {
  let dir, files;
  const read = (f) => fs.readFileSync(join(dir, f), 'utf8');

  beforeAll(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-smoke-'));
    runEac(dir);
    files = fs.readdirSync(dir).sort();
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes one well-formed EAC-CPF file per entity, named by entity_code', () => {
    expect(files).toEqual(['ne-smoke-c1.xml', 'ne-smoke-f1.xml', 'ne-smoke-p1.xml']);
    for (const f of files) {
      const xml = read(f);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<eac-cpf ');
      expect(xml.trimEnd().endsWith('</eac-cpf>')).toBe(true);
    }
  });

  it('uses the hugo.toml title as agencyName and emits no timestamp or institution string', () => {
    expect(files).toHaveLength(3);
    for (const f of files) {
      const xml = read(f);
      expect(xml).toContain('<agencyName>Smoke Test Archive</agencyName>');
      expect(xml).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(xml).not.toMatch(/Neogranadina/i);
    }
  });

  it('maps each fixture type and escapes the corporate name', () => {
    const c1 = read('ne-smoke-c1.xml');
    expect(c1).toContain('<entityType>corporateBody</entityType>');
    expect(c1).toContain('<part>Smoke &amp; Sons &lt;Ltd&gt;</part>');
    const f1 = read('ne-smoke-f1.xml');
    expect(f1).toContain('<entityType>family</entityType>');
    expect(f1).toContain('<date>fl. 1700</date>');
    expect(f1).not.toContain('<dateRange>');
    const p1 = read('ne-smoke-p1.xml');
    expect(p1).toContain('viaf.org/viaf/9776644');
  });

  it('is deterministic — a second run produces byte-identical output', () => {
    expect(files).toHaveLength(3);
    const dir2 = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-smoke2-'));
    try {
      runEac(dir2);
      expect(fs.readdirSync(dir2).sort()).toEqual(files);
      for (const f of files) {
        expect(fs.readFileSync(join(dir2, f), 'utf8')).toBe(read(f));
      }
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('skips an unknown entity_type and a repeated slug, warns, and still exits 0', () => {
    const instance = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-instance-'));
    const outDir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-skip-'));
    try {
      fs.cpSync(FIXTURE, instance, { recursive: true });
      const entitiesPath = join(instance, 'exports', 'entities.json');
      const entities = JSON.parse(fs.readFileSync(entitiesPath, 'utf8'));
      entities.push({ entity_code: 'ne-smoke-x1', display_name: 'X', entity_type: 'robot' });
      entities.push({ entity_code: 'NE-SMOKE-P1', display_name: 'Duplicate', entity_type: 'person' });
      fs.writeFileSync(entitiesPath, JSON.stringify(entities, null, 2), 'utf8');

      // spawnSync keeps stderr and the exit status, which the skip warning
      // and the exit-0 rule are checked against.
      const result = spawnSync('node', [SCRIPT], {
        env: { ...process.env, INSTANCE_ROOT: instance, EAC_DIR: outDir },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('skipped ne-smoke-x1: unknown entity_type "robot"');
      expect(result.stderr).toContain('skipped NE-SMOKE-P1: slug "NE-SMOKE-P1" already written by ne-smoke-p1');
      expect(fs.readdirSync(outDir).sort()).toEqual(files);
      // The earlier file is kept, not overwritten by the duplicate.
      expect(fs.readFileSync(join(outDir, 'ne-smoke-p1.xml'), 'utf8')).toBe(read('ne-smoke-p1.xml'));
    } finally {
      fs.rmSync(instance, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('zasqua eac — packaging', () => {
  // The published package ships only what package.json `files` lists, and
  // scripts/ is listed file by file, so a script the CLI runs but `files`
  // omits would be missing from the installed engine.
  const pkg = JSON.parse(fs.readFileSync(join(ENGINE_ROOT, 'package.json'), 'utf8'));
  const listed = (rel) => pkg.files.some((entry) => entry === rel || (entry.endsWith('/') && rel.startsWith(entry)));

  it('lists scripts/generate-eac.js in package.json files', () => {
    expect(pkg.files).toContain('scripts/generate-eac.js');
  });

  it('lists every script that bin/, lib/pipeline.js and build.sh run', () => {
    const sources = [
      ...fs.readdirSync(join(ENGINE_ROOT, 'bin')).map((f) => join(ENGINE_ROOT, 'bin', f)),
      join(ENGINE_ROOT, 'lib', 'pipeline.js'),
      join(ENGINE_ROOT, 'build.sh'),
    ];
    const scripts = new Set();
    for (const file of sources) {
      // Shell comment lines are dropped (build.sh's header names a placeholder
      // scripts/X.js); JS comments only name scripts that exist.
      const text = fs.readFileSync(file, 'utf8')
        .split('\n').filter((line) => !(file.endsWith('.sh') && /^\s*#/.test(line))).join('\n');
      for (const m of text.matchAll(/'scripts',\s*'([\w.-]+\.js)'/g)) scripts.add(`scripts/${m[1]}`);
      for (const m of text.matchAll(/scripts\/([\w./-]+\.js)/g)) scripts.add(`scripts/${m[1]}`);
    }
    expect(scripts.has('scripts/generate-eac.js')).toBe(true);
    expect(scripts.has('scripts/generate-mets.js')).toBe(true);
    expect(scripts.has('scripts/generate-places.js')).toBe(true);
    for (const rel of scripts) {
      expect(fs.existsSync(join(ENGINE_ROOT, rel)), `${rel} exists`).toBe(true);
      expect(listed(rel), `${rel} listed in package.json files`).toBe(true);
    }
  });
});

// Version: v1.5.0
