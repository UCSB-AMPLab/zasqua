/**
 * Export vocabulary labels — Hugo Render Tests
 *
 * The entity and place pages and their two explorers pass the labels of
 * entity types, place types, entity roles, role groups and place roles to
 * the browser as data-* attributes, and the entity page and the entity
 * explorer pass the role groups themselves as data-role-groups. All of them
 * come from _partials/vocab.html, which applies the export's optional
 * vocabulary.json to the bundled data/vocab files.
 *
 * This builds the smoke instance (site language en) twice: once with an
 * exports/vocabulary.json that relabels, adds, leaves empty, deprecates and
 * regroups entries, and once without the file. It checks that
 *   - an export label in the site language replaces the bundled one;
 *   - an empty or null label, and a code the export leaves out, keep the
 *     bundled label;
 *   - a code the bundle lacks is labelled, and so is a deprecated entry;
 *   - a label carrying markup or an apostrophe stays plain text in its
 *     single-quoted attribute;
 *   - `group` moves a role between groups, `group: null` takes it out of
 *     every group, a role without `group` stays put, and `order` sorts the
 *     groups (ordered groups first, the rest in their bundled position);
 *   - without the file every attribute equals the bundled data.
 *
 * Two further builds check the order rule with extreme, equal,
 * fractional and non-number `order` values, and that "otros", the list of roles in no group, never becomes
 * a group of its own while its label still sets the list's heading. A
 * third checks that role codes and group ids are compared in lowercase.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_DIR = path.join(__dirname, '..', 'themes/base/data/vocab');
const BUNDLED = yaml.load(fs.readFileSync(path.join(VOCAB_DIR, 'en.yaml'), 'utf8'));
const BUNDLED_GROUPS = yaml.load(fs.readFileSync(path.join(VOCAB_DIR, 'role-groups.yaml'), 'utf8')).groups;

const MARKUP = '"><img src=x onerror=alert(1)>';
const APOSTROPHE = "Notary's clerk";

const VOCABULARY = {
  entity_types: [
    { code: 'person', label: { en: 'Individual', es: 'Individuo' } },
    { code: 'family', label: { en: null, es: null } },
    { code: 'lineage', label: { en: 'Lineage', es: 'Linaje' } },
    { code: 'corporate', label: { en: 'Old corporate', es: 'Antigua corporación' }, deprecated: true },
  ],
  place_types: [
    { code: 'city', label: { en: '', es: '' } },
    { code: 'region', label: { es: 'Región natural' } },
  ],
  role_groups: [
    { code: 'visual', label: { en: 'Pictures', es: 'Imágenes' }, order: 0 },
    { code: 'household', label: { en: 'Household', es: 'Casa' }, order: 5 },
    { code: 'legal', label: { en: 'Law', es: 'Derecho' } },
  ],
  entity_roles: [
    { code: 'judge', label: { en: MARKUP, es: MARKUP } },
    { code: 'notary', label: { en: APOSTROPHE, es: APOSTROPHE } },
    { code: 'witness', label: { en: 'Witness', es: 'Testigo' }, group: 'visual' },
    { code: 'scribe', label: { en: 'Scribe', es: 'Escribano' }, group: null },
    { code: 'steward', label: { en: 'Steward', es: 'Mayordomo' }, group: 'household' },
  ],
  place_roles: [
    { code: 'venue', label: { en: 'Place of the event', es: 'Lugar del evento' }, deprecated: true },
    { code: 'landed_at', label: { en: 'Place of landing', es: 'Lugar de desembarco' } },
  ],
  authority_sources: [
    { key: 'viaf', label: { en: 'VIAF', es: 'VIAF' }, url_template: 'https://viaf.org/viaf/{id}' },
  ],
};

// Every JSON-carrying data attribute is single-quoted in the output
function attr(html, name) {
  const m = html.match(new RegExp(`data-${name}='([^']*)'`));
  if (!m) throw new Error(`data-${name} not found`);
  return JSON.parse(m[1]);
}

const PAGES = { entity: 'ne-smoke-p1', entities: 'entidades', place: 'nl-smoke-p1', places: 'lugares' };

describe('export vocabulary labels', () => {
  let withDir;
  let withoutDir;
  const html = {};
  const bare = {};

  beforeAll(() => {
    withDir = buildSmokeInstance(null, {
      prefix: 'zasqua-vocab-',
      prepare: (dir) => {
        fs.writeFileSync(path.join(dir, 'exports', 'vocabulary.json'), JSON.stringify(VOCABULARY), 'utf8');
      },
    });
    withoutDir = buildSmokeInstance(null, { prefix: 'zasqua-novocab-' });
    for (const [k, slug] of Object.entries(PAGES)) {
      html[k] = readPage(withDir, slug);
      bare[k] = readPage(withoutDir, slug);
    }
  }, BUILD_TIMEOUT_MS * 2);

  afterAll(() => {
    for (const d of [withDir, withoutDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it('shows an export relabel in the site language', () => {
    expect(attr(html.entity, 'entity-type-labels').person).toBe('Individual');
    expect(attr(html.entities, 'entity-types').person).toBe('Individual');
    expect(attr(html.entities, 'entity-type-labels').person).toBe('Individual');
    expect(html.entity).toMatch(/data-entity-type="?Individual"?/);
    expect(attr(html.entity, 'role-group-labels').legal).toBe('Law');
  });

  it('keeps the bundled label for an empty or null export label', () => {
    expect(attr(html.entity, 'entity-type-labels').family).toBe(BUNDLED.entityTypes.family);
    expect(attr(html.places, 'place-types').city).toBe(BUNDLED.placeTypes.city);
  });

  it('keeps the bundled label for a code the export leaves out', () => {
    expect(attr(html.entity, 'entity-type-labels').corporate_body).toBe(BUNDLED.entityTypes.corporate_body);
    expect(attr(html.places, 'place-types').river).toBe(BUNDLED.placeTypes.river);
    expect(attr(html.entity, 'role-labels').creator).toBe(BUNDLED.roles.creator);
    expect(attr(html.place, 'place-role-labels').sent_from).toBe(BUNDLED.placeRoles.sent_from);
  });

  it('labels a code the bundle lacks', () => {
    expect(attr(html.entity, 'entity-type-labels').lineage).toBe('Lineage');
    expect(attr(html.entity, 'role-labels').steward).toBe('Steward');
    expect(attr(html.place, 'place-role-labels').landed_at).toBe('Place of landing');
    expect(attr(html.entity, 'role-group-labels').household).toBe('Household');
  });

  it('labels a deprecated entry', () => {
    expect(attr(html.entity, 'entity-type-labels').corporate).toBe('Old corporate');
    expect(attr(html.place, 'place-role-labels').venue).toBe('Place of the event');
    expect(attr(html.places, 'place-role-labels').venue).toBe('Place of the event');
  });

  it('falls back to the other language when the site language is missing', () => {
    expect(attr(html.places, 'place-types').region).toBe('Región natural');
  });

  it('keeps markup and apostrophes in a label as plain text', () => {
    for (const page of [html.entity, html.entities]) {
      expect(page).not.toContain('<img src=x');
      expect(page).not.toContain("Notary's");
      expect(attr(page, 'role-labels').judge).toBe(MARKUP);
      expect(attr(page, 'role-labels').notary).toBe(APOSTROPHE);
    }
  });

  it('regroups roles by group and sorts the groups by order', () => {
    for (const page of [html.entity, html.entities]) {
      const groups = attr(page, 'role-groups');
      const byId = Object.fromEntries(groups.map((g) => [g.id, g.members]));
      const where = (role) => groups.filter((g) => g.members.includes(role)).map((g) => g.id);

      // group moves a role, null removes it, no member keeps it
      expect(where('witness')).toEqual(['visual']);
      expect(where('scribe')).toEqual([]);
      expect(where('notary')).toEqual(['notarial']);
      expect(byId.visual).toEqual(['photographer', 'artist', 'witness']);
      expect(byId.household).toEqual(['steward']);

      // ordered groups first, by order; the rest in their bundled position
      const unordered = BUNDLED_GROUPS.map((g) => g.id).filter((id) => id !== 'visual');
      expect(groups.map((g) => g.id)).toEqual(['visual', 'household', ...unordered]);
    }
  });

  it('matches the bundled data without vocabulary.json', () => {
    expect(attr(bare.entity, 'entity-type-labels')).toEqual(BUNDLED.entityTypes);
    expect(attr(bare.entity, 'role-labels')).toEqual(BUNDLED.roles);
    expect(attr(bare.entity, 'role-group-labels')).toEqual(BUNDLED.roleGroups);
    expect(attr(bare.entities, 'entity-types')).toEqual(BUNDLED.entityTypes);
    expect(attr(bare.entities, 'entity-type-labels')).toEqual(BUNDLED.entityTypes);
    expect(attr(bare.entities, 'role-labels')).toEqual(BUNDLED.roles);
    expect(attr(bare.entities, 'role-group-labels')).toEqual(BUNDLED.roleGroups);
    expect(attr(bare.place, 'place-role-labels')).toEqual(BUNDLED.placeRoles);
    expect(attr(bare.places, 'place-types')).toEqual(BUNDLED.placeTypes);
    expect(attr(bare.places, 'place-role-labels')).toEqual(BUNDLED.placeRoles);
    expect(attr(bare.entity, 'role-groups')).toEqual(BUNDLED_GROUPS);
    expect(attr(bare.entities, 'role-groups')).toEqual(BUNDLED_GROUPS);
  });
});

function buildWith(vocabulary, prefix) {
  return buildSmokeInstance(null, {
    prefix,
    prepare: (dir) => {
      fs.writeFileSync(path.join(dir, 'exports', 'vocabulary.json'), JSON.stringify(vocabulary), 'utf8');
    },
  });
}

describe('role-group order and the otros list', () => {
  let orderDir;
  let otrosDir;
  let caseDir;

  beforeAll(() => {
    orderDir = buildWith({
      role_groups: [
        { code: 'correspondence', label: { en: 'Letters' }, order: 100000000000000 },
        { code: 'visual', label: { en: 'Pictures' }, order: 0 },
        { code: 'legal', label: { en: 'Law' }, order: -3 },
        { code: 'family', label: { en: 'Family' }, order: 7 },
        { code: 'notarial', label: { en: 'Notaries' }, order: 7 },
        { code: 'production', label: { en: 'Production' }, order: 200000000000000000000 },
        { code: 'transactions', label: { en: 'Trade' }, order: 100000000000000000000 },
        { code: 'beyond', label: { en: 'Beyond' }, order: 1.5 },
        { code: 'text', label: { en: 'Text' }, order: '1' },
      ],
      entity_roles: [
        { code: 'steward', label: { en: 'Steward' }, group: 'beyond' },
        { code: 'clerk', label: { en: 'Clerk' }, group: 'text' },
      ],
    }, 'zasqua-vocab-order-');
    otrosDir = buildWith({
      role_groups: [{ code: 'otros', label: { en: 'Miscellaneous', es: 'Varios' }, order: 0 }],
      entity_roles: [
        { code: 'witness', label: { en: 'Witness' }, group: 'otros' },
        { code: 'scribe', label: { en: 'Scribe' }, group: null },
      ],
    }, 'zasqua-vocab-otros-');
    caseDir = buildWith({
      role_groups: [{ code: 'Visual', label: { en: 'Pictures' }, order: -1 }],
      entity_roles: [
        { code: 'Archivist', label: { en: 'Archivist' }, group: 'Production' },
        { code: 'Notary', label: { en: 'Notary public' }, group: 'VISUAL' },
      ],
      place_roles: [{ code: 'Landed_At', label: { en: 'Place of landing' } }],
    }, 'zasqua-vocab-case-');
  }, BUILD_TIMEOUT_MS * 3);

  afterAll(() => {
    for (const d of [orderDir, otrosDir, caseDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it('sorts by order with no overflow, negatives first, equal orders in position', () => {
    for (const slug of [PAGES.entity, PAGES.entities]) {
      const ids = attr(readPage(orderDir, slug), 'role-groups').map((g) => g.id);
      // notarial precedes family in the bundle, whatever the export's order;
      // orders past the 64-bit integer range keep their order; a fractional
      // or string order counts as absent
      expect(ids).toEqual([
        'legal', 'visual', 'notarial', 'family', 'correspondence', 'transactions', 'production', 'beyond', 'text',
      ]);
    }
  });

  it('keeps otros out of the groups and uses its label for the list heading', () => {
    for (const slug of [PAGES.entity, PAGES.entities]) {
      const page = readPage(otrosDir, slug);
      const groups = attr(page, 'role-groups');
      expect(groups.map((g) => g.id)).not.toContain('otros');
      expect(groups.map((g) => g.id)).toEqual(BUNDLED_GROUPS.map((g) => g.id));
      const all = groups.flatMap((g) => g.members);
      expect(all).not.toContain('witness');
      expect(all).not.toContain('scribe');
      expect(attr(page, 'role-group-labels').otros).toBe('Miscellaneous');
    }
  });

  it('compares role codes and group ids in lowercase', () => {
    for (const slug of [PAGES.entity, PAGES.entities]) {
      const page = readPage(caseDir, slug);
      const labels = attr(page, 'role-labels');
      expect(labels.archivist).toBe('Archivist');
      expect(labels.notary).toBe('Notary public');
      expect(labels).not.toHaveProperty('Archivist');
      expect(attr(page, 'role-group-labels').visual).toBe('Pictures');
      const groups = attr(page, 'role-groups');
      const ids = groups.map((g) => g.id);
      expect(ids[0]).toBe('visual');
      expect(ids).not.toContain('Visual');
      expect(ids).not.toContain('Production');
      const byId = Object.fromEntries(groups.map((g) => [g.id, g.members]));
      expect(byId.production).toContain('archivist');
      expect(byId.visual).toEqual(['photographer', 'artist', 'notary']);
      expect(byId.notarial).toEqual(['scribe', 'witness']);
    }
    expect(attr(readPage(caseDir, PAGES.place), 'place-role-labels').landed_at).toBe('Place of landing');
  });
});

// Version: v1.6.0
