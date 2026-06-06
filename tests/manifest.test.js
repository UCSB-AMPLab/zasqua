/**
 * Manifest Loader Unit Tests
 *
 * Tests for `loadManifest`, the shared helper that reads a
 * `zasqua.manifest.toml` file from an instance root and returns
 * the module-flag object that controls what the build pipeline
 * produces. The loader lives in `lib/manifest.js` and is used by
 * the validator, init helper, and every guarded read in the
 * pipeline scripts.
 *
 * Four behaviors covered:
 *
 *   1. Full-feature TOML fixture — loadManifest returns the correct
 *      module flags including hierarchy = true and iiif = "auto".
 *
 *   2. Missing manifest — loadManifest returns Core-only DEFAULTS
 *      without throwing. Core-only means all explorer flags are
 *      false; iiif and ocr default to "auto" (per-record mode).
 *
 *   3. "auto" string preservation — iiif and ocr come back as the
 *      literal string "auto", not coerced to the boolean true.
 *
 *   4. Boolean false round-trip — a fixture with entities = false
 *      returns modules.entities === false (not null, not undefined).
 *
 * Fixtures are written to os.tmpdir() inline — no dependency on the
 * real instance manifest at instance/zasqua.manifest.toml.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadManifest } = require('../lib/manifest.js');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Write a TOML string to a temp directory and return the directory path.
 * The caller's `instanceRoot` is that directory.
 */
function writeTmpManifest(tomlContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-manifest-test-'));
  fs.writeFileSync(path.join(dir, 'zasqua.manifest.toml'), tomlContent, 'utf8');
  return dir;
}

// ---------------------------------------------------------------------------
// Behavior 1: full-feature TOML fixture
// ---------------------------------------------------------------------------

describe('loadManifest — full-feature fixture', () => {
  const toml = `
[modules]
hierarchy = true
entities = true
entities_graph = true
places = true
places_map = true
iiif = "auto"
ocr = "auto"
`;

  it('returns modules.hierarchy === true', () => {
    const root = writeTmpManifest(toml);
    const result = loadManifest(root);
    expect(result.modules.hierarchy).toBe(true);
  });

  it('returns modules.iiif === "auto" (string, not boolean)', () => {
    const root = writeTmpManifest(toml);
    const result = loadManifest(root);
    expect(result.modules.iiif).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: missing manifest returns DEFAULTS without throwing
// ---------------------------------------------------------------------------

describe('loadManifest — missing manifest', () => {
  it('returns DEFAULTS and does not throw when zasqua.manifest.toml is absent', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-missing-'));
    let result;
    expect(() => {
      result = loadManifest(emptyDir);
    }).not.toThrow();
    // Core-only defaults: all explorer flags false, iiif/ocr "auto"
    expect(result.modules.hierarchy).toBe(false);
    expect(result.modules.entities).toBe(false);
    expect(result.modules.entities_graph).toBe(false);
    expect(result.modules.places).toBe(false);
    expect(result.modules.places_map).toBe(false);
    expect(result.modules.iiif).toBe('auto');
    expect(result.modules.ocr).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: "auto" is preserved as a string, not coerced to true
// ---------------------------------------------------------------------------

describe('loadManifest — "auto" string preservation', () => {
  const toml = `
[modules]
hierarchy = true
entities = false
entities_graph = false
places = false
places_map = false
iiif = "auto"
ocr = "auto"
`;

  it('preserves iiif = "auto" as the string "auto", not boolean true', () => {
    const root = writeTmpManifest(toml);
    const result = loadManifest(root);
    expect(result.modules.iiif).toBe('auto');
    expect(typeof result.modules.iiif).toBe('string');
    expect(result.modules.iiif).not.toBe(true);
  });

  it('preserves ocr = "auto" as the string "auto"', () => {
    const root = writeTmpManifest(toml);
    const result = loadManifest(root);
    expect(result.modules.ocr).toBe('auto');
    expect(typeof result.modules.ocr).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: boolean false round-trip
// ---------------------------------------------------------------------------

describe('loadManifest — entities = false', () => {
  const toml = `
[modules]
hierarchy = true
entities = false
entities_graph = false
places = false
places_map = false
iiif = "auto"
ocr = "auto"
`;

  it('returns modules.entities === false (not null, not undefined)', () => {
    const root = writeTmpManifest(toml);
    const result = loadManifest(root);
    expect(result.modules.entities).toBe(false);
    expect(result.modules.entities).not.toBeNull();
    expect(result.modules.entities).not.toBeUndefined();
  });
});

// Version: v0.1.0
