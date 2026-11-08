/**
 * Role maps in the browser scripts
 *
 * The entity page (`entity.js`) and the entity explorer
 * (`entity-explorer.js`) count links by role code before they build the
 * role filters, and the place page (`place.js`) groups links by the label
 * of their place role. With codes and labels from the export, a key such
 * as "constructor" must count like any other: in a plain object it reads
 * the inherited function, so the role drops out of the filters or the
 * filters fail to render. Each script keeps the logic between markers
 * (`role-counts:start/end`, `role-label-groups:start/end`); this test lifts
 * each block out, runs it under Node, and checks those keys. Role codes
 * are compared in lowercase, as the vocab partial lowercases the export's
 * codes; the test checks that a link role "Archivist" counts and is
 * labelled as "archivist".
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const JS_DIR = path.join(__dirname, '..', 'themes', 'base', 'static', 'js');

function extract(file, marker, fn) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  const m = src.match(new RegExp(`// ${marker}:start\\n([\\s\\S]*?)// ${marker}:end`));
  if (!m) throw new Error(`no ${marker} block in ${file}`);
  return new Function(`${m[1]}\nreturn ${fn};`)();
}

describe.each(['entity.js', 'entity-explorer.js'])('countRoles in %s', (file) => {
  const countRoles = extract(file, 'role-counts', 'countRoles');

  // countRoles lowercases codes; these two are inherited names in lowercase
  const LOWER_INHERITED = ['constructor', '__proto__'];

  it('counts role codes that are inherited property names', () => {
    const links = [...LOWER_INHERITED, ...LOWER_INHERITED, 'Witness', 'witness', '', undefined].map((role) => ({ role }));
    const counts = countRoles(links);
    for (const code of LOWER_INHERITED) expect(counts[code]).toBe(2);
    expect(counts.witness).toBe(2);
    expect(Object.keys(counts).sort()).toEqual([...LOWER_INHERITED, 'witness'].sort());
  });
});

describe.each(['entity.js', 'entity-explorer.js'])('mixed-case role codes in %s', (file) => {
  const roleCode = extract(file, 'role-counts', 'roleCode');
  const countRoles = extract(file, 'role-counts', 'countRoles');

  it('compares role codes in lowercase', () => {
    expect(roleCode('Archivist')).toBe('archivist');
    expect(roleCode(undefined)).toBe('');
    const counts = countRoles([{ role: 'Archivist' }, { role: 'archivist' }, { role: 'ARCHIVIST' }]);
    expect(Object.keys(counts)).toEqual(['archivist']);
    expect(counts.archivist).toBe(3);
  });
});

describe('groupRolesByLabel in place.js', () => {
  const groupRolesByLabel = extract('place.js', 'role-label-groups', 'groupRolesByLabel');

  it('groups labels and codes that are inherited property names', () => {
    const labels = Object.assign(Object.create(null), { venue: 'constructor', subject: 'Mentioned', mentioned: 'Mentioned' });
    const links = ['venue', 'venue', '__proto__', 'subject', 'mentioned', undefined].map((role) => ({ role }));
    const groups = groupRolesByLabel(links, labels);
    expect(groups.constructor).toEqual({ roles: ['venue'], count: 2 });
    expect(groups['__proto__']).toEqual({ roles: ['__proto__'], count: 1 });
    expect(groups.Mentioned).toEqual({ roles: ['subject', 'mentioned'], count: 2 });
    expect(groups.unknown).toEqual({ roles: ['unknown'], count: 1 });
  });

  it('looks up a mixed-case place role by its lowercase code', () => {
    const labels = Object.assign(Object.create(null), { archivist: 'Archive of record' });
    const groups = groupRolesByLabel([{ role: 'Archivist' }, { role: 'archivist' }], labels);
    expect(groups['Archive of record']).toEqual({ roles: ['archivist'], count: 2 });
  });
});

// Version: v1.6.0
