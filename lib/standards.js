/**
 * Standards Profile Reader — Level Order and Dublin Core Types
 *
 * This module deals with reading the language-independent data in the
 * descriptive-standard profiles (`themes/base/data/standards/{isadg,dacs,rad}.yaml`)
 * from Node. Hugo reads those files for templates; the METS generator runs
 * outside Hugo and needs the same data.
 *
 * Two top-level keys are language-independent and sit beside the `es` and `en`
 * blocks: `level_order`, the list of level codes in hierarchy order, and
 * `dc_types`, the map from a level code to its Dublin Core type. The order is
 * a list because Hugo does not keep the order of a YAML map.
 *
 * `loadStandardData(standard, instanceRoot)` returns `{ level_order, dc_types }`
 * for one standard. A site can override a profile by shipping its own copy at
 * `{instanceRoot}/themes/{name}/data/standards/{standard}.yaml`; the first such
 * copy that defines a key wins, as in Hugo's theme chain. A key the override
 * lacks (a copy made before these keys existed) comes from the engine's own
 * profile, and an unknown standard falls back to `isadg`.
 *
 * `dcTypeFor(standard, level, instanceRoot)` is the lookup the METS generator
 * uses for a single record.
 *
 * @version v1.6.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ENGINE_STANDARDS_DIR = path.join(__dirname, '..', 'themes', 'base', 'data', 'standards');

// One build reads the same profile for every record, so results are kept.
const cache = new Map();

function readYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Instance copies of a profile, in theme-directory order, base excluded. */
function instanceProfiles(standard, instanceRoot) {
  if (!instanceRoot) return [];
  const themesDir = path.join(instanceRoot, 'themes');
  let names;
  try {
    names = fs.readdirSync(themesDir).filter(n => n !== 'base').sort();
  } catch (err) {
    return [];
  }
  const found = [];
  for (const name of names) {
    const data = readYaml(path.join(themesDir, name, 'data', 'standards', `${standard}.yaml`));
    if (data) found.push(data);
  }
  return found;
}

/**
 * Read `level_order` and `dc_types` for a standard.
 *
 * @param {string} standard      — 'isadg', 'dacs' or 'rad'
 * @param {string} [instanceRoot] — instance root, to find override copies
 * @returns {{ level_order: string[], dc_types: Object<string,string> }}
 */
function loadStandardData(standard, instanceRoot) {
  const std = standard || 'isadg';
  const cacheKey = `${std}\0${instanceRoot || ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const engine = readYaml(path.join(ENGINE_STANDARDS_DIR, `${std}.yaml`))
    || readYaml(path.join(ENGINE_STANDARDS_DIR, 'isadg.yaml'))
    || {};
  const sources = [...instanceProfiles(std, instanceRoot), engine];
  const pick = (key, fallback) => {
    for (const src of sources) {
      if (src[key] != null) return src[key];
    }
    return fallback;
  };
  const data = {
    level_order: pick('level_order', []),
    dc_types: pick('dc_types', {}),
  };
  cache.set(cacheKey, data);
  return data;
}

/** Dublin Core type for a level under a standard; '' when the level is unknown. */
function dcTypeFor(standard, level, instanceRoot) {
  return loadStandardData(standard, instanceRoot).dc_types[level] || '';
}

function clearCache() { cache.clear(); }

module.exports = { loadStandardData, dcTypeFor, clearCache, ENGINE_STANDARDS_DIR };

// Version: v1.6.0
