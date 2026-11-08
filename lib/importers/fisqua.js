/**
 * Fisqua Import Adapter — Validating Passthrough
 *
 * This module deals with copying a Fisqua export's six-file contract
 * directly into a staging directory for `zasqua validate` conformance
 * gating and eventual manual promotion to `exports/`.
 *
 * By default this passthrough does NOT run the shared sanitiser on any
 * field, including `ocr_text`, unlike the CSV or EAD3 adapters. The `trusted`
 * setting decides this (CLI: `--trusted` or `--sanitize`); `trusted: false`
 * strips markup from every string value after the copy. The default stays
 * unsanitised because Fisqua's own output is structurally correct and already
 * in canonical contract shape; sanitising it would:
 *   (a) corrupt Go-template sequences ({{ / {%) that Fisqua legitimately
 *       emits in OCR text, and
 *   (b) strip trusted formatting from scope notes that Fisqua has already
 *       curated.
 *
 * Scope:
 * This adapter delivers the zasqua side of the Fisqua handoff. The live
 * cutover — switching the published site to build from Fisqua data in
 * production — is deferred to a later release. This file exists to prove
 * CLI symmetry and losslessness. The Fisqua-side "zasqua export" command is
 * a separate deliverable in the Fisqua project.
 *
 * Trivial reconciliation:
 * If the Fisqua export uses a near-equivalent key name for a contract
 * field, the adapter may perform a one-line rename. The golden fixture
 * is authored in canonical contract shape, so for it the copy is verbatim
 * and no reconciliation is needed.
 *
 * The dispatch.js conformance gate runs validateInputs against the
 * staging directory after run() returns. The passthrough itself does not
 * call validateInputs — that responsibility belongs to the dispatcher.
 *
 * Public API:
 *
 *   run({ src, stagingDir, trusted })
 *     Copy each of the six contract files from `src` to `stagingDir`
 *     using fs.copyFileSync (when the file is present in `src`). With
 *     `trusted: false` each copied file is then read, every string value is
 *     passed through `sanitizeField`, and the file is written back. Returns
 *     a plain object summarising which files were copied and which were
 *     absent.
 *
 * @version v1.6.0
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { sanitizeField } = require('../sanitize');

// The six contract filenames that a Fisqua export must provide.
const CONTRACT_FILES = [
  'descriptions.json',
  'repositories.json',
  'entities.json',
  'entity_links.json',
  'places.json',
  'place_links.json',
];

/**
 * Run every string value in parsed JSON through `sanitizeField`. Keys,
 * numbers, booleans and nulls stay as they are.
 */
function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitizeField(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out;
  }
  return value;
}

/**
 * Copy the six-file contract from a Fisqua export directory into `stagingDir`.
 *
 * No sanitisation is applied unless `trusted` is false.
 * The caller (dispatch.js) runs validateInputs after this function returns.
 *
 * @param {object} opts
 * @param {string} opts.src        — path to the Fisqua export directory
 * @param {string} opts.stagingDir — destination staging directory (already created by dispatch)
 * @param {boolean} [opts.trusted=true] — false strips markup from every string value
 * @returns {{ copied: string[], absent: string[] }}
 */
async function run({ src, stagingDir, trusted = true }) {
  const srcDir = path.resolve(src);
  const copied = [];
  const absent = [];

  for (const file of CONTRACT_FILES) {
    const srcPath  = path.join(srcDir, file);
    const destPath = path.join(stagingDir, file);

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      if (!trusted) {
        const data = JSON.parse(fs.readFileSync(destPath, 'utf8'));
        fs.writeFileSync(destPath, JSON.stringify(sanitizeDeep(data), null, 2), 'utf8');
      }
      copied.push(file);
    } else {
      absent.push(file);
    }
  }

  if (absent.length > 0) {
    console.log(`[import fisqua] absent files (optional): ${absent.join(', ')}`);
  }
  console.log(`[import fisqua] copied ${copied.length} contract file(s): ${copied.join(', ')}`);

  return { copied, absent };
}

module.exports = { run };

// Version: v1.6.0
