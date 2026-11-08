/**
 * Institution Records — Schemas for publisher, vocabulary and repositories
 *
 * This file checks the three schemas that describe the institutions behind a
 * site: `publisher.schema.json` (the publishing institution, its texts and
 * credits), `vocabulary.schema.json` (labels for entity and place types,
 * roles and authority sources) and the full repository record in
 * `repositories.schema.json`.
 *
 * The accept cases run against `tests/fixtures/fisqua-institutions/`, built
 * from Fisqua's export of the example federation: a publisher with every
 * text still empty, the full vocabulary, and two repository records (co-aeh
 * with funders, other names and a history in both languages; co-aem with most
 * prose empty). Older repository files, which carry only the flat fields,
 * must keep validating, so the golden and smoke fixtures are checked too.
 *
 * The reject cases each break one rule a reader of the site would feel: a
 * bilingual field sent as a bare string, a credit role the colophon has no
 * label for, a home order sent as text, a deprecated marker that is not
 * `true`. The last group runs the non-strict pre-pass, which only requires
 * the optional object files to parse and be objects when present.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const { validateInputs, validateSchemas } = require('../lib/validator.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'fisqua-institutions');

const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const schema = (name) => read(path.join(ENGINE_ROOT, 'schemas'), `${name}.schema.json`);

function check(name, data) {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema(name));
  const ok = validate(data);
  return { ok, errors: validate.errors || [] };
}

function tmpExports(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-inst-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('institution schemas: accept', () => {
  it('accepts the Fisqua publisher fixture', () => {
    expect(check('publisher', read(FIXTURE, 'publisher.json')).ok).toBe(true);
  });

  it('accepts the Fisqua vocabulary fixture', () => {
    expect(check('vocabulary', read(FIXTURE, 'vocabulary.json')).ok).toBe(true);
  });

  it('accepts the full Fisqua repository records', () => {
    const r = check('repositories', read(FIXTURE, 'repositories.json'));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('still accepts repository files in the older flat shape', () => {
    for (const dir of ['fisqua-golden', path.join('engine-smoke', 'exports')]) {
      const data = read(path.join(__dirname, 'fixtures', dir), 'repositories.json');
      expect(check('repositories', data).ok).toBe(true);
    }
  });

  it('accepts a credit with each of the four roles', () => {
    const pub = read(FIXTURE, 'publisher.json');
    pub.credits = ['partner', 'funder', 'developer', 'host'].map((role) => ({
      name: 'Example', role, url: null, logo_url: null,
    }));
    expect(check('publisher', pub).ok).toBe(true);
  });

  it('accepts a subtitle sent as a plain string, as 1.0 exports do', () => {
    const repos = read(FIXTURE, 'repositories.json');
    repos[0].subtitle = 'Legacy subtitle';
    const r = check('repositories', repos);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts an authority source without a URL template', () => {
    const voc = read(FIXTURE, 'vocabulary.json');
    voc.authority_sources[0] = { ...voc.authority_sources[0], url_template: null };
    expect(check('vocabulary', voc).ok).toBe(true);
  });

  it('accepts a vocabulary entry marked deprecated', () => {
    const voc = read(FIXTURE, 'vocabulary.json');
    voc.entity_roles[0] = { ...voc.entity_roles[0], deprecated: true };
    expect(check('vocabulary', voc).ok).toBe(true);
  });
});

describe('institution schemas: reject', () => {
  it('rejects a bilingual field sent as a bare string', () => {
    const repos = read(FIXTURE, 'repositories.json');
    repos[0].history = 'Texto sin idioma';
    const r = check('repositories', repos);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.instancePath === '/0/history')).toBe(true);
  });

  it('rejects a home order sent as text', () => {
    const repos = read(FIXTURE, 'repositories.json');
    repos[1].home_order = '3';
    expect(check('repositories', repos).ok).toBe(false);
  });

  it('rejects a funder without a name', () => {
    const repos = read(FIXTURE, 'repositories.json');
    repos[0].funders = [{ programme: 'Endangered Archives Programme' }];
    expect(check('repositories', repos).ok).toBe(false);
  });

  it('rejects a credit role the colophon has no label for', () => {
    const pub = read(FIXTURE, 'publisher.json');
    pub.credits = [{ name: 'Example', role: 'sponsor', url: null, logo_url: null }];
    expect(check('publisher', pub).ok).toBe(false);
  });

  it('rejects a deprecated marker that is not true', () => {
    const voc = read(FIXTURE, 'vocabulary.json');
    voc.place_roles[0] = { ...voc.place_roles[0], deprecated: false };
    expect(check('vocabulary', voc).ok).toBe(false);
  });

  it('rejects a publisher file that is an array', () => {
    expect(check('publisher', [read(FIXTURE, 'publisher.json')]).ok).toBe(false);
  });
});

describe('validator: optional publisher and vocabulary files', () => {
  const CORE = {
    'descriptions.json': read(path.join(__dirname, 'fixtures', 'engine-smoke', 'exports'), 'descriptions.json'),
    'repositories.json': read(FIXTURE, 'repositories.json'),
  };
  const manifest = { modules: {} };

  it('passes when both files are absent', () => {
    expect(validateInputs(manifest, tmpExports(CORE))).toEqual([]);
  });

  it('passes the strict schema pass with both files present', () => {
    const dir = tmpExports({
      ...CORE,
      'publisher.json': read(FIXTURE, 'publisher.json'),
      'vocabulary.json': read(FIXTURE, 'vocabulary.json'),
    });
    const errors = validateInputs(manifest, dir);
    validateSchemas(dir, ENGINE_ROOT, errors);
    expect(errors).toEqual([]);
  });

  it('fails when publisher.json does not parse', () => {
    const errors = validateInputs(manifest, tmpExports({ ...CORE, 'publisher.json': '{ not json' }));
    expect(errors.some((e) => e.includes('module=publisher') && e.includes('JSON parse failed'))).toBe(true);
  });

  it('fails when vocabulary.json is an array', () => {
    const errors = validateInputs(manifest, tmpExports({ ...CORE, 'vocabulary.json': [] }));
    expect(errors.some((e) => e.includes('module=vocabulary') && e.includes('not a JSON object'))).toBe(true);
  });

  it('reports a schema failure in publisher.json under its own schema name', () => {
    const pub = read(FIXTURE, 'publisher.json');
    pub.credits = [{ name: 'Example', role: 'sponsor' }];
    const dir = tmpExports({ ...CORE, 'publisher.json': pub });
    const errors = [];
    validateSchemas(dir, ENGINE_ROOT, errors);
    expect(errors.some((e) => e.includes('schema=publisher.schema.json'))).toBe(true);
  });
});

// Version: v1.6.0
