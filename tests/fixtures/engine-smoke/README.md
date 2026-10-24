<!--
  engine-smoke fixture — Engine-Internal Build/Validate Smoke Test

  This directory is the engine's own minimal smoke-test fixture. It provides
  just enough data for `zasqua build` and `zasqua validate` to run as
  regression checks inside the engine repo's CI.

  It is NOT a deployer starter. The canonical onboarding workspace for
  third-party deployers is UCSB-AMPLab/zasqua-template.

  Contents:
    exports/descriptions.json  — two flat fonds records (no hierarchy, no IIIF, no OCR)
    exports/repositories.json  — one repository (co-smoke)
    exports/entities.json      — three entities (a person, a corporate body, a
                                 family) for the `zasqua eac` smoke test; the
                                 manifest keeps entities disabled, so the
                                 site build does not read them
    exports/places.json        — three places (a city, a river, an "other"
                                 place) for the `zasqua places` smoke test
    exports/place_links.json   — links from two of those places to the two
                                 descriptions, which date their records; the
                                 manifest keeps places disabled, so the site
                                 build does not read either file
    zasqua.manifest.toml       — Core-only profile (all optional modules disabled)
    hugo.toml                  — minimal Hugo configuration for the smoke build

  Usage (from the engine root):
    cd tests/fixtures/engine-smoke
    ../../../bin/zasqua.js build
    ../../../bin/zasqua.js validate
    ../../../bin/zasqua.js eac
    ../../../bin/zasqua.js places

  Version: v1.5.0
-->

# engine-smoke — Engine-Internal Smoke Fixture

This is the engine's own build/validate smoke-test fixture.

It contains a minimal Core-only dataset (two fonds descriptions, one
repository) sufficient to run `zasqua build` and `zasqua validate`
inside the engine's CI pipeline, plus three entities that the
`zasqua eac` smoke test reads and three places, with their links to the
descriptions, that the `zasqua places` smoke test reads.

**This is not a deployer starter.** For a ready-to-use workspace that
pins the engine as a dependency and ships sample data, use
[`UCSB-AMPLab/zasqua-template`](https://github.com/UCSB-AMPLab/zasqua-template)
(fork it on GitHub).

<!-- Version: v1.5.0 -->
