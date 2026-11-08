/**
 * Generate METS Unit Tests
 *
 * Tests for the pure helpers in `scripts/generate-mets.js`, which writes one
 * METS 1.12.1 XML document per description (the `zasqua mets` command). The
 * generator makes the reuse section's "uses the METS standard" claim resolve to
 * a real file for any deployment, with no institution-specific text baked in.
 *
 * Behaviors covered:
 *   1. Document structure — single <mets> root, the four namespaces, OBJID/
 *      LABEL/TYPE, a <metsHdr> with NO CREATEDATE (omitted for determinism),
 *      a Dublin Core <dmdSec ID="dmd-001">, and a logical <structMap>.
 *   2. Dublin Core mapping + ORDER — title, identifier, date, description,
 *      creator, language, format, type, source, rights, subject, isPartOf,
 *      publisher (the retired backend's emit order).
 *   3. dc:type level map.
 *   4. Rights — data-driven ladder (§4.2): digitised repo text → record
 *      conditions → optional house default → omit. No hardcoded text.
 *   5. Deployment-agnostic agents — CREATOR from config, CUSTODIAN from repo,
 *      and NONE of the retired backend's hardcoded institution strings.
 *   6. IIIF passthrough — fileSec/fptr iff iiif_manifest_url.
 *   7. XML escaping.
 *   8. metsSlug.
 *  10. institution records — attribution, catalogue licence, publisher creator,
 *      and the byte-identical 1.0 output
 *   9. readMetsConfig — reads the [params] METS config from hugo.toml, with
 *      fallbacks, and degrades gracefully when hugo.toml is absent.
 *
 * @version v1.6.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { buildMets, computeRights, catalogueLicenceText, metsSlug, readMetsConfig, DC_TYPE_MAP } = require('../scripts/generate-mets.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// opts: no createDate (CREATEDATE is omitted); creatorName/creatorNote drive
// the CREATOR agent; defaultRights is the optional house rights fallback.
const OPTS = {
  creatorName: 'Library and Archives Canada',
  creatorNote: 'https://example.org/about',
  defaultRights: '',
};

function makeDesc(overrides = {}) {
  return {
    id: 6,
    reference_code: 'es-ags-crei',
    title: 'Consejo Real de España e Indias',
    description_level: 'fonds',
    parent_reference_code: null,
    repository_code: 'es-ags',
    date_expression: '1774–1868',
    scope_content: 'La mayor parte de la documentación...',
    extent: '5 m.l. (36 legajos y 3 libros)',
    language: 'Castellano',
    creator_display: '',
    place_display: '',
    imprint: '',
    has_digital: false,
    access_conditions: '',
    reproduction_conditions: '',
    iiif_manifest_url: '',
    ...overrides,
  };
}

const REPO = { code: 'es-ags', name: 'Archivo General de Simancas', city: 'Simancas' };

// ---------------------------------------------------------------------------
// 1. Document structure
// ---------------------------------------------------------------------------

describe('buildMets — document structure', () => {
  it('emits a single METS root with all four namespaces and core sections', () => {
    const xml = buildMets(makeDesc(), REPO, OPTS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.loc.gov/METS/"');
    expect(xml).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(xml).toContain('xmlns:dcterms="http://purl.org/dc/terms/"');
    expect(xml).toContain('OBJID="es-ags-crei"');
    expect(xml).toContain('LABEL="Consejo Real de España e Indias"');
    expect(xml).toContain('TYPE="fonds"');
    expect(xml).toContain('<dmdSec ID="dmd-001">');
    expect(xml).toContain('<structMap TYPE="logical">');
    expect(xml.match(/<mets\b/g)).toHaveLength(1);
    expect(xml.match(/<\/mets>/g)).toHaveLength(1);
  });

  it('omits CREATEDATE — the metsHdr carries no creation timestamp', () => {
    const xml = buildMets(makeDesc(), REPO, OPTS);
    expect(xml).toContain('<metsHdr>');
    expect(xml).not.toContain('CREATEDATE');
  });
});

// ---------------------------------------------------------------------------
// 2. Dublin Core mapping + order
// ---------------------------------------------------------------------------

describe('buildMets — Dublin Core mapping', () => {
  it('maps every contract field into Dublin Core, in the backend element order', () => {
    const xml = buildMets(
      makeDesc({
        parent_reference_code: 'es-ags',
        creator_display: 'Juan Pablo Gamero',
        place_display: 'Simancas',
        imprint: 'Madrid, 1975',
      }),
      REPO,
      OPTS
    );
    expect(xml).toContain('<dc:title>Consejo Real de España e Indias</dc:title>');
    expect(xml).toContain('<dc:identifier>es-ags-crei</dc:identifier>');
    expect(xml).toContain('<dc:date>1774–1868</dc:date>');
    expect(xml).toContain('<dc:description>La mayor parte de la documentación...</dc:description>');
    expect(xml).toContain('<dc:creator>Juan Pablo Gamero</dc:creator>');
    expect(xml).toContain('<dc:format>5 m.l. (36 legajos y 3 libros)</dc:format>');
    expect(xml).toContain('<dc:source>Archivo General de Simancas, Simancas</dc:source>');
    expect(xml).toContain('<dc:subject>Simancas</dc:subject>');
    expect(xml).toContain('<dcterms:isPartOf>es-ags</dcterms:isPartOf>');
    expect(xml).toContain('<dc:publisher>Madrid, 1975</dc:publisher>');

    // Element ORDER: title, identifier, date, description, creator, language,
    // format, type, source, rights, subject, isPartOf, publisher.
    const order = ['dc:title', 'dc:identifier', 'dc:date', 'dc:description', 'dc:creator',
      'dc:language', 'dc:format', 'dc:type', 'dc:source', 'dc:subject', 'dcterms:isPartOf', 'dc:publisher'];
    const positions = order.map(tag => xml.indexOf(`<${tag}>`));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('passes language through verbatim (no numeric code mapping)', () => {
    const xml = buildMets(makeDesc({ language: 'Castellano' }), REPO, OPTS);
    expect(xml).toContain('<dc:language>Castellano</dc:language>');
  });

  it('omits creator/subject/publisher/isPartOf when their source fields are blank', () => {
    const xml = buildMets(makeDesc(), REPO, OPTS);
    expect(xml).not.toContain('<dc:creator>');
    expect(xml).not.toContain('<dc:subject>');
    expect(xml).not.toContain('<dc:publisher>');
    expect(xml).not.toContain('isPartOf');
  });
});

// ---------------------------------------------------------------------------
// 3. dc:type level map
// ---------------------------------------------------------------------------

describe('buildMets — dc:type level map', () => {
  it('maps aggregate levels to Collection', () => {
    for (const level of ['fonds', 'subfonds', 'series', 'subseries', 'collection', 'section', 'file']) {
      expect(DC_TYPE_MAP[level]).toBe('Collection');
      expect(buildMets(makeDesc({ description_level: level }), REPO, OPTS)).toContain('<dc:type>Collection</dc:type>');
    }
  });

  it('maps leaf bibliographic levels to Text', () => {
    for (const level of ['item', 'volume']) {
      expect(DC_TYPE_MAP[level]).toBe('Text');
      expect(buildMets(makeDesc({ description_level: level }), REPO, OPTS)).toContain('<dc:type>Text</dc:type>');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Rights — data-driven ladder (§4.2)
// ---------------------------------------------------------------------------

describe('computeRights / dc:rights ladder', () => {
  const digRepo = { ...REPO, image_reproduction_text: 'CC BY-NC 4.0. Diríjase al AGS.' };

  it('rung 1: digitised record + repo image_reproduction_text → repo text', () => {
    const desc = makeDesc({ has_digital: true, access_conditions: 'Libre acceso' });
    expect(computeRights(desc, digRepo, OPTS)).toBe('CC BY-NC 4.0. Diríjase al AGS.');
    expect(buildMets(desc, digRepo, OPTS)).toContain('<dc:rights>CC BY-NC 4.0. Diríjase al AGS.</dc:rights>');
  });

  it('rung 2: non-digitised → record reproduction_conditions, then access_conditions', () => {
    expect(computeRights(makeDesc({ reproduction_conditions: 'Libre reproducción' }), REPO, OPTS))
      .toBe('Libre reproducción');
    expect(computeRights(makeDesc({ access_conditions: 'Libre acceso' }), REPO, OPTS))
      .toBe('Libre acceso');
    // reproduction wins over access when both present
    expect(computeRights(makeDesc({ reproduction_conditions: 'Repro', access_conditions: 'Access' }), REPO, OPTS))
      .toBe('Repro');
  });

  it('rung 2 fires even for a digitised record when the repo has no image_reproduction_text', () => {
    const desc = makeDesc({ has_digital: true, access_conditions: 'Libre acceso' });
    expect(computeRights(desc, REPO, OPTS)).toBe('Libre acceso'); // REPO has no image_reproduction_text
  });

  it('rung 3: optional house default when no per-record/per-repo rights', () => {
    expect(computeRights(makeDesc(), REPO, { ...OPTS, defaultRights: 'House terms.' }))
      .toBe('House terms.');
  });

  it('rung 4: omit when nothing applies and no default', () => {
    expect(computeRights(makeDesc(), REPO, OPTS)).toBe('');
    expect(buildMets(makeDesc(), REPO, OPTS)).not.toContain('<dc:rights>');
  });
});

// ---------------------------------------------------------------------------
// 5. Deployment-agnostic agents
// ---------------------------------------------------------------------------

describe('buildMets — deployment-agnostic agents', () => {
  it('uses the supplied creator name + note for the CREATOR agent', () => {
    const xml = buildMets(makeDesc(), REPO, OPTS);
    expect(xml).toContain('<agent ROLE="CREATOR" TYPE="ORGANIZATION">');
    expect(xml).toContain('<name>Library and Archives Canada</name>');
    expect(xml).toContain('<note>https://example.org/about</note>');
  });

  it('uses the repository as the CUSTODIAN agent', () => {
    const xml = buildMets(makeDesc(), REPO, OPTS);
    expect(xml).toContain('<agent ROLE="CUSTODIAN" TYPE="ORGANIZATION">');
    expect(xml).toContain('<name>Archivo General de Simancas</name>');
  });

  it('omits the CREATOR note when none is supplied', () => {
    const xml = buildMets(makeDesc(), REPO, { ...OPTS, creatorNote: '' });
    expect(xml).not.toContain('<note>');
  });

  it("contains none of the retired backend's hardcoded institution strings", () => {
    const digRepo = { ...REPO, image_reproduction_text: 'CC BY-NC 4.0.' };
    const xml = buildMets(makeDesc({ has_digital: true }), digRepo, OPTS);
    expect(xml).not.toMatch(/Neogranadina/i);
    expect(xml).not.toMatch(/Fundación Histórica/i);
    expect(xml).not.toContain('neogranadina.org');
  });
});

// ---------------------------------------------------------------------------
// 6. IIIF passthrough
// ---------------------------------------------------------------------------

describe('buildMets — IIIF passthrough', () => {
  it('omits fileSec and fptr when no iiif_manifest_url', () => {
    const xml = buildMets(makeDesc({ iiif_manifest_url: '' }), REPO, OPTS);
    expect(xml).not.toContain('<fileSec>');
    expect(xml).not.toContain('<fptr');
    expect(xml).toMatch(/<div[^>]*DMDID="dmd-001"\/>/);
  });

  it('emits fileSec + fptr pointing at the manifest verbatim', () => {
    const url = 'https://manifests.example.org/iiif/x/manifest.json';
    const xml = buildMets(makeDesc({ iiif_manifest_url: url }), REPO, OPTS);
    expect(xml).toContain('<fileGrp USE="IIIF manifest">');
    expect(xml).toContain('<file ID="iiif-manifest" MIMETYPE="application/ld+json">');
    expect(xml).toContain(`<FLocat LOCTYPE="URL" xlink:href="${url}"/>`);
    expect(xml).toContain('<fptr FILEID="iiif-manifest"/>');
  });
});

// ---------------------------------------------------------------------------
// 7. XML escaping
// ---------------------------------------------------------------------------

describe('buildMets — XML escaping', () => {
  it('escapes reserved characters in element text and attributes', () => {
    const xml = buildMets(
      makeDesc({ title: 'Cuentas & "actas" <1820>', reference_code: 'co-x&y' }),
      REPO,
      OPTS
    );
    expect(xml).toContain('LABEL="Cuentas &amp; &quot;actas&quot; &lt;1820&gt;"');
    expect(xml).toContain('OBJID="co-x&amp;y"');
    expect(xml).toContain('<dc:title>Cuentas &amp; "actas" &lt;1820&gt;</dc:title>');
  });
});

// ---------------------------------------------------------------------------
// 8. Slug
// ---------------------------------------------------------------------------

describe('metsSlug', () => {
  it('strips ? and # so the filename matches the permalink', () => {
    expect(metsSlug('co-ahr-t001')).toBe('co-ahr-t001');
    expect(metsSlug('co-ahr-t001?v=2')).toBe('co-ahr-t001v=2');
    expect(metsSlug('co-ahr#frag')).toBe('co-ahrfrag');
  });

  it('handles empty / nullish reference codes', () => {
    expect(metsSlug('')).toBe('');
    expect(metsSlug(null)).toBe('');
    expect(metsSlug(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 9. METS config from hugo.toml [params]
// ---------------------------------------------------------------------------

describe('readMetsConfig', () => {
  function withHugoToml(body, fn) {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-'));
    if (body !== null) fs.writeFileSync(join(dir, 'hugo.toml'), body);
    try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  it('reads the explicit mets_* params', () => {
    withHugoToml(
      'title = "Site Name"\n[params]\n' +
      '  mets_creator_name = "Fundación Archivo de Ejemplo"\n' +
      '  mets_creator_url = "https://example.org"\n' +
      '  mets_default_rights = "Libre acceso."\n' +
      '  mets_base_url = "https://manifests.example.org/mets"\n',
      (dir) => {
        const c = readMetsConfig(dir);
        expect(c.creatorName).toBe('Fundación Archivo de Ejemplo');
        expect(c.creatorNote).toBe('https://example.org');
        expect(c.defaultRights).toBe('Libre acceso.');
        expect(c.metsBaseUrl).toBe('https://manifests.example.org/mets');
      }
    );
  });

  it('falls back: creatorName ← title, creatorNote ← about_url||source_url', () => {
    withHugoToml(
      'title = "Site Name"\n[params]\n  about_url = "https://example.org/about"\n',
      (dir) => {
        const c = readMetsConfig(dir);
        expect(c.creatorName).toBe('Site Name');
        expect(c.creatorNote).toBe('https://example.org/about');
        expect(c.defaultRights).toBe('');
        expect(c.metsBaseUrl).toBeNull(); // unset → null (consumer defaults to /mets)
      }
    );
  });

  it('strips a trailing slash from mets_base_url', () => {
    withHugoToml(
      'title = "X"\n[params]\n  mets_base_url = "https://m.example.org/mets/"\n',
      (dir) => expect(readMetsConfig(dir).metsBaseUrl).toBe('https://m.example.org/mets')
    );
  });

  it('degrades to a neutral creator when hugo.toml is absent (no institution string)', () => {
    withHugoToml(null, (dir) => {
      const c = readMetsConfig(dir);
      expect(c.creatorName).toBe('Zasqua archive');
      expect(c.creatorNote).toBe('');
      expect(c.metsBaseUrl).toBeNull();
      expect(c.creatorName).not.toMatch(/Neogranadina/i);
    });
  });
})

// ---------------------------------------------------------------------------
// 10. Institution records: attribution, catalogue licence, publisher
// ---------------------------------------------------------------------------

describe('institution records in METS', () => {
  const FIXTURES = join(__dirname, 'fixtures', 'fisqua-institutions');
  const SCRIPT = join(__dirname, '..', 'scripts', 'generate-mets.js');
  const GOLDEN = join(__dirname, 'fixtures', 'engine-smoke-golden', 'mets');
  const SMOKE = join(__dirname, 'fixtures', 'engine-smoke');
  const dirs = [];
  const tmp = () => {
    const d = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-mets-inst-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const fixtureRepos = () => JSON.parse(fs.readFileSync(join(FIXTURES, 'repositories.json'), 'utf8'));
  const fixturePublisher = () => JSON.parse(fs.readFileSync(join(FIXTURES, 'publisher.json'), 'utf8'));
  const repo = () => ({ ...fixtureRepos().find((r) => r.code === 'co-aeh') });
  const rights = (xml) => (xml.match(/<dc:rights>(.*)<\/dc:rights>/) || [])[1];

  it('digitised record: attribution in the site language', () => {
    const r = repo();
    const desc = makeDesc({ has_digital: true });
    expect(computeRights(desc, r, { ...OPTS, language: 'es' })).toBe(r.attribution.es);
    expect(computeRights(desc, r, { ...OPTS, language: 'en' })).toBe(r.attribution.en);
  });

  it('digitised record: the other language when the chosen member is empty', () => {
    const r = { ...repo(), attribution: { es: null, en: 'English credit.' } };
    expect(computeRights(makeDesc({ has_digital: true }), r, { ...OPTS, language: 'es' })).toBe('English credit.');
  });

  it('digitised record: image_reproduction_text when there is no attribution', () => {
    const r = { ...repo(), attribution: { es: null, en: null }, image_reproduction_text: 'Old text.' };
    expect(computeRights(makeDesc({ has_digital: true }), r, { ...OPTS, language: 'es' })).toBe('Old text.');
  });

  it('digitised record with neither: the record conditions, then the default', () => {
    const r = { ...repo(), attribution: null };
    expect(computeRights(makeDesc({ has_digital: true, access_conditions: 'Libre' }), r, OPTS)).toBe('Libre');
    expect(computeRights(makeDesc({ has_digital: true }), r, { ...OPTS, defaultRights: 'House.' })).toBe('House.');
  });

  it('other records: catalogue licence as "label (uri)" in the METS language', () => {
    const r = { ...repo(), catalogue_licence: {
      uri: 'https://creativecommons.org/licenses/by/4.0/',
      label: { es: 'CC BY 4.0 (es)', en: 'CC BY 4.0 (en)' },
    } };
    const desc = makeDesc();
    expect(computeRights(desc, r, { ...OPTS, language: 'es' }))
      .toBe('CC BY 4.0 (es) (https://creativecommons.org/licenses/by/4.0/)');
    expect(computeRights(desc, r, { ...OPTS, language: 'en' }))
      .toBe('CC BY 4.0 (en) (https://creativecommons.org/licenses/by/4.0/)');
    expect(rights(buildMets(desc, r, { ...OPTS, language: 'en' })))
      .toBe('CC BY 4.0 (en) (https://creativecommons.org/licenses/by/4.0/)');
  });

  it('other records: the uri alone when there is no label', () => {
    const r = { ...repo(), catalogue_licence: { uri: 'https://example.org/l', label: { es: null, en: null } } };
    expect(catalogueLicenceText(r, 'es')).toBe('https://example.org/l');
    expect(computeRights(makeDesc(), r, OPTS)).toBe('https://example.org/l');
  });

  it('other records: the licence wins over mets_default_rights; without it the default stands', () => {
    const withLicence = { ...repo(), catalogue_licence: { uri: 'https://example.org/l', label: null } };
    expect(computeRights(makeDesc(), withLicence, { ...OPTS, defaultRights: 'House.' })).toBe('https://example.org/l');
    expect(computeRights(makeDesc(), repo(), { ...OPTS, defaultRights: 'House.' })).toBe('House.');
    expect(computeRights(makeDesc(), repo(), OPTS)).toBe('');
  });

  it('a digitised record without a credit takes the catalogue licence in place of the house default', () => {
    const r = { ...repo(), attribution: null, image_reproduction_text: null, catalogue_licence: { uri: 'https://example.org/l' } };
    expect(computeRights(makeDesc({ has_digital: true }), r, OPTS)).toBe('https://example.org/l');
  });

  it("a record's own conditions come before the catalogue licence", () => {
    const r = { ...repo(), catalogue_licence: { uri: 'https://example.org/l' } };
    expect(computeRights(makeDesc({ has_digital: false, reproduction_conditions: 'Libre' }), r, OPTS)).toBe('Libre');
  });

  // End to end on a temporary copy of the fixture, with values filled in
  // where the fixture holds nulls.
  function instance({ withPublisher, publisherPatch = {}, toml = 'title = "Site"\n', manifest }) {
    const root = tmp();
    fs.mkdirSync(join(root, 'exports'));
    const repos = fixtureRepos().map((r) => (r.code === 'co-aeh'
      ? { ...r, catalogue_licence: { uri: 'https://example.org/l', label: { es: 'Licencia', en: 'Licence' } } }
      : r));
    fs.writeFileSync(join(root, 'exports', 'repositories.json'), JSON.stringify(repos));
    fs.writeFileSync(join(root, 'exports', 'descriptions.json'), JSON.stringify([
      makeDesc({ reference_code: 'd-1', repository_code: 'co-aeh', has_digital: true }),
      makeDesc({ reference_code: 'd-2', repository_code: 'co-aeh', has_digital: false }),
    ]));
    if (withPublisher) {
      fs.writeFileSync(join(root, 'exports', 'publisher.json'),
        JSON.stringify({ ...fixturePublisher(), ...publisherPatch }));
    }
    fs.writeFileSync(join(root, 'hugo.toml'), toml);
    if (manifest) fs.writeFileSync(join(root, 'zasqua.manifest.toml'), manifest);
    const out = join(root, 'out');
    execFileSync('node', [SCRIPT], { env: { ...process.env, INSTANCE_ROOT: root, METS_DIR: out }, encoding: 'utf8' });
    return { d1: fs.readFileSync(join(out, 'd-1.xml'), 'utf8'), d2: fs.readFileSync(join(out, 'd-2.xml'), 'utf8') };
  }

  it('reads publisher.json for the creator: legal name, tax id, location, website', () => {
    const { d1 } = instance({ withPublisher: true, toml: 'title = "Site"\n[params]\n  mets_creator_name = "Setting"\n  mets_creator_url = "https://setting.example"\n' });
    expect(d1).toContain('<name>Fundación Archivo de Ejemplo (NIT 000.000.000-0), Bogotá, Colombia</name>');
    expect(d1).toContain('<note>https://example.org</note>');
    expect(d1).not.toContain('Setting');
  });

  it('drops empty creator parts without empty parentheses or a dangling comma', () => {
    const noTax = instance({ withPublisher: true, publisherPatch: { tax_id: null } }).d1;
    expect(noTax).toContain('<name>Fundación Archivo de Ejemplo, Bogotá, Colombia</name>');
    const noLoc = instance({ withPublisher: true, publisherPatch: { location: '' } }).d1;
    expect(noLoc).toContain('<name>Fundación Archivo de Ejemplo (NIT 000.000.000-0)</name>');
    const nameOnly = instance({ withPublisher: true, publisherPatch: { tax_id: null, location: null, website: null } }).d1;
    expect(nameOnly).toContain('<name>Fundación Archivo de Ejemplo</name>');
    expect(nameOnly).not.toContain('<note>');
  });

  it('without a legal_name the mets_* settings stand', () => {
    const { d1 } = instance({
      withPublisher: true, publisherPatch: { legal_name: null },
      toml: 'title = "Site"\n[params]\n  mets_creator_name = "Setting"\n  mets_creator_url = "https://setting.example"\n',
    });
    expect(d1).toContain('<name>Setting</name>');
    expect(d1).toContain('<note>https://setting.example</note>');
  });

  it('end to end: rights follow the record kind and the manifest language', () => {
    const es = instance({ withPublisher: true });
    expect(rights(es.d1)).toContain('Digitalizado en el marco del Programa de Archivos en Riesgo');
    expect(rights(es.d2)).toBe('Licencia (https://example.org/l)');
    const en = instance({ withPublisher: true, manifest: '[ui]\nlanguage = "en-US"\n' });
    expect(rights(en.d1)).toContain('Digitized under the Programa de Archivos en Riesgo');
    expect(rights(en.d2)).toBe('Licence (https://example.org/l)');
  });

  it('a 1.0 export (no publisher.json, flat repositories) is byte-identical to the earlier output', () => {
    const out = tmp();
    execFileSync('node', [SCRIPT], { env: { ...process.env, INSTANCE_ROOT: SMOKE, METS_DIR: out }, encoding: 'utf8' });
    const names = fs.readdirSync(GOLDEN).sort();
    expect(fs.readdirSync(out).sort()).toEqual(names);
    for (const n of names) {
      expect(fs.readFileSync(join(out, n), 'utf8')).toBe(fs.readFileSync(join(GOLDEN, n), 'utf8'));
    }
  });
});

// Version: v1.6.0
