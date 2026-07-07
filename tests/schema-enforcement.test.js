/**
 * Schema Enforcement — CI Gate for schemas/
 *
 * The JSON Schemas under `schemas/` ship and compile but are otherwise inert:
 * they are only consulted by `zasqua validate --strict`, and no CI path runs
 * that command. This file is the enforcement — `npm test` (which CI runs on
 * every push/PR) now exercises the full strict path (key + type pre-pass,
 * then the ajv draft-07 schema pass) end to end against the in-repo minimal
 * instance at tests/fixtures/engine-smoke/. If a schema in `schemas/` or the
 * fixture data drifts out of sync, this suite goes red.
 *
 * `validator.test.js` already unit-tests `validateSchemas` in isolation
 * against inline fixtures (accept path, reject path, absent-file skip). This
 * file does not repeat those cases; it instead runs the full `runValidate`
 * entry point — the same one `bin/zasqua.js`'s `validate` command calls —
 * against a real fixture directory, and separately proves the ajv pass is
 * the thing actually catching failures (not just the pre-pass).
 *
 * Proof-of-execution approach: `has_children` is present on every
 * engine-smoke description record as a boolean. It is NOT one of the keys
 * checked by the pre-pass's DESCRIPTION_FIELDS table in lib/validator.js, so
 * the pre-pass has nothing to say about its type. But descriptions.schema.json
 * declares `"has_children": { "type": "boolean" }`, so ajv will reject a
 * record where it has been mutated to a non-boolean. Flipping only that field
 * therefore isolates the schema pass: the pre-pass reports zero errors on the
 * mutated data (proving it isn't why validation fails), while the full strict
 * run fails with a "schema=descriptions.schema.json" error (proving ajv ran).
 *
 * Coverage limit: engine-smoke is a Core-only fixture (descriptions +
 * repositories only — entities, entity_links, places, and place_links are
 * absent, matching its all-modules-false manifest). This suite therefore
 * exercises validateSchemas' accept path for descriptions.schema.json and
 * repositories.schema.json only. The other four schemas are covered by the
 * inline-fixture unit tests in validator.test.js, not end to end here — doing
 * so would require inventing fixture data the engine-smoke fixture doesn't
 * carry, which is out of scope for this change.
 *
 * @version v1.4.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runValidate, validateInputs } = require('../lib/validator.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'engine-smoke');

// Core-only manifest matching tests/fixtures/engine-smoke/zasqua.manifest.toml,
// constructed in-line so the mutation test below doesn't need its own
// zasqua.manifest.toml on disk.
const CORE_ONLY_MANIFEST = {
  ui: { language: 'en-US' },
  modules: {
    hierarchy: false,
    entities: false,
    entities_graph: false,
    places: false,
    places_map: false,
    iiif: false,
    ocr: false,
  },
};

describe('schema enforcement — engine-smoke fixture, strict mode', () => {
  it('passes the full strict path (pre-pass + ajv schema pass) — the CI enforcement gate', () => {
    const errors = runValidate({ instanceRoot: FIXTURE, engineRoot: ENGINE_ROOT, strict: true });
    expect(errors).toEqual([]);
  });

  it('fails via the schema pass (not the pre-pass) when a schema-only-checked field has the wrong type', () => {
    // Copy the fixture's exports into a fresh temp instance dir, then mutate a
    // COPY of descriptions.json: flip has_children from boolean to a string.
    // has_children is absent from DESCRIPTION_FIELDS (lib/validator.js), so
    // the pre-pass cannot see this — only the ajv schema pass enforces its
    // "type": "boolean" declaration in descriptions.schema.json.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-schema-enforcement-'));
    try {
      const tmpExports = path.join(tmpRoot, 'exports');
      fs.mkdirSync(tmpExports, { recursive: true });

      const descriptions = JSON.parse(
        fs.readFileSync(path.join(FIXTURE, 'exports', 'descriptions.json'), 'utf8')
      );
      descriptions[0].has_children = 'not-a-boolean';
      fs.writeFileSync(path.join(tmpExports, 'descriptions.json'), JSON.stringify(descriptions), 'utf8');
      fs.copyFileSync(
        path.join(FIXTURE, 'exports', 'repositories.json'),
        path.join(tmpExports, 'repositories.json')
      );

      // Pre-pass alone: must report zero errors on this data — proves the
      // failure below cannot be coming from the key + type pre-pass.
      const preErrors = validateInputs(CORE_ONLY_MANIFEST, tmpExports);
      expect(preErrors).toEqual([]);

      // Full strict run: must fail, and the failure must be attributable to
      // the schema pass specifically (its errors are prefixed `schema=`,
      // distinct from the pre-pass's `module=` prefix).
      const fullErrors = runValidate({
        manifest: CORE_ONLY_MANIFEST,
        instanceRoot: tmpRoot,
        engineRoot: ENGINE_ROOT,
        strict: true,
      });
      expect(fullErrors.length).toBeGreaterThan(0);
      const combined = fullErrors.join(' ');
      expect(combined).toMatch(/schema=descriptions\.schema\.json/);
      expect(combined).toMatch(/has_children/);
    } finally {
      // Always remove the temp instance dir, even if an assertion above throws.
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

// Version: v1.4.0
