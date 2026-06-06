/**
 * Vitest Configuration — Zasqua Engine Package
 *
 * Configures Vitest for the engine package of the Zasqua archive platform.
 * The engine packages pure JavaScript helpers (enrichment scripts, Pagefind
 * facet-count logic, themes) that do not depend on a build pipeline or data
 * download. Tests here run fast in CI on the engine package alone — no B2
 * pull, no Hugo build, no `exports/` directory required.
 *
 * Tests live under `engine/tests/` and import directly from the engine's
 * source tree (`scripts/enrichment/`, `themes/base/static/js/`). They are
 * designed to be run from the engine root with `npm test` or `vitest run`.
 *
 * `process.cwd()` resolves to the engine root when invoked from this
 * directory, which is the expected call path.
 *
 * @version v2.0.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    testTimeout: 10000,
  },
});
