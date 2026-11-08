/**
 * Label maps in the browser scripts
 *
 * The entity, place and explorer scripts read code → label maps from
 * data-*-labels attributes and show `labels[code] || code`. A plain object
 * would answer a code such as "constructor" with an inherited function,
 * so each script carries the same `parseLabelMap(raw)` between
 * `label-map:start` and `label-map:end` markers, which builds a map with
 * no prototype. This test lifts that block out of each file, runs it under
 * Node, and checks that inherited names fall back to the code, that only
 * string labels are kept, and that a missing or malformed attribute gives
 * an empty map. It also checks that no script parses a label attribute
 * with a bare JSON.parse.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const JS_DIR = path.join(__dirname, '..', 'themes', 'base', 'static', 'js');
const FILES = ['entity.js', 'entity-explorer.js', 'infinite-bipartite-explorer.js', 'place.js', 'place-explorer.js'];
const LABEL_ATTRS = 'roleLabels|roleGroupLabels|entityTypeLabels|entityTypes|placeRoleLabels|placeTypes';

function extract(src, name) {
  const m = src.match(/\/\/ label-map:start\n([\s\S]*?)\/\/ label-map:end/);
  if (!m) throw new Error(`no label-map block in ${name}`);
  return new Function(`${m[1]}\nreturn parseLabelMap;`)();
}

describe.each(FILES)('parseLabelMap in %s', (name) => {
  const src = fs.readFileSync(path.join(JS_DIR, name), 'utf8');
  const parseLabelMap = extract(src, name);

  it('falls back to the code for inherited property names', () => {
    const labels = parseLabelMap(JSON.stringify({ witness: 'Witness' }));
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(labels[code] || code).toBe(code);
    }
    expect(labels.witness || 'witness').toBe('Witness');
  });

  it('keeps a label whose code is an inherited name', () => {
    expect(parseLabelMap(JSON.stringify({ constructor: 'Builder' })).constructor).toBe('Builder');
  });

  it('keeps string labels only', () => {
    const labels = parseLabelMap(JSON.stringify({ a: 'A', b: 1, c: null, d: { x: 1 } }));
    expect(Object.keys(labels)).toEqual(['a']);
  });

  it('gives an empty map for a missing or malformed attribute', () => {
    for (const raw of [undefined, '', 'not json', '[]', 'null', '"text"']) {
      const labels = parseLabelMap(raw);
      expect(Object.keys(labels)).toEqual([]);
      expect(labels.constructor || 'constructor').toBe('constructor');
    }
  });

  it('reads no label attribute with a bare JSON.parse', () => {
    expect(src).not.toMatch(new RegExp(`JSON\\.parse\\([^)]*dataset\\.(${LABEL_ATTRS})\\b`));
  });
});

// Version: v1.6.0
