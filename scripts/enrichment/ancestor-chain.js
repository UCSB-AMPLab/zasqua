/**
 * Ancestor Chain Builder
 *
 * This module deals with walking the archival hierarchy upwards. A
 * description like `co-ahr-0001-item-042` sits at the bottom of a chain —
 * item inside a file inside a series inside a fonds. To render a
 * breadcrumb the frontend needs the full chain, oldest to youngest. The
 * loader used to do this walk on every page render; this module does it
 * once at build time and bakes the chain onto each description record so
 * Hugo templates stay dumb iterators.
 *
 * `buildAncestorChain` takes the current description plus a `byRefCode`
 * Map built from the full descriptions array and walks `parent_reference_
 * code` pointers upwards. The returned array is oldest-ancestor-first —
 * ready to drop into a breadcrumb UI.
 *
 * A cycle in the parent pointers is a backend data bug, not a frontend
 * tolerance concern. The walker therefore hard-caps at 20 hops and
 * throws — the build should break loudly so the cycle gets fixed
 * upstream. 20 is a comfortable ceiling;
 * real archival hierarchies rarely exceed 6 levels.
 *
 * @version v1.0.0
 */

'use strict';

const MAX_DEPTH = 20;

function buildAncestorChain(desc, byRefCode) {
  const chain = [];
  let current = desc;
  let depth = 0;
  while (current && current.parent_reference_code) {
    if (depth >= MAX_DEPTH) {
      throw new Error(`ancestor cycle detected at ${desc.reference_code} (walked ${MAX_DEPTH} hops)`);
    }
    const parent = byRefCode.get(current.parent_reference_code);
    if (!parent) break;
    chain.unshift({
      reference_code: parent.reference_code,
      title: parent.title,
      description_level: parent.description_level,
    });
    current = parent;
    depth++;
  }
  return chain;
}

module.exports = { buildAncestorChain };
