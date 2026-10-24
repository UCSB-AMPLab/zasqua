/**
 * Generate EAC-CPF Unit Tests
 *
 * Tests for the pure helpers in `scripts/generate-eac.js`, which writes one
 * EAC-CPF 2010 XML record per entity (the `zasqua eac` command). The generator
 * gives every person, corporate body and family in the entity contract an
 * authority record in the archival standard for contexts, with no
 * institution-specific text baked in.
 *
 * Behaviors covered:
 *   1. Document structure — the <eac-cpf> root with its namespaces, then
 *      <control> before <cpfDescription>, with the control children in
 *      schema order and the identity carrying entityType and nameEntry.
 *   2. Maintenance event — a machine "created" event with an empty
 *      <eventDateTime/> and no timestamp anywhere (output is deterministic).
 *   3. Optional control fields — agencyCode and languageDeclaration appear
 *      only when configured.
 *   4. Entity type map — person, corporate (or corporate_body) and family
 *      map to the EAC-CPF
 *      vocabulary; any other value, inherited names such as "constructor"
 *      included, throws, naming the entity code.
 *   5. XML escaping in element text and attributes.
 *   6. Required fields — a missing entity_code or display_name throws; with
 *      no options the agency name falls back to "Zasqua"; a minimal valid
 *      entity yields no literal "undefined".
 *   7. No institution string in the output.
 *   8. Names — the authorized nameEntry carries display_name, then the
 *      surname, forename and honorific parts when present; each distinct
 *      name variant gets its own nameEntry after it.
 *   9. Dates of existence — a dateRange, a single date or a text-only date,
 *      with integer years zero-padded to four digits and YYYY, YYYY-MM or
 *      YYYY-MM-DD strings passed through, or no existDates when nothing is
 *      known; an invalid year throws, naming the entity.
 *  10. Functions and history — one function term per non-empty entry, a
 *      biogHist only when there is history, and no <description> at all
 *      when none of its children applies. A non-array name_variants or
 *      functions throws, naming the entity.
 *  11. Relations — one identity cpfRelation per populated VIAF and Wikidata
 *      id, in that order, after <description>; no <relations> when neither
 *      id is set, and never a DBE link.
 *  12. Config — readEacConfig reads the eac_* params from hugo.toml, strips
 *      a trailing slash from eac_base_url, and falls back to the site title,
 *      then to "Zasqua", with null code, language and base URL.
 *  13. Filenames — eacSlug strips ?, # and / from the entity code.
 *  14. Per-record decision — planEacRecord trims the code before slugging,
 *      skips a record whose slug is empty or already written in any letter
 *      case (keeping the earlier file), and gives a build error's reason
 *      without repeating the code, colons in the code included.
 *  15. Contract checks added for schema validity — recordId must be an
 *      NMTOKEN, a YYYY-MM or YYYY-MM-DD must be a real month or date,
 *      XML-forbidden characters are stripped, values that are neither
 *      strings nor finite numbers count as blank, authority ids must have
 *      the VIAF or Wikidata shape, and eac_agency_code / eac_language_code
 *      must match the ISIL and ISO 639-2 patterns.
 *
 * @version v1.5.0
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { buildEacCpf, escapeText, escapeAttr, gYear, AUTHORITY_LINKS, readEacConfig, eacSlug, planEacRecord, isUnderPublic } = require('../scripts/generate-eac.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PERSON = {
  id: 861264,
  entity_code: 'ne-755zr',
  display_name: 'Agustín Arenas',
  sort_name: 'Agustín Arenas',
  entity_type: 'person',
  given_name: 'Agustín',
  surname: 'Arenas',
  honorific: 'Doctor',
  date_earliest: 1812,
  date_latest: 1822,
  name_variants: ['Agustín de Arenas'],
  primary_function: '',
  functions: [
    { function: 'Catedrático', count: 1 },
    { function: 'Doctor', count: 1 },
  ],
  dates_of_existence: 'fl. 1812-1822',
  history: '',
  viaf_id: '',
  dbe_id: null,
  wikidata_id: '',
  modified_at: '2026-04-15',
};

const OPTS = { agencyName: 'Smoke Test Archive' };

describe('buildEacCpf — document structure', () => {
  it('emits the EAC-CPF 2010 root, control and identity in schema order', () => {
    const xml = buildEacCpf(PERSON, OPTS);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<eac-cpf xmlns="urn:isbn:1-931666-33-4"');
    expect(xml.indexOf('<control>')).toBeLessThan(xml.indexOf('<cpfDescription>'));
    expect(xml.indexOf('<recordId>')).toBeLessThan(xml.indexOf('<maintenanceStatus>'));
    expect(xml.indexOf('<maintenanceAgency>')).toBeLessThan(xml.indexOf('<maintenanceHistory>'));
    expect(xml).toContain('<recordId>ne-755zr</recordId>');
    expect(xml).toContain('<maintenanceStatus>new</maintenanceStatus>');
    expect(xml).toContain('<agencyName>Smoke Test Archive</agencyName>');
    expect(xml).toContain('<entityType>person</entityType>');
    expect(xml).toContain('<nameEntry>\n        <part>Agustín Arenas</part>');
    expect(xml.trimEnd().endsWith('</eac-cpf>')).toBe(true);
    const withLang = buildEacCpf(PERSON, { ...OPTS, languageCode: 'spa' });
    expect(withLang.indexOf('</maintenanceAgency>')).toBeLessThan(withLang.indexOf('<languageDeclaration>'));
    expect(withLang.indexOf('<languageDeclaration>')).toBeLessThan(withLang.indexOf('<maintenanceHistory>'));
  });
  it('emits a machine "created" maintenance event with an empty eventDateTime and no other date', () => {
    const xml = buildEacCpf(PERSON, OPTS);
    expect(xml).toContain('<eventType>created</eventType>');
    expect(xml).toContain('<eventDateTime/>');
    expect(xml).toContain('<agentType>machine</agentType>');
    expect(xml).toContain('<agent>Zasqua</agent>');
    expect(xml).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('omits agencyCode and languageDeclaration when not configured, emits them when configured', () => {
    expect(buildEacCpf(PERSON, OPTS)).not.toContain('<agencyCode>');
    expect(buildEacCpf(PERSON, OPTS)).not.toContain('<languageDeclaration>');
    const xml = buildEacCpf(PERSON, { ...OPTS, agencyCode: 'CO-Smoke', languageCode: 'spa' });
    expect(xml).toContain('<agencyCode>CO-Smoke</agencyCode>');
    expect(xml).toContain('<language languageCode="spa"/>');
    expect(xml).toContain('<script scriptCode="Latn"/>');
  });
  it('maps the three contract entity types and throws on any other', () => {
    expect(buildEacCpf({ ...PERSON, entity_type: 'corporate' }, OPTS)).toContain('<entityType>corporateBody</entityType>');
    expect(buildEacCpf({ ...PERSON, entity_type: 'corporate_body' }, OPTS)).toContain('<entityType>corporateBody</entityType>');
    expect(buildEacCpf({ ...PERSON, entity_type: 'family' }, OPTS)).toContain('<entityType>family</entityType>');
    expect(() => buildEacCpf({ ...PERSON, entity_type: 'robot' }, OPTS)).toThrow(/ne-755zr.*robot/);
    expect(() => buildEacCpf({ ...PERSON, entity_type: 'constructor' }, OPTS)).toThrow(/ne-755zr.*constructor/);
  });
  it('accepts corporateBody, the spelling the CollectiveAccess importer emits', () => {
    expect(buildEacCpf({ ...PERSON, entity_type: 'corporateBody' }, OPTS)).toContain('<entityType>corporateBody</entityType>');
  });
  it('builds recordId from the trimmed code and throws when the code is not an NMTOKEN', () => {
    expect(buildEacCpf({ ...PERSON, entity_code: '  ne-755zr ' }, OPTS)).toContain('<recordId>ne-755zr</recordId>');
    expect(buildEacCpf({ ...PERSON, entity_code: 'ne:z.1_a' }, OPTS)).toContain('<recordId>ne:z.1_a</recordId>');
    expect(() => buildEacCpf({ ...PERSON, entity_code: 'ne a/b' }, OPTS))
      .toThrow('[generate-eac] ne a/b: invalid entity_code "ne a/b" (not an NMTOKEN)');
  });
  it('strips characters XML 1.0 forbids before escaping, in text and attributes', () => {
    expect(escapeText('text\u0001text')).toBe('texttext');
    expect(escapeText('a\u0000b\u000Bc\u001Fd\uFFFEe\uFFFFf')).toBe('abcdef');
    expect(escapeText('tab\tnl\ncr\r')).toBe('tab\tnl\ncr\r');
    expect(escapeAttr('x\u0002"y')).toBe('x&quot;y');
    expect(buildEacCpf({ ...PERSON, history: 'a\u0001b' }, OPTS)).toContain('<p>ab</p>');
  });
  it('treats values that are neither strings nor finite numbers as blank, never emitting [object Object]', () => {
    const xml = buildEacCpf({
      ...PERSON,
      history: { text: 'x' },
      surname: ['Arenas'],
      honorific: true,
      dates_of_existence: { from: 1812 },
      name_variants: [{ name: 'A' }, 'Agustín de Arenas', NaN],
      functions: [{ function: { term: 'x' } }, { function: 'Doctor' }],
    }, OPTS);
    expect(xml).not.toContain('[object Object]');
    expect(xml).not.toContain('<biogHist>');
    expect(xml).not.toContain('localType="surname"');
    expect(xml).not.toContain('localType="honorific"');
    expect(xml).not.toContain('NaN');
    expect(xml.match(/<nameEntry>/g).length).toBe(2);
    expect(xml.match(/<function>/g).length).toBe(1);
    expect(xml).not.toContain('<descriptiveNote>');
  });
  it('escapes reserved characters in text and attributes', () => {
    const xml = buildEacCpf({ ...PERSON, display_name: 'A. & T. Meluk & Cía. <hijos>' }, { agencyName: 'Say "hi"' });
    expect(xml).toContain('<part>A. &amp; T. Meluk &amp; Cía. &lt;hijos&gt;</part>');
    expect(xml).toContain('<agencyName>Say "hi"</agencyName>');   // text: quotes untouched
    expect(escapeAttr('a"b')).toBe('a&quot;b');
  });
  it('throws on a missing entity_code or an empty display_name', () => {
    expect(() => buildEacCpf({ ...PERSON, entity_code: undefined }, OPTS)).toThrow('[generate-eac] (no entity_code): missing entity_code');
    expect(() => buildEacCpf({ ...PERSON, display_name: '' }, OPTS)).toThrow('[generate-eac] ne-755zr: missing display_name');
  });
  it('falls back to the agency name "Zasqua" when called without options', () => {
    expect(buildEacCpf(PERSON)).toContain('<agencyName>Zasqua</agencyName>');
  });
  it('emits no literal "undefined" for a minimal valid entity', () => {
    const minimal = { entity_code: 'ne-0000a', display_name: 'Minimal', entity_type: 'person' };
    expect(buildEacCpf(minimal)).not.toContain('undefined');
    expect(buildEacCpf(minimal, OPTS)).not.toContain('undefined');
  });
  it('contains no institution string', () => {
    expect(buildEacCpf(PERSON, OPTS)).not.toMatch(/Neogranadina|UCSB|AMPL/i);
  });
});

describe('buildEacCpf — names', () => {
  it('emits display_name first, then surname, forename and honorific parts with localType', () => {
    const xml = buildEacCpf(PERSON, OPTS);   // given_name Agustín, surname Arenas, honorific Doctor
    const i = xml.indexOf('<part>Agustín Arenas</part>');
    expect(i).toBeGreaterThan(-1);
    expect(xml.indexOf('<part localType="surname">Arenas</part>')).toBeGreaterThan(i);
    expect(xml.indexOf('<part localType="forename">Agustín</part>')).toBeGreaterThan(i);
    expect(xml).toContain('<part localType="honorific">Doctor</part>');
  });
  it('omits structured parts that are empty', () => {
    const xml = buildEacCpf({ ...PERSON, given_name: '', surname: '', honorific: '' }, OPTS);
    expect(xml).not.toContain('localType="surname"');
    expect(xml).not.toContain('localType="forename"');
    expect(xml).not.toContain('localType="honorific"');
    expect(xml.match(/<nameEntry>/g).length).toBe(2);   // authorized + one variant
  });
  it('emits one alternative nameEntry per variant, after the authorized one, dropping empties and duplicates of display_name', () => {
    const xml = buildEacCpf({ ...PERSON, name_variants: ['Agustín de Arenas', '', 'Agustín Arenas'] }, OPTS);
    expect(xml.match(/<nameEntry>/g).length).toBe(2);
    expect(xml.lastIndexOf('<nameEntry>')).toBeGreaterThan(xml.indexOf('localType="honorific"'));
    expect(xml).toContain('<part>Agustín de Arenas</part>');
  });
  it('trims names on output and deduplicates variants on the trimmed value', () => {
    const xml = buildEacCpf({ ...PERSON, display_name: '  Agustín Arenas ', name_variants: [' Agustín de Arenas', 'Agustín de Arenas  ', ' Agustín Arenas'] }, OPTS);
    expect(xml).toContain('<part>Agustín Arenas</part>');
    expect(xml).toContain('<part>Agustín de Arenas</part>');
    expect(xml.match(/<nameEntry>/g).length).toBe(2);
  });
  it('throws, naming the entity, when name_variants is not an array; null means none', () => {
    expect(() => buildEacCpf({ ...PERSON, name_variants: 'Agustín de Arenas' }, OPTS))
      .toThrow('[generate-eac] ne-755zr: name_variants must be an array');
    expect(buildEacCpf({ ...PERSON, name_variants: null }, OPTS).match(/<nameEntry>/g).length).toBe(1);
  });
});

describe('buildEacCpf — existDates', () => {
  it('emits a dateRange with gYear standardDates and the display text as a note', () => {
    const xml = buildEacCpf(PERSON, OPTS);   // 1812–1822, "fl. 1812-1822"
    expect(xml).toContain('<fromDate standardDate="1812">1812</fromDate>');
    expect(xml).toContain('<toDate standardDate="1822">1822</toDate>');
    expect(xml).toContain('<descriptiveNote>\n          <p>fl. 1812-1822</p>');
  });
  it('emits a single date when both years are equal, with the display text as content', () => {
    const xml = buildEacCpf({ ...PERSON, date_earliest: 1911, date_latest: 1911, dates_of_existence: 'fl. 1911' }, OPTS);
    expect(xml).toContain('<date standardDate="1911">fl. 1911</date>');
    expect(xml).not.toContain('<dateRange>');
  });
  it('emits text-only date when years are null, and omits existDates when nothing is known', () => {
    expect(buildEacCpf({ ...PERSON, date_earliest: null, date_latest: null, dates_of_existence: 'siglo XVIII' }, OPTS))
      .toContain('<date>siglo XVIII</date>');
    expect(buildEacCpf({ ...PERSON, date_earliest: null, date_latest: null, dates_of_existence: '' }, OPTS))
      .not.toContain('<existDates>');
  });
  it('keeps a reversed range as given and zero-pads years under 1000', () => {
    const xml = buildEacCpf({ ...PERSON, date_earliest: 1822, date_latest: 1812 }, OPTS);
    expect(xml).toContain('<fromDate standardDate="1822">1822</fromDate>');
    expect(gYear(998)).toBe('0998');
  });
  it('emits a single date from the one year known, with the display text or the year as content', () => {
    expect(buildEacCpf({ ...PERSON, date_earliest: null, date_latest: 1822, dates_of_existence: 'd. 1822' }, OPTS))
      .toContain('<date standardDate="1822">d. 1822</date>');
    expect(buildEacCpf({ ...PERSON, date_earliest: null, date_latest: 1822, dates_of_existence: '' }, OPTS))
      .toContain('<date standardDate="1822">1822</date>');
  });
  it('accepts contract string years, passing YYYY and YYYY-MM-DD through, and treats a blank string as absent', () => {
    const range = buildEacCpf({ ...PERSON, date_earliest: '1680', date_latest: '1690' }, OPTS);
    expect(range).toContain('<fromDate standardDate="1680">1680</fromDate>');
    expect(range).toContain('<toDate standardDate="1690">1690</toDate>');
    expect(buildEacCpf({ ...PERSON, date_earliest: '1812-03-01', date_latest: '' }, OPTS))
      .toContain('<date standardDate="1812-03-01">fl. 1812-1822</date>');
    expect(buildEacCpf({ ...PERSON, date_earliest: '', date_latest: '', dates_of_existence: '' }, OPTS))
      .not.toContain('<existDates>');
  });
  it('throws, naming the entity, on year 0 or a malformed year string', () => {
    expect(() => buildEacCpf({ ...PERSON, date_earliest: 0 }, OPTS)).toThrow('[generate-eac] ne-755zr: invalid year "0"');
    expect(() => buildEacCpf({ ...PERSON, date_latest: 'c. 1820' }, OPTS)).toThrow('[generate-eac] ne-755zr: invalid year "c. 1820"');
  });
  it('throws on a month outside 01-12 or a date that is not on the calendar', () => {
    for (const bad of ['1812-13', '1812-00', '1812-00-00', '2023-02-29', '1812-04-31']) {
      expect(() => buildEacCpf({ ...PERSON, date_earliest: bad }, OPTS)).toThrow(`[generate-eac] ne-755zr: invalid year "${bad}"`);
      expect(() => gYear(bad)).toThrow('invalid year');
    }
    expect(gYear('1812-12')).toBe('1812-12');
    expect(gYear('2024-02-29')).toBe('2024-02-29');
    expect(gYear('0050-01-31')).toBe('0050-01-31');
  });
});

describe('buildEacCpf — functions and biogHist', () => {
  it('emits one function term per entry in order, skipping empty terms, without counts', () => {
    const xml = buildEacCpf({ ...PERSON, functions: [{ function: 'Catedrático', count: 1 }, { function: '', count: 2 }, { function: 'Doctor', count: 1 }] }, OPTS);
    expect(xml).toContain('<functions>\n        <function>\n          <term>Catedrático</term>');
    expect(xml.match(/<function>/g).length).toBe(2);
    expect(xml).not.toContain('count');
  });
  it('throws, naming the entity, when functions is not an array; drops plain-string entries', () => {
    expect(() => buildEacCpf({ ...PERSON, functions: 'Catedrático' }, OPTS))
      .toThrow('[generate-eac] ne-755zr: functions must be an array');
    const xml = buildEacCpf({ ...PERSON, functions: ['Catedrático', { function: 'Doctor', count: 1 }] }, OPTS);
    expect(xml.match(/<function>/g).length).toBe(1);
    expect(buildEacCpf({ ...PERSON, functions: null }, OPTS)).not.toContain('<functions>');
  });
  it('emits biogHist only when history is non-empty, and no description at all when nothing applies', () => {
    expect(buildEacCpf({ ...PERSON, history: 'Nació en Popayán.' }, OPTS)).toContain('<biogHist>\n        <p>Nació en Popayán.</p>');
    const bare = buildEacCpf({ entity_code: 'ne-x', display_name: 'X', entity_type: 'person', functions: [], name_variants: [] }, OPTS);
    expect(bare).not.toContain('<description>');
    expect(bare).not.toContain('<biogHist>');
  });
});

describe('buildEacCpf — relations', () => {
  it('emits an identity cpfRelation per populated VIAF and Wikidata id, in that order', () => {
    const xml = buildEacCpf({ ...PERSON, viaf_id: '9776644', wikidata_id: 'Q42' }, OPTS);
    expect(xml).toContain('<cpfRelation cpfRelationType="identity" xlink:type="simple" xlink:href="https://viaf.org/viaf/9776644">');
    expect(xml).toContain('<relationEntry>VIAF</relationEntry>');
    expect(xml.indexOf('viaf.org')).toBeLessThan(xml.indexOf('wikidata.org/entity/Q42'));
    expect(xml.indexOf('<relations>')).toBeGreaterThan(xml.indexOf('</description>'));
  });
  it('omits relations entirely when no id is populated, and never emits a DBE link', () => {
    const xml = buildEacCpf({ ...PERSON, viaf_id: '', wikidata_id: '', dbe_id: 43576 }, OPTS);
    expect(xml).not.toContain('<relations>');
    expect(xml).not.toMatch(/rah\.es/);
    expect(AUTHORITY_LINKS.map(l => l.field)).toEqual(['viaf_id', 'wikidata_id']);
  });
  it('links only a numeric VIAF id and a Q-number Wikidata id, warning about any other value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const xml = buildEacCpf({ ...PERSON, viaf_id: 'https://viaf.org/viaf/9776644', wikidata_id: 'wikidata.org/wiki/Q42' }, OPTS);
      expect(xml).not.toContain('<relations>');
      expect(warn).toHaveBeenCalledWith('[generate-eac] ne-755zr: ignoring viaf_id "https://viaf.org/viaf/9776644"');
      expect(warn).toHaveBeenCalledWith('[generate-eac] ne-755zr: ignoring wikidata_id "wikidata.org/wiki/Q42"');
      warn.mockClear();
      const ok = buildEacCpf({ ...PERSON, viaf_id: ' 9776644 ', wikidata_id: 'Q42' }, OPTS);
      expect(ok).toContain('xlink:href="https://viaf.org/viaf/9776644"');
      expect(ok).toContain('xlink:href="http://www.wikidata.org/entity/Q42"');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Config and filenames
// ---------------------------------------------------------------------------

describe('readEacConfig', () => {
  const dirs = [];
  const tmpInstance = (toml) => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-config-'));
    dirs.push(dir);
    if (toml !== undefined) fs.writeFileSync(join(dir, 'hugo.toml'), toml, 'utf8');
    return dir;
  };
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it('reads eac_* params and strips a trailing slash from eac_base_url', () => {
    const dir = tmpInstance([
      'title = "Site Title"',
      '[params]',
      '  eac_agency_name = "Agency Name"',
      '  eac_agency_code = "CO-Smoke"',
      '  eac_language_code = "spa"',
      '  eac_base_url = "https://m.example.org/eac/"',
      '',
    ].join('\n'));
    expect(readEacConfig(dir)).toEqual({
      agencyName: 'Agency Name',
      agencyCode: 'CO-Smoke',
      languageCode: 'spa',
      eacBaseUrl: 'https://m.example.org/eac',
    });
  });

  it('falls back to title, then to "Zasqua", with null code, language and base URL', () => {
    const withTitle = tmpInstance('title = "Site Title"\n');
    expect(readEacConfig(withTitle)).toEqual({
      agencyName: 'Site Title', agencyCode: null, languageCode: null, eacBaseUrl: null,
    });
    const noToml = tmpInstance();
    expect(readEacConfig(noToml)).toEqual({
      agencyName: 'Zasqua', agencyCode: null, languageCode: null, eacBaseUrl: null,
    });
  });
});

describe('readEacConfig — code patterns', () => {
  const dirs = [];
  const tmpInstance = (params) => {
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'zasqua-eac-config-'));
    dirs.push(dir);
    fs.writeFileSync(join(dir, 'hugo.toml'), `title = "T"\n[params]\n${params}\n`, 'utf8');
    return dir;
  };
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('keeps a valid ISIL agency code and ignores an invalid one with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEacConfig(tmpInstance('eac_agency_code = "CO-Smoke"')).agencyCode).toBe('CO-Smoke');
    expect(warn).not.toHaveBeenCalled();
    expect(readEacConfig(tmpInstance('eac_agency_code = "CO-SmokeArchive"')).agencyCode).toBeNull();
    expect(warn.mock.calls.length).toBe(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[generate-eac\] ignoring eac_agency_code "CO-SmokeArchive": /);
  });

  it('keeps a three-letter language code and ignores any other with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEacConfig(tmpInstance('eac_language_code = "spa"')).languageCode).toBe('spa');
    expect(warn).not.toHaveBeenCalled();
    expect(readEacConfig(tmpInstance('eac_language_code = "es"')).languageCode).toBeNull();
    expect(warn.mock.calls.length).toBe(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[generate-eac\] ignoring eac_language_code "es": /);
  });
});

describe('eacSlug', () => {
  it('strips ? # and / so the filename is safe and matches the page URL', () => {
    expect(eacSlug('ne-a?b#c/d')).toBe('ne-abcd');
    expect(eacSlug(null)).toBe('');
  });
});

describe('planEacRecord', () => {
  const OPTS_MIN = { agencyName: 'Test Agency' };
  const entity = (code, extra = {}) => ({ entity_code: code, display_name: 'N', entity_type: 'person', ...extra });

  it('returns the trimmed code, its slug and the XML for a valid record, and records the slug', () => {
    const owners = new Map();
    const plan = planEacRecord(entity('  ne-a1  '), OPTS_MIN, owners);
    expect(plan.skip).toBeUndefined();
    expect(plan.code).toBe('ne-a1');
    expect(plan.slug).toBe('ne-a1');
    expect(plan.xml).toContain('<eac-cpf ');
    expect(owners.get('ne-a1')).toBe('ne-a1');   // keyed by the lower-cased slug
  });

  it('skips a code made only of ?, # and / (not an NMTOKEN) before slugging', () => {
    const plan = planEacRecord(entity('?#/'), OPTS_MIN, new Map());
    expect(plan).toEqual({ code: '?#/', skip: 'invalid entity_code "?#/" (not an NMTOKEN)' });
  });

  it('skips a slug repeated in any letter case, naming the code that wrote it, and keeps the first owner', () => {
    const owners = new Map();
    planEacRecord(entity('ne-a'), OPTS_MIN, owners);
    const plan = planEacRecord(entity('ne-A'), OPTS_MIN, owners);
    expect(plan).toEqual({ code: 'ne-A', skip: 'slug "ne-A" already written by ne-a' });
    expect(owners.get('ne-a')).toBe('ne-a');
  });

  it('keys slugs in NFC, so another spelling of a written code is not written again', () => {
    // U+212B ANGSTROM SIGN is a letter, so it passes the NMTOKEN check, and
    // NFC composes it to U+00C5 (Å): the two codes name the same file on a
    // case-insensitive, normalising filesystem.
    const composed = 'ne-\u00c5';
    const angstrom = 'ne-\u212b';
    expect(angstrom.normalize('NFC')).toBe(composed);
    const owners = new Map();
    expect(planEacRecord(entity(composed), OPTS_MIN, owners).skip).toBeUndefined();
    expect(planEacRecord(entity(angstrom), OPTS_MIN, owners)).toEqual({
      code: angstrom, skip: `slug "${angstrom}" already written by ${composed}`,
    });
    // The NFD spelling never reaches the key: a combining mark is not an
    // NMTOKEN character, so buildEacCpf refuses it first.
    expect(planEacRecord(entity('ne-e\u0301'), OPTS_MIN, new Map()).skip).toMatch(/NMTOKEN/);
  });

  it('gives the build error without repeating the code, even when the code contains a colon', () => {
    const plan = planEacRecord(entity('ne:z', { entity_type: 'robot' }), OPTS_MIN, new Map());
    expect(plan).toEqual({ code: 'ne:z', skip: 'unknown entity_type "robot"' });
  });

  it('labels a record with no entity_code and strips the "(no entity_code)" prefix', () => {
    const plan = planEacRecord({ display_name: 'N', entity_type: 'person' }, OPTS_MIN, new Map());
    expect(plan).toEqual({ code: '(no entity_code)', skip: 'missing entity_code' });
  });
});

describe('isUnderPublic', () => {
  it('matches public/ and its subdirectories but not a sibling with the same prefix', () => {
    const root = '/srv/inst';
    expect(isUnderPublic('/srv/inst/public', root)).toBe(true);
    expect(isUnderPublic('/srv/inst/public/eac', root)).toBe(true);
    expect(isUnderPublic('/srv/inst/public-staging/eac', root)).toBe(false);
    expect(isUnderPublic('/srv/inst/staging', root)).toBe(false);
    expect(isUnderPublic('/srv/inst/public/..x', root)).toBe(true);
  });
});

// Version: v1.5.0
