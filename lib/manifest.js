/**
 * Manifest Loader — Capability Manifest Reader
 *
 * Reads the `zasqua.manifest.toml` file at the instance root and
 * returns a plain JavaScript object describing which modules the
 * deployer has enabled. Every pipeline script (precompute-links,
 * generate-content, generate-pagefind-indices) calls this once at
 * the top of its main() function; the returned object gates which
 * data files are loaded and which output files are written.
 *
 * Public API:
 *
 *   loadManifest(instanceRoot)
 *     Reads zasqua.manifest.toml from instanceRoot and returns its
 *     parsed content as a plain object. If the file is absent —
 *     for example, when a deployer is running the engine for the
 *     first time — the function logs a warning and returns the
 *     Core-only DEFAULTS (all explorer modules false; iiif and ocr
 *     set to "auto" so per-record IIIF/OCR records still render
 *     wherever the data carries those fields). It never throws on
 *     a missing file; only a malformed TOML will propagate an error.
 *
 *   DEFAULTS
 *     The Core-only baseline object, exported for test reuse. Every
 *     explorer module (hierarchy, entities, entities_graph, places,
 *     places_map) defaults to false. iiif and ocr default to "auto"
 *     because the engine's description template gates the IIIF viewer
 *     and OCR panel on per-record field presence — "auto" means "show
 *     wherever the data says so", which is the safest starting point
 *     for a deployer who hasn't yet customised their manifest.
 *
 *     The ui section defaults to language: 'en-US' — the neutral
 *     international default for a fresh generic instance.
 *
 * The `instanceRoot` parameter defaults to
 * `process.env.INSTANCE_ROOT || process.cwd()` when called without
 * arguments, matching the convention used by all other engine scripts.
 *
 * TOML parsing uses smol-toml (BSD-3-Clause, zero runtime deps,
 * TOML 1.0 spec, 15+ M weekly downloads on npm). smol-toml returns
 * a plain JS object; no post-processing is needed for this manifest's
 * simple flat structure.
 *
 * @version v0.2.0
 */

'use strict';

const { parse } = require('smol-toml');
const fs = require('fs');
const path = require('path');

/**
 * Core-only defaults. Returned when zasqua.manifest.toml is absent.
 * Exported for test reuse — do not mutate.
 */
const DEFAULTS = {
  ui: {
    language: 'en-US',   // neutral default for a fresh instance
  },
  modules: {
    hierarchy: false,
    entities: false,
    entities_graph: false,
    places: false,
    places_map: false,
    iiif: 'auto',
    ocr: 'auto',
  },
};

/**
 * Read and parse zasqua.manifest.toml from instanceRoot.
 *
 * @param {string} [instanceRoot] — absolute path to the instance root
 *   (defaults to process.env.INSTANCE_ROOT || process.cwd())
 * @returns {object} parsed manifest object, or DEFAULTS if file is absent
 */
function loadManifest(instanceRoot) {
  const root = instanceRoot || process.env.INSTANCE_ROOT || process.cwd();
  const manifestPath = path.join(root, 'zasqua.manifest.toml');

  if (!fs.existsSync(manifestPath)) {
    console.warn('[manifest] No zasqua.manifest.toml found — using Core-only defaults');
    return DEFAULTS;
  }

  const raw = fs.readFileSync(manifestPath, 'utf8');
  return parse(raw);
}

module.exports = { loadManifest, DEFAULTS };

// Version: v0.2.0
