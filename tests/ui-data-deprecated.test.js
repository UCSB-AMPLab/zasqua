/**
 * ui.yaml Retirement Tests
 *
 * `themes/base/data/ui.yaml` holds Spanish interface strings that
 * templates once read through `hugo.Data.ui`. The engine's own templates
 * now read every interface string from the i18n bundles, so the strings
 * follow the site's language. The file stays in place, marked deprecated
 * for 2.0.0, because instance themes may still read it directly.
 *
 * These tests check that no engine template reads `Data.ui`, that the
 * strings the engine took from ui.yaml exist in both bundles, and that
 * the file carries its deprecation notice.
 *
 * @version v1.6.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parse } from 'smol-toml';

const BASE = path.join(__dirname, '..', 'themes', 'base');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('ui.yaml is no longer read by the engine', () => {
  it('no engine template reads Data.ui', () => {
    const readers = walk(path.join(BASE, 'layouts'))
      .filter(f => /Data\.ui\b/.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(BASE, f));
    expect(readers).toEqual([]);
  });

  it('both bundles carry the strings the engine took from ui.yaml', () => {
    for (const lang of ['en', 'es']) {
      const bundle = parse(fs.readFileSync(path.join(BASE, 'i18n', `${lang}.toml`), 'utf8'));
      for (const key of ['repository', 'level', 'dateRange', 'hasDigital', 'country']) {
        expect(typeof bundle.facets[key], `${lang} facets.${key}`).toBe('string');
      }
      expect(typeof bundle.repository.exploreCollections, `${lang} repository.exploreCollections`).toBe('string');
    }
  });

  it('marks ui.yaml as deprecated for 2.0.0', () => {
    const src = fs.readFileSync(path.join(BASE, 'data', 'ui.yaml'), 'utf8');
    expect(src).toMatch(/[Dd]eprecated/);
    expect(src).toMatch(/2\.0\.0/);
  });
});

// Version: v1.6.0
