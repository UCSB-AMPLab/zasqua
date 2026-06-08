#!/usr/bin/env node
/**
 * Zasqua CLI
 *
 * This is the command-line entry point for the @ucsb-ampl/zasqua
 * engine. It exposes five commands — `build`, `dev`, `init`,
 * `validate`, and `import` — that wrap the build pipeline, setup helpers,
 * and data importers through the engine + instance directory structure.
 * The CLI is invoked from the instance directory; it reads the instance
 * root from `process.cwd()`, copies `themes/base` from the engine's
 * directory into the instance's `themes/` directory, then delegates to
 * `pipeline.js` or the appropriate `lib/` helper.
 *
 * Commands:
 *   zasqua build    — validate manifest, copy base theme, run the full pipeline
 *   zasqua dev      — copy base theme and start `hugo server`
 *   zasqua init     — scan data dir, scaffold a commented zasqua.manifest.toml
 *   zasqua validate — validate the manifest + data inputs standalone
 *   zasqua import   — convert a source dataset into the six-file contract
 *                     format; usage: zasqua import <format> <src>
 *                     [--out <dir>] [--standard <std>]
 *
 * Flags:
 *   --skip-validate  bypass the build-time manifest + input validation step
 *   --force          for `init`: overwrite an existing manifest
 *   --strict         for `validate`: enable full JSON Schema validation
 *                    (ajv draft-07, run after the key + type pre-pass)
 *   --out <dir>      for `import`: staging directory to write output into
 *                    (default: import-out/)
 *   --standard <std> for `import`: descriptive standard key passed to the
 *                    adapter (default: isadg)
 *
 * Env flags forwarded to build.sh:
 *   DEV_LIMIT      — integer cap on records in generate-content.js
 *
 * Single-pin mechanism:
 *   The CLI copies the engine's `themes/base` into the instance's
 *   `themes/base` before any Hugo invocation. The instance `hugo.toml`
 *   sets `theme = ["neogranadina", "base"]` so Hugo's component
 *   composition applies identity-specific overrides on top of the neutral
 *   base. No symlinks, no Hugo Modules, no Go required.
 *
 * Design constraint:
 *   The CLI contains no pipeline stage logic — it only dispatches to
 *   `lib/pipeline.js`, `lib/init.js`, `lib/validator.js`, and
 *   `lib/importers/dispatch.js`.
 *
 * @version v1.2.0
 */

'use strict';

const { runBuild, runDev } = require('../lib/pipeline');
const { runInit } = require('../lib/init');
const { runValidate } = require('../lib/validator');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const COMMAND = process.argv[2];

/**
 * Parse flag arguments from process.argv[3..].
 *
 * @returns {{ force: boolean, strict: boolean, skipValidate: boolean }}
 */
function parseFlags() {
  const flags = { force: false, strict: false, skipValidate: false };
  for (const arg of process.argv.slice(3)) {
    if (arg === '--force') flags.force = true;
    else if (arg === '--strict') flags.strict = true;
    else if (arg === '--skip-validate') flags.skipValidate = true;
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usage() {
  process.stderr.write(
    'Usage: zasqua <command> [flags]\n\n' +
    'Commands:\n' +
    '  build    Validate manifest, copy base theme, run the full 7-stage pipeline\n' +
    '  dev      Copy base theme and start hugo server (127.0.0.1:1313)\n' +
    '  init     Scan data dir and scaffold a commented zasqua.manifest.toml\n' +
    '  validate Validate manifest + data inputs (standalone)\n' +
    '  import   Convert a source dataset into the six-file contract format\n' +
    '           Usage: zasqua import <format> <src> [--out <dir>] [--standard <std>]\n' +
    '           Formats: csv, ead3, collectiveaccess, fisqua\n\n' +
    'Flags:\n' +
    '  --skip-validate  Skip the build-time manifest + input validation step\n' +
    '  --force          For init: overwrite an existing manifest\n' +
    '  --strict         For validate: enable full JSON Schema validation\n' +
    '  --out <dir>      For import: staging directory (default: import-out/)\n' +
    '  --standard <std> For import: descriptive standard key (default: isadg)\n'
  );
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async function main() {
  const flags = parseFlags();

  switch (COMMAND) {
    case 'build':
      await runBuild({ skipValidate: flags.skipValidate });
      break;

    case 'dev':
      await runDev();
      break;

    case 'init':
      runInit(process.cwd(), { force: flags.force });
      break;

    case 'validate': {
      const errors = runValidate({ instanceRoot: process.cwd(), strict: flags.strict });
      if (errors.length > 0) {
        errors.forEach(e => console.error('[validate]', e));
        process.exit(1);
      }
      console.log('[validate] All checks passed.');
      break;
    }

    case 'import': {
      const { runImport } = require('../lib/importers/dispatch');
      const format = process.argv[3];
      const src    = process.argv[4];
      if (!format || !src) { usage(); process.exit(1); }
      const outIdx     = process.argv.indexOf('--out');
      const stdIdx     = process.argv.indexOf('--standard');
      const stagingDir = outIdx !== -1 ? process.argv[outIdx + 1] : 'import-out';
      const standard   = stdIdx !== -1 ? process.argv[stdIdx + 1] : 'isadg';
      // runImport throws on unknown format or conformance failure.
      // Catch here to print a clean error message (no stack trace) and exit 1.
      try {
        await runImport({ format, src, stagingDir, standard, instanceRoot: process.cwd() });
      } catch (err) {
        process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
        process.exit(1);
      }
      break;
    }

    default:
      usage();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[zasqua] Fatal error:', (err && err.stack) || err);
    process.exit(1);
  });
}

module.exports = { main };

// Version: v1.2.0
