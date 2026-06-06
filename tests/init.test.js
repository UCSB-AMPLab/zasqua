/**
 * init Auto-Detect Unit Tests
 *
 * Tests for `detectModules` and `runInit` from `lib/init.js`. The init helper
 * scans an instance's `exports/` directory, detects which data files are
 * present and whether descriptions carry the fields that enable optional
 * modules, and writes a fully-commented `zasqua.manifest.toml`. By default it
 * refuses to overwrite an existing manifest; `--force` bypasses that
 * protection, so a deployer cannot silently lose hand-edited module flags.
 *
 * Five behaviors covered:
 *
 *   1. Full-feature detection — detectModules on a fixture dir with
 *      entities.json, places.json, and descriptions carrying
 *      parent_reference_code returns hierarchy:true, entities:true,
 *      entities_graph:true, places:true, places_map:true.
 *
 *   2. Core-only detection — detectModules on Core-only fixtures
 *      (descriptions + repositories only, no parent_reference_code, no
 *      iiif/ocr fields) returns all explorer modules false, iiif:false,
 *      ocr:false.
 *
 *   3. iiif/ocr detection — detectModules sets iiif:'auto' when any
 *      description carries iiif_manifest_url, and ocr:'auto' when any
 *      description carries ocr_text.
 *
 *   4. No-clobber — runInit refuses to overwrite an existing manifest
 *      without force=true (throws or exits non-zero).
 *
 *   5. Scaffold round-trip — the TOML written by runInit (with force=true)
 *      parses back through loadManifest to the flags that detectModules
 *      detected.
 *
 * All fixtures are written to os.tmpdir(). The no-clobber test stubs
 * process.exit to avoid killing the test runner.
 *
 * @version v0.1.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { detectModules, runInit } = require('../lib/init.js');
const { loadManifest } = require('../lib/manifest.js');

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Create a temp directory with an `exports/` subdirectory populated with the
 * given JSON files. Returns the instance root (the parent of `exports/`).
 *
 * @param {Object} files — { 'descriptions.json': [...], ... }
 * @returns {string} absolute path to the instance root
 */
function makeTmpInstance(files) {
  const instanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-init-test-'));
  const exportsDir = path.join(instanceRoot, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(exportsDir, name), JSON.stringify(data), 'utf8');
  }
  return instanceRoot;
}

/** Make a minimal description with optional overrides */
function makeDesc(overrides = {}) {
  return {
    id: 1,
    reference_code: 'co-ahrb-001',
    title: 'Test',
    description_level: 'fonds',
    parent_reference_code: null,
    repository_code: 'ahrb',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Behavior 1: full-feature detection
// ---------------------------------------------------------------------------

describe('detectModules — full-feature fixtures', () => {
  it('detects hierarchy, entities, entities_graph, places, places_map all true', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [makeDesc({ parent_reference_code: 'co-ahrb' })],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
      'entities.json': [{ entity_code: 'ne-abc12', display_name: 'López', entity_type: 'person' }],
      'entity_links.json': [{ entity_code: 'ne-abc12', reference_code: 'co-ahrb-001', role: 'subject' }],
      'places.json': [{ id: 1, place_code: 'nl-qfsbu', display_name: 'Bogotá' }],
      'place_links.json': [{ place_code: 'nl-qfsbu', reference_code: 'co-ahrb-001' }],
    });
    const dataDir = path.join(instanceRoot, 'exports');
    const detected = detectModules(dataDir);

    expect(detected.hierarchy).toBe(true);
    expect(detected.entities).toBe(true);
    expect(detected.entities_graph).toBe(true);
    expect(detected.places).toBe(true);
    expect(detected.places_map).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: Core-only detection
// ---------------------------------------------------------------------------

describe('detectModules — Core-only fixtures', () => {
  it('returns all explorer modules false with no optional files present', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [makeDesc()],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
    });
    const dataDir = path.join(instanceRoot, 'exports');
    const detected = detectModules(dataDir);

    expect(detected.hierarchy).toBe(false);
    expect(detected.entities).toBe(false);
    expect(detected.entities_graph).toBe(false);
    expect(detected.places).toBe(false);
    expect(detected.places_map).toBe(false);
    expect(detected.iiif).toBe(false);
    expect(detected.ocr).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: iiif / ocr detection
// ---------------------------------------------------------------------------

describe('detectModules — iiif and ocr field detection', () => {
  it('sets iiif:"auto" when any description carries iiif_manifest_url', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [
        makeDesc(),
        makeDesc({ id: 2, reference_code: 'co-ahrb-002', iiif_manifest_url: 'https://example.com/iiif/2/manifest' }),
      ],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
    });
    const dataDir = path.join(instanceRoot, 'exports');
    const detected = detectModules(dataDir);
    expect(detected.iiif).toBe('auto');
  });

  it('sets ocr:"auto" when any description carries ocr_text', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [
        makeDesc(),
        makeDesc({ id: 3, reference_code: 'co-ahrb-003', ocr_text: 'Texto de transcripción' }),
      ],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
    });
    const dataDir = path.join(instanceRoot, 'exports');
    const detected = detectModules(dataDir);
    expect(detected.ocr).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: no-clobber
// ---------------------------------------------------------------------------

describe('runInit — no-clobber without force', () => {
  it('does not overwrite an existing manifest when force is false', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [makeDesc()],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
    });
    // Pre-write a manifest so it exists
    const manifestPath = path.join(instanceRoot, 'zasqua.manifest.toml');
    fs.writeFileSync(manifestPath, '# existing\n[modules]\nhierarchy = false\n', 'utf8');

    // Stub process.exit so it throws instead of killing the runner
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    expect(() => runInit(instanceRoot, { force: false })).toThrow();
    // The existing manifest content must be unchanged
    expect(fs.readFileSync(manifestPath, 'utf8')).toContain('# existing');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: scaffold round-trip
// ---------------------------------------------------------------------------

describe('runInit — scaffold round-trip', () => {
  it('writes a TOML that round-trips through loadManifest to the detected flags', () => {
    const instanceRoot = makeTmpInstance({
      'descriptions.json': [
        makeDesc({ parent_reference_code: 'co-ahrb' }),
        makeDesc({ id: 2, reference_code: 'co-ahrb-002', iiif_manifest_url: 'https://example.com/iiif' }),
      ],
      'repositories.json': [{ id: 1, code: 'ahrb', name: 'Archivo' }],
      'entities.json': [{ entity_code: 'ne-abc12', display_name: 'López', entity_type: 'person' }],
      'entity_links.json': [{ entity_code: 'ne-abc12', reference_code: 'co-ahrb-001', role: 'subject' }],
    });

    // runInit should succeed (no prior manifest, no force needed)
    runInit(instanceRoot, { force: false });

    const manifestPath = path.join(instanceRoot, 'zasqua.manifest.toml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Round-trip: parse the written TOML back and check the flags
    const loaded = loadManifest(instanceRoot);
    expect(loaded.modules.hierarchy).toBe(true);
    expect(loaded.modules.entities).toBe(true);
    expect(loaded.modules.entities_graph).toBe(true);
    expect(loaded.modules.iiif).toBe('auto');
  });
});

// Version: v0.1.0
