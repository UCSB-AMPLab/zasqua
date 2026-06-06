/**
 * Theme Utilities — Base Theme Copy
 *
 * Provides the single-pin theme installation mechanism for the Zasqua
 * engine. The `copyBaseTheme` function copies the engine's `themes/base`
 * directory into the instance's `themes/base`, enabling Hugo's theme
 * component composition (`theme = ["neogranadina", "base"]`) without
 * requiring symlinks or Hugo Modules.
 *
 * Why copy instead of symlink:
 *   Symlinks are unreliable on Windows (require elevated privileges or
 *   Developer Mode). Copying is universally portable and is the
 *   single-pin approach the engine relies on. The trade-off — engine
 *   source edits require a re-copy via `zasqua dev` or `zasqua build`
 *   to take effect in the instance — is a known and accepted limitation
 *   of copying the theme rather than linking it.
 *
 * Why the destination is removed before copying:
 *   A simple `cpSync` with `force: true` copies source files to the
 *   destination but leaves stale files in place when files are deleted
 *   from the engine source. An earlier version that did not remove the
 *   destination first left now-deleted per-section content adapters
 *   (entidades/ and lugares/_content.gotmpl) persisting in the instance
 *   across builds, producing spurious /entidades/entidades/ and
 *   /lugares/lugares/ pages.
 *   Removing the destination directory first ensures the instance always
 *   reflects the engine source exactly with no stale artefacts.
 *
 * Single-pin mechanism:
 *   Source:      {engineRoot}/themes/base/
 *   Destination: {instanceRoot}/themes/base/
 *   Hugo config: theme = ["neogranadina", "base"] in instance hugo.toml
 *   Hugo uses the last-in-list theme as the fallback base; neogranadina
 *   overrides specific layouts and CSS tokens; base supplies everything
 *   else identity-neutral.
 *
 * This module is required by lib/pipeline.js before any Hugo
 * invocation; it is not invoked directly.
 *
 * Inputs:
 *   engineRoot    — absolute path to the engine package directory
 *                   (i.e. the directory containing this file's parent)
 *   instanceRoot  — absolute path to the instance root (process.cwd()
 *                   when invoked via the CLI)
 *
 * Throws:
 *   Error if {engineRoot}/themes/base is absent — typically caused by
 *   a missing or incomplete `npm install`.
 *
 * Version: v1.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Copy the engine's themes/base directory into the instance's themes/base.
 *
 * Removes the destination before copying so that files deleted from the
 * engine source are never left as stale artefacts in the instance.
 *
 * @param {string} engineRoot   — absolute path to the engine package directory
 * @param {string} instanceRoot — absolute path to the instance root
 * @throws {Error} if the engine themes/base directory is not found
 */
function copyBaseTheme(engineRoot, instanceRoot) {
  const src = path.join(engineRoot, 'themes', 'base');
  const dest = path.join(instanceRoot, 'themes', 'base');

  if (!fs.existsSync(src)) {
    throw new Error(
      `engine themes/base not found at ${src} — was npm install run?`
    );
  }

  // Remove stale destination so deleted engine files never persist.
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

module.exports = { copyBaseTheme };

// Version: v1.1.0
