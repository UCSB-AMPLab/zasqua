# Changelog

All notable changes to the Zasqua engine (`@ucsb-ampl/zasqua`) are documented in this
file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

This changelog covers the **engine** — the npm package that provides the `zasqua`
command-line interface, the base theme, the build pipeline, and the importer and
validation tooling. The engine is versioned independently of any deployment; the
release history of the zasqua.org reference archive lives with that instance, not
here.

## [1.2.0] — 2026-06-08

### Removed

- The `zasqua fetch` command and the engine's built-in data download.
  `zasqua build` now reads the six contract files from the local
  `exports/` directory and renders the site; the engine no longer fetches
  data or carries any storage backend. Through 1.1.x, `build.sh` hardcoded
  a Backblaze B2 download from a specific private bucket — it required
  Python and the B2 CLI and tied every deployment to one storage
  arrangement. Getting exports onto disk is now the deployer's step: a
  `zasqua import` run, a copy from a cataloging system, or a fetch step in
  a deployment's own pipeline, run before `zasqua build`.

### Changed

- `zasqua build` fails fast with a clear message when the core contract
  files (`descriptions.json`, `repositories.json`) are absent from
  `exports/`, instead of attempting a download. The `SKIP_DOWNLOAD`
  environment variable is no longer needed and is ignored.

The six-file data contract (v1.0) is unchanged. A site built with 1.1.x
rebuilds identically once its data is on disk; deployments that relied on
the built-in B2 download must add their own data-fetch step before
`zasqua build`.

## [1.1.0] — 2026-06-08

### Added

- ISAD(G) Description Control Area (3.7). Descriptions may now carry an
  archivist's note (3.7.1 — how the description was prepared and by whom),
  the rules or conventions followed (3.7.2), and an explicit date of
  description (3.7.3); all three render in the Control section of a
  description page, with the date of description taking precedence over the
  build-derived last-modified date when present.
- A `local_identifier` field (ISAD(G) 3.1.1 / DACS 2.1) for an archive's
  own reference code. It preserves the original code — which may contain
  spaces or punctuation — when the primary `reference_code` is a slugified
  form, and renders in the identity area. The DACS and RAD descriptive
  profiles label it with their own terms ("local identifier" and "reference
  number" respectively).

All four fields are optional and additive: existing instances and data are
unaffected, and an instance that supplies none of them renders exactly as
before.

## [1.0.2] — 2026-06-07

### Added

- A `{{< engine-version >}}` shortcode that reports the engine version a
  site was built with. `zasqua build` stamps the engine's version into
  `themes/base/data/engine.yaml`, so a deployment can show which engine
  produced it — for example in a colophon — independently of its own
  version.

### Changed

- The framework-credit line in the footer now carries an explicit "Source
  code" link to the engine's repository. The AGPL-3.0 license obliges every
  deployment to offer the running program's source to its users, so the
  link states that plainly instead of being carried by the word
  "open-source."

## [1.0.1] — 2026-06-07

### Fixed

- Restored the favicon `<link>` in the base template's `<head>`, which was
  inadvertently dropped during the engine extraction. Deployments that place an
  icon at `static/img/favicon.png` now have it referenced again.

## [1.0.0] — 2026-06-07

First public release of the Zasqua engine.

The Zasqua engine began as the codebase behind [zasqua.org](https://zasqua.org),
the digital archive built by AMPL for the Colombian non-profit Neogranadina. That site was built
on minimal computing principles: the entire public archive is pre-rendered as
static files, with client-side search and static IIIF image tiles, so it runs with
no application server, no database, and no search backend at request time. It
demonstrated that minimal computing holds up at a scale where it is rarely
attempted — over 106,000 archival descriptions and roughly 41 million deep-zoom
image tiles, fully searchable and browsable, served as nothing but files.

Version 1.0.0 extracts that codebase into a standalone engine that any institution
can run against its own data. Being deployment-agnostic is the point of the
release. The engine takes a documented six-file data contract as input, so it is
tied to no particular cataloging system: a Fisqua catalog, a CSV spreadsheet, an
EAD3 finding aid, and a CollectiveAccess export are all first-class sources. It
emits plain static files, so it is tied to no particular hosting platform or
storage backend. And every capability beyond the core is optional and
manifest-gated, so a deployer turns on only what their data supports. What was a
single site is now a tool other archives can adopt.

This durability is the reason the engine exists. Because a built site is just files
— HTML, JSON, static image tiles — it can be archived, mirrored, copied wholesale,
or rebuilt from its source exports with no dependency on any running service, and
the data is never locked into a platform. That matters most for the institutions
the engine is built for: collections in lower-resource environments, where
maintaining servers and databases is not realistic over the long term, and where
the infrastructure needs to outlast the projects and grants that funded it.

### Added

- **`zasqua` command-line interface** with six commands: `build` (validate,
  assemble the theme, and run the full static-site pipeline), `fetch` (download
  source data only), `dev` (start a local Hugo preview server), `init` (scan a
  dataset and scaffold a commented manifest), `validate` (check a dataset against
  the data contract), and `import` (convert a source dataset into the contract).
- **Capability-module system.** A `zasqua.manifest.toml` at the instance root
  declares which features are active. Core (descriptions and repositories) is
  always present; hierarchy, entities, the entity co-occurrence graph, places, the
  place map, the IIIF viewer, and OCR full-text search are each optional and gated
  independently. Disabled modules contribute no pages, index bundles, or interface
  controls to the build.
- **Six-file JSON data contract (v1.0)** — `descriptions`, `repositories`,
  `entities`, `entity_links`, `places`, and `place_links` — with published JSON
  Schema (draft-07) definitions. `zasqua validate` runs a fast key-and-type
  pre-pass; `zasqua validate --strict` adds full schema conformance.
- **Importer suite.** Adapters convert four source formats into the contract: CSV
  spreadsheets, EAD3 finding aids (tested against ArchivesSpace and AtoM exports),
  CollectiveAccess exports, and Fisqua catalog output. Every adapter sanitizes
  untrusted markup at import time, and the importers publish links without minting
  authority records of their own.
- **Per-repository descriptive standards.** Field labels and section headings for
  ISAD(G), DACS, and RAD ship as data files and are selectable per repository, so
  one site can present collections cataloged to different standards. Adding a
  further standard is a data change, not an engine change.
- **Single configurable interface language.** The UI language is one BCP-47 locale
  declared in the manifest. English (`en-US`) and Colombian Spanish (`es-CO`)
  bundles ship; templates, data files, and client JavaScript all derive their
  locale from that single source.
- **Neutral base theme** on Hugo Extended, with client-side Pagefind search across
  three corpus-isolated indices (descriptions, entities, places), a self-hosted
  TIFY deep-zoom IIIF viewer, MapLibre place maps, and an entity co-occurrence
  graph. An instance applies its own visual identity by layering a second theme
  over the base.
- **Build pipeline** that enriches the raw contract data (date formatting, ancestor
  breadcrumb chains, entity and place link resolution, derived hierarchy),
  generates pages through Hugo content adapters with no intermediate stub files, and
  builds the search indices with pivot and triple sidecars so faceted counts resolve
  on the first click.
- **Documentation:** a deployment guide (`docs/guide.md`), the full data-contract
  field reference (`docs/data-contract.md`), and per-format importer mapping
  references for CSV, EAD3, and CollectiveAccess.

[1.2.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.2.0
[1.1.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.1.0
[1.0.2]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.2
[1.0.1]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.1
[1.0.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.0
