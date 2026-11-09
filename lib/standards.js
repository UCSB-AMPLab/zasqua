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
 * `{instanceRoot}/themes/{name}/data/standards/{standard}.yaml`. The copies are
 * read in the order the `theme` setting of `hugo.toml` (or `config.toml`)
 * lists the themes, as Hugo reads its theme chain, or in name order without
 * that setting; the first copy that defines a key wins. A `data/` directory at
 * the site root is not read: the site's Hugo config mounts only the manifest
 * there, which replaces Hugo's default data mount. A key the override
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
const { parse: parseToml } = require('smol-toml');

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

/**
 * The site's themes, base excluded, in the order its Hugo config lists them,
 * or in name order when the config sets none or cannot be read.
 */
function themeOrder(instanceRoot) {
  for (const file of ['hugo.toml', 'config.toml']) {
    let config;
    try {
      config = parseToml(fs.readFileSync(path.join(instanceRoot, file), 'utf8'));
    } catch (err) {
      continue;
    }
    const theme = config && config.theme;
    const list = typeof theme === 'string' ? [theme] : Array.isArray(theme) ? theme : null;
    if (list) return list.filter(n => typeof n === 'string' && n !== 'base');
  }
  try {
    return fs.readdirSync(path.join(instanceRoot, 'themes')).filter(n => n !== 'base').sort();
  } catch (err) {
    return [];
  }
}

/** Instance copies of a profile, in theme-chain order, base excluded. */
function instanceProfiles(standard, instanceRoot) {
  if (!instanceRoot) return [];
  const files = themeOrder(instanceRoot).map(name =>
    path.join(instanceRoot, 'themes', name, 'data', 'standards', `${standard}.yaml`));
  const found = [];
  for (const file of files) {
    const data = readYaml(file);
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
