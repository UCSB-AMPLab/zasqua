/**
 * Init Auto-Detect — Data Scan and Manifest Scaffolding
 *
 * Provides the `zasqua init` command: scan the instance's `exports/`
 * directory, detect which capability modules are present in the data, and
 * write a fully-commented `zasqua.manifest.toml` at the instance root.
 * By default the command is non-interactive and refuses to overwrite an
 * existing manifest without `--force`.
 *
 * `zasqua init` is detect-only: it writes the manifest and does nothing more.
 * Scaffolding of `package.json`, `hugo.toml`, and the starter overlay theme is
 * the template repository's job. Deployers should start from
 * `UCSB-AMPLab/zasqua-template` (fork it), which provides the correct engine
 * dependency pin and Hugo configuration out of the box.
 *
 * Public API:
 *
 *   detectModules(dataDir)
 *     Inspect the exports directory and return a plain object describing
 *     which Zasqua modules the data supports. Detection rules:
 *       - entities: true if exports/entities.json exists
 *       - places: true if exports/places.json exists
 *       - entities_graph: true if entities is true (conservative default)
 *       - places_map: true if places is true (conservative default)
 *       - hierarchy: true if any description record has a non-empty
 *         parent_reference_code (full scan — no sampling)
 *       - iiif: 'auto' if any description has iiif_manifest_url; else false
 *       - ocr: 'auto' if any description has ocr_text; else false
 *     Scans ALL description records (not a sample) to avoid false negatives
 *     on corpora where optional fields appear only in later records.
 *
 *   scaffoldManifest(detected)
 *     Build the commented TOML string for zasqua.manifest.toml from the
 *     detected module flags. The string is self-documenting — each key has
 *     an inline comment explaining what it does and what data file it
 *     requires. Includes a [ui] section before
 *     [modules] with language = "en-US" as the neutral international
 *     default.
 *
 *   runInit(instanceRoot, { force })
 *     Resolve the manifest path at `instanceRoot/zasqua.manifest.toml`. If
 *     the file exists and `force` is false, emit an error and exit 1. Otherwise
 *     detect modules from `dataDir` and write the scaffolded TOML atomically
 *     (tmp file + fs.renameSync — so a crash mid-write can never leave a
 *     half-written manifest).
 *
 * The `dataDir` defaults to `process.env.DATA_DIR || path.join(instanceRoot,
 * 'exports')`, matching the convention used by the pipeline scripts.
 *
 * @version v0.5.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// detectModules — inspect data files and scan all descriptions
// ---------------------------------------------------------------------------

/**
 * Inspect the exports directory and return module-flag detection results.
 *
 * @param {string} dataDir — absolute path to the exports directory
 * @returns {object} module flags suitable for scaffoldManifest
 */
function detectModules(dataDir) {
  const has = (f) => fs.existsSync(path.join(dataDir, f));

  const entities = has('entities.json');
  const places = has('places.json');

  // Scan ALL description records for hierarchy/iiif/ocr fields.
  // No sampling: at 106K records a full scan takes a few seconds and
  // eliminates false negatives for fields that appear only in later records.
  let hierarchy = false;
  let iiif = false;
  let ocr = false;

  const descPath = path.join(dataDir, 'descriptions.json');
  if (fs.existsSync(descPath)) {
    let allDescs;
    try {
      allDescs = JSON.parse(fs.readFileSync(descPath, 'utf8'));
    } catch (e) {
      console.warn(`[init] WARN: could not parse descriptions.json — ${e.message}`);
      allDescs = [];
    }

    if (Array.isArray(allDescs)) {
      for (const d of allDescs) {
        if (!hierarchy && d.parent_reference_code) hierarchy = true;
        if (!iiif && d.iiif_manifest_url) iiif = true;
        if (!ocr && d.ocr_text) ocr = true;
        // Short-circuit once all three are found
        if (hierarchy && iiif && ocr) break;
      }
    }
  }

  return {
    hierarchy,
    entities,
    // Conservative: enable graph/map if their parent module is detected.
    // The deployer can disable either independently in the written manifest.
    entities_graph: entities,
    places,
    places_map: places,
    iiif: iiif ? 'auto' : false,
    ocr: ocr ? 'auto' : false,
  };
}

// ---------------------------------------------------------------------------
// scaffoldManifest — build the commented TOML string
// ---------------------------------------------------------------------------

/**
 * Format a TOML value for the manifest.
 *   true/false → bare boolean
 *   'auto'     → quoted string "auto"
 *
 * @param {boolean|string} val
 * @returns {string}
 */
function fmtVal(val) {
  if (val === 'auto') return '"auto"';
  return val ? 'true' : 'false';
}

/**
 * Build the fully-commented zasqua.manifest.toml string from a detected
 * module flags object.
 *
 * @param {object} detected — result from detectModules
 * @returns {string} TOML string ready to write to disk
 */
function scaffoldManifest(detected) {
  const lines = [
    '# Zasqua capability manifest — generated by `zasqua init`, edit as needed.',
    '# Run `zasqua validate` after editing to confirm your data matches what you\'ve enabled.',
    '',
    '[ui]',
    '# UI language — BCP-47 locale tag for the site\'s interface language.',
    '# Chrome strings (navigation, buttons, error messages) render in this language.',
    '# Supported: "en-US" (English), "es-CO" (Colombian Spanish).',
    '# The engine ships both bundles; set to match your audience.',
    'language = "en-US"',
    '',
    '[modules]',
    '# Core (descriptions + repositories) is always required — no flag here.',
    '',
    '# Hierarchy: derive a browsable tree from parent_reference_code.',
    '# Requires: parent_reference_code fields in descriptions.json.',
    `hierarchy = ${fmtVal(detected.hierarchy)}`,
    '',
    '# Entities: ISAAR(CPF) authority records (persons, bodies, families).',
    '# Requires: entities.json, entity_links.json.',
    `entities = ${fmtVal(detected.entities)}`,
    '',
    '# Entity co-occurrence graph visualization.',
    '# Requires: entities = true, and entities.json / entity_links.json.',
    `entities_graph = ${fmtVal(detected.entities_graph)}`,
    '',
    '# Places: geographic authority records and facet.',
    '# Requires: places.json, place_links.json.',
    `places = ${fmtVal(detected.places)}`,
    '',
    '# Interactive map of places (client-side MapLibre clustering from place-index.json).',
    '# Requires: places = true.',
    `places_map = ${fmtVal(detected.places_map)}`,
    '',
    '# IIIF deep-zoom viewer — enabled per-record wherever iiif_manifest_url is set.',
    '# Set to false to suppress the viewer entirely.',
    `iiif = ${fmtVal(detected.iiif)}`,
    '',
    '# OCR full-text search — enabled per-record wherever ocr_text is set.',
    '# Set to false to suppress OCR indexing entirely.',
    `ocr = ${fmtVal(detected.ocr)}`,
    '',
    '# Version: v0.3.0',
  ];

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

/**
 * Write `content` to `destPath` atomically using a tmp file + renameSync.
 * Protects against a half-written manifest if the process crashes mid-write.
 *
 * @param {string} destPath — absolute target path
 * @param {string} content  — UTF-8 string to write
 */
function writeAtomic(destPath, content) {
  const dir = path.dirname(destPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.tmp-${path.basename(destPath)}-${process.pid}-${Date.now()}`
  );
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// runInit — CLI entry point
// ---------------------------------------------------------------------------

/**
 * Run the init command for `instanceRoot`.
 *
 * Resolves the manifest path, checks the no-clobber guard, detects modules,
 * and writes the scaffolded TOML atomically.
 *
 * @param {string} instanceRoot      — absolute path to the instance root
 * @param {{ force?: boolean }} opts — `force: true` bypasses the no-clobber guard
 */
function runInit(instanceRoot, opts = {}) {
  const force = opts.force === true;
  const manifestPath = path.join(instanceRoot, 'zasqua.manifest.toml');

  if (fs.existsSync(manifestPath) && !force) {
    console.error('[init] zasqua.manifest.toml already exists — use --force to overwrite');
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR || path.join(instanceRoot, 'exports');
  const detected = detectModules(dataDir);
  const toml = scaffoldManifest(detected);

  writeAtomic(manifestPath, toml);
  console.log('[init] Wrote zasqua.manifest.toml — review and adjust before running zasqua build');
}

// ---------------------------------------------------------------------------
// Standalone mode
// ---------------------------------------------------------------------------

if (require.main === module) {
  const instanceRoot = process.env.INSTANCE_ROOT || process.cwd();
  const force = process.argv.includes('--force');
  runInit(instanceRoot, { force });
}

module.exports = { runInit, detectModules, scaffoldManifest };

// Version: v0.5.0
