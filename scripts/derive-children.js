'use strict';

/**
 * Derive Miller-Column Hierarchy Shards from Parent Relationships
 *
 * Zasqua's archival tree browser (the Miller-column hierarchy) lets users
 * navigate from a parent description down to its children — from a fondo
 * to its series, from a series to its expedientes, and so on. This script
 * builds the per-parent shard files that power those navigation panels
 * without downloading pre-computed data from external storage.
 *
 * Each shard is a small JSON file named after the parent's numeric id
 * (e.g. `exports/children/1.json`). It contains a Django REST Framework
 * pagination envelope — `{"count": N, "results": [...]}` — listing the
 * children in `reference_code` ascending order so the tree renders them
 * in archival shelf order. Each child object carries exactly nine fields:
 * id, reference_code, title, description_level, date_expression,
 * scope_content, child_count, children_level, and has_digital.
 *
 * Pipeline context: runs as Stage 2b in `build.sh`, after precompute-links
 * (Stage 2) and before npm ci (Stage 3). Reads `exports/descriptions.json`
 * and writes one file per parent to `exports/children/{parent_id}.json`.
 *
 * Reads:
 *   exports/descriptions.json  — the flat array of all archival records
 * Writes:
 *   exports/children/{parent_id}.json  — one shard per parent-with-children
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so exports/ resolves to the instance.
 *   DATA_DIR       — override the default exports directory (absolute path).
 *
 * Orphan handling: a child whose parent_id does not appear in the
 * descriptions array is warned about and skipped — no shard is written for
 * that parent_id and the child is not promoted to root. A `[derive-children]
 * WARN` line is emitted for each orphan so operators can investigate data
 * integrity issues without a build crash.
 *
 * @version v0.1.0
 */

const fs = require('fs');
const path = require('path');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');

// ---------------------------------------------------------------------------
// JSON serializer that matches Python's json.dumps default format exactly:
//   separators = (", ", ": ")  →  {"key": value, "key2": value2}
// The B2 reference shards were produced by Django REST Framework (Python),
// which uses this separator style. Byte-parity against those reference
// shards requires matching it exactly.
//
// Node's JSON.stringify uses no spaces, so we need a custom encoder.
// The output is UTF-8 with raw Unicode characters (not \uXXXX escapes),
// matching Python's ensure_ascii=False default in DRF's JSONRenderer.
// ---------------------------------------------------------------------------

/**
 * Serialize a value to a JSON string using Python json.dumps default
 * separators: key": "value (colon-space after keys) and ", " between items.
 * Produces raw UTF-8 — no \uXXXX escaping of non-ASCII characters.
 *
 * @param {*} value
 * @returns {string}
 */
function serializePythonJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    // Escape only the characters JSON requires: backslash, double-quote,
    // and control characters. Do NOT escape non-ASCII — Python's default
    // ensure_ascii=False passes them through as raw UTF-8.
    return '"' + value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\x00-\x1f\x7f]/g, c => {
        const hex = c.charCodeAt(0).toString(16).padStart(4, '0');
        return `\\u${hex}`;
      }) + '"';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[' + value.map(serializePythonJson).join(', ') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const pairs = keys.map(k => `${serializePythonJson(k)}: ${serializePythonJson(value[k])}`);
    return '{' + pairs.join(', ') + '}';
  }
  // Fallback (undefined, functions) — JSON standard omits these.
  return 'null';
}

// ---------------------------------------------------------------------------
// Pure helper: derive children shards from a descriptions array.
// Returns { shards, warnings } where shards is a Map<parentId, shardObject>
// and warnings is an array of warning strings for orphan children.
// ---------------------------------------------------------------------------

/**
 * Derive children shards from a flat descriptions array.
 *
 * @param {Array} descriptions - flat array of description objects
 * @returns {{ shards: Map<number, object>, warnings: string[] }}
 */
function deriveChildren(descriptions) {
  // Build a set of valid ids so we can detect orphans cheaply.
  const validIds = new Set(descriptions.map(d => d.id));

  // Group children by parent_id. Each group entry is an array of
  // child objects with exactly the 9 contract fields in confirmed order.
  const byParent = new Map();
  const warnings = [];

  for (const desc of descriptions) {
    const parentId = desc.parent_id;

    // Root records have no parent — skip.
    if (parentId === null || parentId === undefined) {
      continue;
    }

    // Orphan check: parent_id references a record not in this export.
    if (!validIds.has(parentId)) {
      const msg =
        `orphan child id=${desc.id} reference_code=${desc.reference_code} ` +
        `has parent_id=${parentId} which is not present in descriptions.json`;
      warnings.push(msg);
      continue;
    }

    if (!byParent.has(parentId)) {
      byParent.set(parentId, []);
    }

    // Emit exactly the 9 confirmed fields in confirmed order.
    // date_expression defaults to '' when null (pipeline contract).
    byParent.get(parentId).push({
      id: desc.id,
      reference_code: desc.reference_code,
      title: desc.title,
      description_level: desc.description_level,
      date_expression: desc.date_expression || '',
      scope_content: desc.scope_content || '',
      child_count: desc.child_count || 0,
      children_level: desc.children_level !== undefined ? desc.children_level : null,
      has_digital: desc.has_digital || false,
    });
  }

  // Sort each parent's children by reference_code ascending — this matches the
  // ordering of every multi-child shard in the B2 reference set, confirmed by
  // spot-check. Use localeCompare for safe string sort; reference_code values
  // are pure ASCII in practice but localeCompare is defensive against any
  // future Unicode codes.
  const shards = new Map();
  for (const [parentId, children] of byParent) {
    children.sort((a, b) => {
      if (a.reference_code === null && b.reference_code === null) return 0;
      if (a.reference_code === null) return 1;
      if (b.reference_code === null) return -1;
      return a.reference_code.localeCompare(b.reference_code);
    });
    shards.set(parentId, {
      count: children.length,
      results: children,
    });
  }

  return { shards, warnings };
}

// ---------------------------------------------------------------------------
// Entry point: read descriptions.json, derive shards, write files.
// ---------------------------------------------------------------------------

async function main() {
  const descriptionsPath = path.join(DATA_DIR, 'descriptions.json');
  console.log(`[derive-children] DATA_DIR: ${DATA_DIR}`);

  if (!fs.existsSync(descriptionsPath)) {
    throw new Error(
      `[derive-children] required input missing: ${descriptionsPath}`
    );
  }

  console.log(`[derive-children] Reading ${descriptionsPath}`);
  const descriptions = JSON.parse(fs.readFileSync(descriptionsPath, 'utf8'));
  console.log(`[derive-children] descriptions.json: ${descriptions.length} records`);

  const { shards, warnings } = deriveChildren(descriptions);

  // Emit orphan warnings before writing anything.
  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`[derive-children] WARN: ${w}`);
    }
    console.warn(
      `[derive-children] WARN: ${warnings.length} orphan child(ren) skipped`
    );
  }

  // Write one shard per parent. The serialization must match Python's
  // json.dumps default format (", " and ": " separators, raw UTF-8) to
  // achieve byte-parity with the B2 reference shards.
  const childrenDir = path.join(DATA_DIR, 'children');
  fs.mkdirSync(childrenDir, { recursive: true });

  let shardCount = 0;
  for (const [parentId, shard] of shards) {
    const shardPath = path.join(childrenDir, `${parentId}.json`);
    fs.writeFileSync(shardPath, serializePythonJson(shard), 'utf8');
    shardCount++;
    if (shardCount % 1000 === 0) {
      console.log(`[derive-children] Wrote ${shardCount} shards...`);
    }
  }

  console.log(
    `[derive-children] Wrote ${shardCount} children shards to ${childrenDir}`
  );
  console.log(
    `[derive-children] Skipped ${warnings.length} orphan child(ren)`
  );
}

module.exports = { deriveChildren, serializePythonJson };

if (require.main === module) {
  main().catch(err => {
    console.error('[derive-children] Fatal error:', (err && err.stack) || err);
    process.exit(1);
  });
}

// Version: v0.1.0
