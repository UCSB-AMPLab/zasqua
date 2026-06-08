/**
 * Pipeline Wrappers — CLI-to-build.sh Bridge
 *
 * Provides the two pipeline entry points that the Zasqua CLI dispatches
 * to: `runBuild` and `runDev`. Each wrapper sets the correct
 * INSTANCE_ROOT / ENGINE_ROOT environment variables and spawns the
 * appropriate subprocess, streaming its stdio to the terminal.
 *
 * Design principle — wrap, don't rewrite:
 *   This module does NOT reimplement pipeline stage logic. It delegates
 *   to build.sh, which carries the authoritative 7-stage pipeline.
 *   Reimplementing stages here would risk parity regressions and is
 *   deliberately avoided.
 *
 * Commands:
 *
 *   runBuild(opts)
 *     Step 0 — validation: loads the manifest and runs `runValidate`
 *     before any other work. If validation fails, errors are printed with a
 *     `[validate]` prefix and the build is aborted. Pass `opts.skipValidate`
 *     to bypass this step (the `--skip-validate` CLI flag sets this).
 *     Step 0.5 — language config: derives Hugo language config from manifest
 *     [ui].language — base language (e.g. "es" from "es-CO") and full
 *     BCP-47 locale (e.g. "es-CO"). Injects HUGO_DEFAULTCONTENTLANGUAGE
 *     and HUGO_LANGUAGECODE as env vars so Hugo picks up the correct i18n
 *     bundle and renders <html lang="es-CO"> without mutating hugo.toml.
 *     Then copies engine themes/base into the instance (single-pin),
 *     then spawns bash build.sh with INSTANCE_ROOT=process.cwd() and
 *     ENGINE_ROOT pointing at the engine package. Forwards DEV_LIMIT from
 *     the caller's environment; build.sh honours it. Resolves when the
 *     child exits 0; rejects on nonzero.
 *
 *   runDev(opts)
 *     Copies engine themes/base into the instance (single-pin),
 *     then starts `hugo server --bind 127.0.0.1 --port 1313` from the
 *     instance root. Hugo is resolved from the instance's own
 *     node_modules/.bin so the instance controls its pinned version.
 *
 *     Known limitation: because base is copied (not symlinked), engine
 *     source edits to themes/base do not hot-reload. Re-run `zasqua dev`
 *     to pick up engine changes (a limitation of copying the theme rather
 *     than symlinking it).
 *
 * Env flags forwarded to build.sh:
 *   DEV_LIMIT      — integer cap on records in generate-content.js
 *   HUGO_DEFAULTCONTENTLANGUAGE — derived from manifest [ui].language base
 *   HUGO_LANGUAGECODE           — derived from manifest [ui].language full
 *
 * Version: v1.2.0
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { copyBaseTheme } = require('./theme');
const { loadManifest } = require('./manifest');
const { runValidate } = require('./validator');

// ---------------------------------------------------------------------------
// Internal helper — spawn a subprocess and resolve/reject on exit code
// ---------------------------------------------------------------------------

/**
 * Spawn a command with the given args, env, and cwd; stream stdio to the
 * terminal. Returns a Promise that resolves on exit 0, rejects otherwise.
 *
 * @param {string}   cmd  — command to execute
 * @param {string[]} args — arguments
 * @param {object}   opts — { cwd, env }
 * @returns {Promise<void>}
 */
function spawnAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Resolve roots — called at invocation time so cwd is the instance root
// ---------------------------------------------------------------------------

/**
 * Compute INSTANCE_ROOT (caller's cwd) and ENGINE_ROOT (parent of this
 * file's directory, i.e. the engine package root).
 */
function resolveRoots() {
  const INSTANCE_ROOT = process.cwd();
  const ENGINE_ROOT = path.join(__dirname, '..');
  return { INSTANCE_ROOT, ENGINE_ROOT };
}

// ---------------------------------------------------------------------------
// runBuild — copy base theme + full 7-stage pipeline
// ---------------------------------------------------------------------------

/**
 * Copy base theme then run the full build.sh pipeline.
 *
 * Step 0 — validation: runs `runValidate` before any build work unless
 * `opts.skipValidate` is set. If validation finds errors, each is printed
 * with a `[validate]` prefix and the build is aborted with a clear message.
 *
 * Forwards DEV_LIMIT from the environment; build.sh honours it.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.skipValidate] — bypass the validation step
 * @returns {Promise<void>}
 */
async function runBuild(opts = {}) {
  const { INSTANCE_ROOT, ENGINE_ROOT } = resolveRoots();
  const buildSh = path.join(ENGINE_ROOT, 'build.sh');

  // Always load the manifest — needed for language derivation even when
  // validation is skipped (e.g. --skip-validate flag).
  const manifest = loadManifest(INSTANCE_ROOT);

  // Step 0: validate manifest + inputs before any build work
  if (!opts.skipValidate) {
    const errors = runValidate({ manifest, instanceRoot: INSTANCE_ROOT, engineRoot: ENGINE_ROOT });
    if (errors.length > 0) {
      errors.forEach(e => console.error('[validate]', e));
      throw new Error('Validation failed — fix the above errors before building');
    }
  }

  // Step 0.5: derive Hugo language config from manifest [ui].language.
  // "es-CO" splits into baseLang="es" (i18n bundle key, selects es.toml) and
  // fullLocale="es-CO" (written to <html lang> by Hugo from languageCode).
  // Injected as HUGO_* env vars — Hugo reads these as config overrides without
  // mutating the committed hugo.toml (no git-dirty state, no [languages] block).
  const lang = (manifest.ui && manifest.ui.language) || 'en-US';
  const baseLang = lang.split('-')[0];   // "es-CO" → "es"
  const fullLocale = lang;               // "es-CO"

  copyBaseTheme(ENGINE_ROOT, INSTANCE_ROOT);

  // Prepend instance node_modules/.bin to PATH so that build.sh can find
  // hugo, pagefind, and other instance-pinned binaries without them being
  // installed globally. This is the standard engine convention used by
  // all local and CI builds.
  const instanceBin = path.join(INSTANCE_ROOT, 'node_modules', '.bin');
  const existingPath = process.env.PATH || '';
  const augmentedPath = `${instanceBin}${existingPath ? `:${existingPath}` : ''}`;

  const env = {
    ...process.env,
    PATH: augmentedPath,
    INSTANCE_ROOT,
    ENGINE_ROOT,
    HUGO_DEFAULTCONTENTLANGUAGE: baseLang,   // "es" → selects es.toml bundle
    HUGO_LANGUAGECODE: fullLocale,           // "es-CO" → <html lang="es-CO">
  };

  await spawnAsync('bash', [buildSh], { cwd: INSTANCE_ROOT, env });
}

// ---------------------------------------------------------------------------
// runDev — copy base theme + start hugo server
// ---------------------------------------------------------------------------

/**
 * Copy base theme then start `hugo server` from the instance root.
 *
 * Hugo is resolved from the instance's node_modules/.bin so the instance
 * controls the pinned version. Binds to 127.0.0.1:1313 by default.
 *
 * Note: engine source edits to themes/base require a re-run of `zasqua dev`
 * to take effect (a limitation of copying the theme rather than symlinking
 * it).
 *
 * @returns {Promise<void>}
 */
async function runDev() {
  const { INSTANCE_ROOT, ENGINE_ROOT } = resolveRoots();
  const hugoBin = path.join(INSTANCE_ROOT, 'node_modules', '.bin', 'hugo');

  copyBaseTheme(ENGINE_ROOT, INSTANCE_ROOT);

  const env = {
    ...process.env,
    INSTANCE_ROOT,
    ENGINE_ROOT,
  };

  await spawnAsync(hugoBin, ['server', '--bind', '127.0.0.1', '--port', '1313'], {
    cwd: INSTANCE_ROOT,
    env,
  });
}

module.exports = { runBuild, runDev };

// Version: v1.2.0
