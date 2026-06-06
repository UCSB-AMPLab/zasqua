/**
 * Import Dispatch — Format Registry and Library Entry Point
 *
 * This module deals with routing `zasqua import <format>` calls to the
 * correct adapter module. It maintains an explicit registry of the four
 * known format names — csv, ead3, collectiveaccess, fisqua — validates
 * the requested format against that registry, creates the staging
 * directory, delegates to the named adapter, and then runs the
 * conformance gate.
 *
 * Two design choices govern this module:
 *
 *   Explicit name registry — adapters register by format name only. There
 *   is no extension sniffing, no MIME-type detection, and no content-based
 *   dispatch. An archivist must spell out the format explicitly:
 *   `zasqua import csv ./my-data/`. This keeps the dispatch path
 *   deterministic and auditable.
 *
 *   Staging-first — import always writes to a staging directory
 *   (`import-out/` by default). It never touches `exports/`. The archivist
 *   inspects the output, then promotes it manually. This prevents an
 *   accidental re-run from clobbering a live dataset.
 *
 * The adapter is resolved lazily — `require('./' + format)` runs inside
 * `runImport()` after the format name has been validated. This means the
 * four adapter files (`csv.js`, `ead3.js`, `collectiveaccess.js`,
 * `fisqua.js`) are decoupled from this file and can be maintained
 * independently.
 *
 * Before delegating, dispatch cleans the six contract files from any
 * previous run in the staging directory so re-runs do not produce
 * duplicate records.
 *
 * Error handling: `runImport` throws an Error for unknown formats and for
 * conformance-gate failures, rather than calling process.exit() directly.
 * This makes both failure paths fully unit-testable and allows programmatic
 * callers to catch and handle import errors. The CLI (`bin/zasqua.js`)
 * catches these errors and exits with code 1.
 *
 * Public API:
 *
 *   runImport({ format, src, stagingDir, standard, instanceRoot })
 *     Validate the format name, clean the staging dir, call the adapter,
 *     then run validateInputs against the staging dir. Throws an Error on
 *     unknown format or conformance failure; prints a summary on success.
 *
 *   KNOWN_FORMATS
 *     Exported string array of the four registered format names. Used
 *     by tests to assert the registry contents without invoking runImport.
 *
 * @version v0.2.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { validateInputs } = require('../validator');
const { loadManifest }   = require('../manifest');

// ---------------------------------------------------------------------------
// Format registry — explicit name registry, no content sniffing
// ---------------------------------------------------------------------------

/**
 * The four registered format names. Adapters live at
 * `lib/importers/<name>.js` and are required lazily inside runImport() so
 * each adapter file stays decoupled from this registry.
 */
const KNOWN_FORMATS = ['csv', 'ead3', 'collectiveaccess', 'fisqua'];

// The six contract filenames that dispatch cleans before each run.
const CONTRACT_FILES = [
  'descriptions.json',
  'repositories.json',
  'entities.json',
  'entity_links.json',
  'places.json',
  'place_links.json',
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Route a `zasqua import` invocation to the named adapter, then run the
 * conformance gate against the staging directory.
 *
 * @param {object} opts
 * @param {string} opts.format       — one of KNOWN_FORMATS
 * @param {string} opts.src          — path to the source data (file or dir)
 * @param {string} opts.stagingDir   — directory to write output into
 * @param {string} opts.standard     — descriptive standard key (e.g. 'isadg')
 * @param {string} opts.instanceRoot — absolute path to the instance root
 */
async function runImport({ format, src, stagingDir, standard, instanceRoot }) {
  // Validate the format name against the explicit registry. Throws rather
  // than calling process.exit() so the failure is testable and programmatic
  // callers can catch and handle the error.
  if (!KNOWN_FORMATS.includes(format)) {
    throw new Error(
      `[import] Unknown format: "${format}". Available: ${KNOWN_FORMATS.join(', ')}`
    );
  }

  // Create the staging dir if absent — import never touches `exports/`.
  fs.mkdirSync(stagingDir, { recursive: true });

  // Clean pre-existing contract files before delegating so that re-runs do
  // not leave stale records from the previous execution.
  for (const file of CONTRACT_FILES) {
    const filePath = path.join(stagingDir, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Lazy adapter resolution — require only after format is confirmed valid.
  // This keeps the adapter files decoupled from the registry.
  const adapter = require('./' + format);
  await adapter.run({ src, stagingDir, standard, instanceRoot });

  // Conformance gate — validate against the staging dir only (staging-first
  // rule). Throws rather than calling process.exit() so the failure is testable.
  const manifest = loadManifest(instanceRoot);
  const errors   = validateInputs(manifest, stagingDir);
  if (errors.length > 0) {
    throw new Error('[import validate]\n' + errors.join('\n'));
  }
  console.log(`[import] ${format}: conformance check passed. Output in ${stagingDir}`);
}

module.exports = { runImport, KNOWN_FORMATS };

// Version: v0.2.0
