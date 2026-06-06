# Changelog

All notable changes to the Zasqua engine (`@ampl/zasqua`) are documented in this
file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

This changelog covers the **engine** — the npm package that provides the `zasqua`
command-line interface, the base theme, the build pipeline, and the importer and
validation tooling. The engine is versioned independently of any deployment; the
release history of the zasqua.org reference archive lives with that instance, not
here.

## [1.0.0] — Unreleased

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

[1.0.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.0
