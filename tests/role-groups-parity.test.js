/**
 * roleGroups Cross-File Parity Unit Test
 *
 * The role→group taxonomy (which of the ~27 documentary roles belongs to
 * which of 7 thematic groups) is duplicated verbatim as a `roleGroups`
 * array literal in `static/js/entity.js` and `static/js/entity-explorer.js`.
 * Both files are loaded as classic `<script>` tags (no ES module imports,
 * no CommonJS export of `roleGroups`), so the arrays cannot be shared via
 * import and cannot be pulled in through the `createRequire` bridge the
 * `selectFacetCounts` tests use (that bridge only surfaces symbols a file
 * explicitly attaches to `module.exports`).
 *
 * Instead this test reads each file's source text directly and extracts
 * the `roleGroups` array literal by bracket-matching from the `var
 * roleGroups = [` marker to its balanced closing `]`, then evaluates that
 * literal in isolation via `new Function('return (...)')()`. This is the
 * least-fragile option available without editing the source files
 * themselves: a plain string/regex diff would be brittle against harmless
 * formatting differences (the two files already format the array
 * differently — one multi-line per group, one single-line per group), and
 * evaluating the extracted literal itself sidesteps that by comparing the
 * resulting data structures, not the source text.
 *
 * This test has no opinion on which copy is "correct" — it only pins that
 * the two stay structurally identical. A future role added to one array
 * and not the other, or reordered so group iteration order diverges, fails
 * this test rather than silently misclassifying a role on one surface but
 * not the other.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.join(__dirname, '..');

const ENTITY_JS_PATH = path.join(ENGINE_ROOT, 'themes/base/static/js/entity.js');
const ENTITY_EXPLORER_JS_PATH = path.join(ENGINE_ROOT, 'themes/base/static/js/entity-explorer.js');

// Extracts the `roleGroups` array literal from a browser JS source file by
// bracket-matching from `var roleGroups = [` to its balanced closing `]`,
// then evaluates that literal in isolation (no access to the file's other
// module-scope bindings — only the array literal text itself is run).
function extractRoleGroups(sourceText, label) {
  const marker = 'var roleGroups = [';
  const markerIdx = sourceText.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`Could not find "${marker}" in ${label}`);
  }

  const arrayStart = markerIdx + marker.length - 1; // index of the opening '['
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < sourceText.length; i++) {
    const ch = sourceText[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        arrayEnd = i;
        break;
      }
    }
  }
  if (arrayEnd === -1) {
    throw new Error(`Could not find balanced closing bracket for roleGroups in ${label}`);
  }

  const literal = sourceText.slice(arrayStart, arrayEnd + 1);
  // eslint-disable-next-line no-new-func -- the literal is a bracket-matched
  // slice of a trusted repo source file, not external/user input.
  return new Function(`return (${literal});`)();
}

describe('roleGroups cross-file parity (entity.js vs entity-explorer.js)', () => {
  const entitySource = fs.readFileSync(ENTITY_JS_PATH, 'utf8');
  const entityExplorerSource = fs.readFileSync(ENTITY_EXPLORER_JS_PATH, 'utf8');

  const entityRoleGroups = extractRoleGroups(entitySource, 'entity.js');
  const entityExplorerRoleGroups = extractRoleGroups(entityExplorerSource, 'entity-explorer.js');

  it('extracts a non-empty roleGroups array from both files', () => {
    // Guards against the bracket-matching extraction silently returning an
    // empty/degenerate array if either file's structure changes shape.
    expect(Array.isArray(entityRoleGroups)).toBe(true);
    expect(Array.isArray(entityExplorerRoleGroups)).toBe(true);
    expect(entityRoleGroups.length).toBeGreaterThan(0);
    expect(entityExplorerRoleGroups.length).toBeGreaterThan(0);
  });

  it('keeps the two roleGroups tables deep-equal, including group order', () => {
    expect(entityExplorerRoleGroups).toEqual(entityRoleGroups);
  });
});
