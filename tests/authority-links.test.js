/**
 * Entity and Place Authority Links — Hugo Render Tests
 *
 * The "Identificadores externos" section of the entity page
 * (`entidad/single.html`) links an entity's `viaf_id` to its VIAF record.
 * A `dbe_id` is not linked: the Real Academia de la Historia redirects the
 * dbe.rah.es biography addresses to the home page of its Historia Hispánica
 * site, and the DBE numbers in the data are not yet checked against the
 * biographies they name, so a link could reach the wrong person.
 *
 * The place page links a `whg_id` to the place's page in the World
 * Historical Gazetteer, https://whgazetteer.org/places/<id>/detail, the
 * same address the Linked Places export gives it.
 *
 * These tests render the real template through Hugo, with the smoke-instance
 * build in tests/helpers/smoke-build.js. Before the build a `dbe_id` is
 * written onto the fixture's person entity, which also has a `viaf_id`, and
 * onto its family entity, which has no other id.
 *
 * Behaviors asserted:
 *
 *   1. No page links to a rah.es address, whatever the `dbe_id`.
 *   2. The person's VIAF link is https://viaf.org/viaf/<viaf_id>.
 *   3. An entity whose only id is a `dbe_id` has no authority section; one
 *      with no ids has none either.
 *   4. The place page links its `whg_id` to /places/<id>/detail.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildSmokeInstance, readPage, BUILD_TIMEOUT_MS } from './helpers/smoke-build.js';

/**
 * Give the fixture's person and family entities a DBE number.
 */
function addDbeIds(dir) {
  const file = path.join(dir, 'exports', 'entities.json');
  const entities = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of entities) {
    if (e.entity_code === 'ne-smoke-p1') e.dbe_id = 33228;
    if (e.entity_code === 'ne-smoke-f1') e.dbe_id = 12985;
  }
  fs.writeFileSync(file, JSON.stringify(entities), 'utf8');
}

const SECTION = /id="?autoridades[" >]/;

describe('Entity authority links', () => {
  let dir;
  let person;
  let family;
  let corporate;

  beforeAll(() => {
    dir = buildSmokeInstance(null, { prefix: 'zasqua-authority-links-', prepare: addDbeIds });
    person = readPage(dir, 'ne-smoke-p1');
    family = readPage(dir, 'ne-smoke-f1');
    corporate = readPage(dir, 'ne-smoke-c1');
  }, BUILD_TIMEOUT_MS);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('links no DBE number', () => {
    for (const page of [person, family]) expect(page).not.toContain('rah.es');
  });

  it('links the VIAF id', () => {
    expect(person).toMatch(SECTION);
    expect(person).toMatch(/href="?https:\/\/viaf\.org\/viaf\/9776644[" >]/);
  });

  it('shows no authority section for an entity whose only id is a DBE number, or that has none', () => {
    expect(family).not.toMatch(SECTION);
    expect(corporate).not.toMatch(SECTION);
  });

  it('links the WHG id to the place page in the gazetteer', () => {
    const place = readPage(dir, 'nl-smoke-p1');
    expect(place).toMatch(/href="?https:\/\/whgazetteer\.org\/places\/176861\/detail[" >]/);
    expect(place).not.toContain('/portal');
  });
});

// Version: v1.6.0
