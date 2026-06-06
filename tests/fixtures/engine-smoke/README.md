<!--
  engine-smoke fixture — Engine-Internal Build/Validate Smoke Test

  This directory is the engine's own minimal smoke-test fixture. It provides
  just enough data for `SKIP_DOWNLOAD=1 zasqua build` and `zasqua validate`
  to run as regression checks inside the engine repo's CI.

  It is NOT a deployer starter. The canonical onboarding workspace for
  third-party deployers is UCSB-AMPLab/zasqua-template.

  Contents:
    exports/descriptions.json  — two flat fonds records (no hierarchy, no IIIF, no OCR)
    exports/repositories.json  — one repository (co-smoke)
    zasqua.manifest.toml       — Core-only profile (all optional modules disabled)
    hugo.toml                  — minimal Hugo configuration for the smoke build

  Usage (from the engine root):
    cd tests/fixtures/engine-smoke
    SKIP_DOWNLOAD=1 ../../../bin/zasqua.js build
    SKIP_DOWNLOAD=1 ../../../bin/zasqua.js validate

  Version: v1.0.0
-->

# engine-smoke — Engine-Internal Smoke Fixture

This is the engine's own build/validate smoke-test fixture.

It contains a minimal Core-only dataset (two fonds descriptions, one
repository) sufficient to run `SKIP_DOWNLOAD=1 zasqua build` and
`zasqua validate` inside the engine's CI pipeline.

**This is not a deployer starter.** For a ready-to-use workspace that
pins the engine as a dependency and ships sample data, use
[`UCSB-AMPLab/zasqua-template`](https://github.com/UCSB-AMPLab/zasqua-template)
(fork it on GitHub).

<!-- Version: v1.0.0 -->
