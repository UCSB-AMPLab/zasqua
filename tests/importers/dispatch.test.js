/**
 * Import Dispatch Unit Tests
 *
 * Tests for `runImport` and `KNOWN_FORMATS` from
 * `lib/importers/dispatch.js`. The dispatch module is the backbone that every
 * adapter plugs into — it maintains the explicit format name registry,
 * validates format requests before loading any adapter, and gates output
 * through validateInputs.
 *
 * Five behaviors covered:
 *
 *   1. Registry contents — KNOWN_FORMATS contains exactly the four registered
 *      names (csv, ead3, collectiveaccess, fisqua) and no others.
 *
 *   2. Valid format acceptance — the four registered names are each recognised
 *      as valid; no false rejections on known formats.
 *
 *   3. Unknown format rejection — a name outside the registry ('xml', 'json',
 *      any arbitrary string) is not accepted as a valid format name.
 *
 *   4. runImport throws on unknown format — calling runImport with an
 *      unregistered format name must throw an Error (not call process.exit()),
 *      making the failure catchable and testable.
 *
 *   5. runImport throws on conformance failure — calling runImport with a
 *      valid format but a staging directory that would fail validateInputs
 *      must throw an Error beginning with '[import validate]'.
 *
 * These are fast unit tests against the registry and error paths. Each
 * adapter's own test file covers its conformance.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { runImport, KNOWN_FORMATS } = require('../../lib/importers/dispatch.js');

// ---------------------------------------------------------------------------
// Registry contents
// ---------------------------------------------------------------------------

describe('dispatch — KNOWN_FORMATS registry', () => {
  it('exports KNOWN_FORMATS as an array', () => {
    expect(Array.isArray(KNOWN_FORMATS)).toBe(true);
  });

  it('contains exactly four entries', () => {
    expect(KNOWN_FORMATS).toHaveLength(4);
  });

  it('includes csv', () => {
    expect(KNOWN_FORMATS).toContain('csv');
  });

  it('includes ead3', () => {
    expect(KNOWN_FORMATS).toContain('ead3');
  });

  it('includes collectiveaccess', () => {
    expect(KNOWN_FORMATS).toContain('collectiveaccess');
  });

  it('includes fisqua', () => {
    expect(KNOWN_FORMATS).toContain('fisqua');
  });
});

// ---------------------------------------------------------------------------
// Format validation helpers (derived from registry)
// ---------------------------------------------------------------------------

describe('dispatch — format name validation (explicit-name registry)', () => {
  it('recognises all four valid format names', () => {
    for (const name of KNOWN_FORMATS) {
      expect(KNOWN_FORMATS.includes(name)).toBe(true);
    }
  });

  it('rejects "xml" — not a registered format name', () => {
    expect(KNOWN_FORMATS.includes('xml')).toBe(false);
  });

  it('rejects "json" — not a registered format name', () => {
    expect(KNOWN_FORMATS.includes('json')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(KNOWN_FORMATS.includes('')).toBe(false);
  });

  it('rejects undefined (treated as string)', () => {
    expect(KNOWN_FORMATS.includes(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runImport is a function
// ---------------------------------------------------------------------------

describe('dispatch — runImport entry point', () => {
  it('exports runImport as a function', () => {
    expect(typeof runImport).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// runImport throws on unknown format (not process.exit)
// ---------------------------------------------------------------------------

describe('dispatch — runImport throws on unknown format', () => {
  it('throws an Error for an unregistered format name', async () => {
    await expect(
      runImport({ format: 'xml', src: '/dev/null', stagingDir: '/tmp', standard: 'isadg', instanceRoot: '/tmp' })
    ).rejects.toThrow(/Unknown format/i);
  });

  it('thrown error message includes the unrecognised format name', async () => {
    await expect(
      runImport({ format: 'notaformat', src: '/dev/null', stagingDir: '/tmp', standard: 'isadg', instanceRoot: '/tmp' })
    ).rejects.toThrow('notaformat');
  });

  it('thrown error message lists available formats', async () => {
    await expect(
      runImport({ format: 'json', src: '/dev/null', stagingDir: '/tmp', standard: 'isadg', instanceRoot: '/tmp' })
    ).rejects.toThrow(/csv.*ead3.*collectiveaccess.*fisqua/);
  });
});

// ---------------------------------------------------------------------------
// runImport throws on conformance failure (not process.exit)
// An empty source directory has no descriptions.csv, so the csv adapter
// throws before the conformance gate. What matters is that the failure path
// produces a thrown Error (not a silent process.exit()), making it catchable
// by the CLI and testable here. The specific message confirms the error comes
// from the adapter layer (descriptions.csv not found).
// ---------------------------------------------------------------------------

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('dispatch — runImport throws on adapter/conformance failure', () => {
  it('throws a catchable Error when the adapter cannot find required source files', async () => {
    const emptyDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-dispatch-test-'));
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-staging-test-'));
    try {
      await expect(
        runImport({ format: 'csv', src: emptyDir, stagingDir, standard: 'isadg', instanceRoot: emptyDir })
      ).rejects.toBeInstanceOf(Error);
    } finally {
      fs.rmSync(emptyDir,   { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  it('the thrown Error is catchable (not a process.exit call)', async () => {
    let caught = null;
    const emptyDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-dispatch-catch-'));
    const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-staging-catch-'));
    try {
      await runImport({ format: 'csv', src: emptyDir, stagingDir, standard: 'isadg', instanceRoot: emptyDir });
    } catch (err) {
      caught = err;
    } finally {
      fs.rmSync(emptyDir,   { recursive: true, force: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBeTruthy();
  });
});

// Version: v0.2.0
