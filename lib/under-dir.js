/**
 * Directory Containment — Whether One Path Lies Inside Another
 *
 * The EAC-CPF and Linked Places generators warn when their output directory
 * lies inside the instance's rendered site tree (public/) while their base
 * URL names another host, since the files would then be served with the
 * site. That check needs a containment test that a plain string prefix gets
 * wrong: "public-staging" starts with "public", and a child directory named
 * "..x" starts with "..". Both paths are resolved, and the relative path
 * from parent to child is inside when it is empty (the same directory), or
 * is neither "..", nor starts with ".." followed by a separator, nor is
 * absolute (a different drive on Windows).
 *
 * Public API:
 *
 *   isUnderDir(child, parent)
 *     Returns true when child is parent itself or lies inside it.
 *
 * @version v1.5.0
 */

'use strict';

const path = require('path');

/**
 * @param {string} child — the path to test
 * @param {string} parent — the directory it may lie in
 * @returns {boolean}
 */
function isUnderDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

module.exports = { isUnderDir };

// Version: v1.5.0
