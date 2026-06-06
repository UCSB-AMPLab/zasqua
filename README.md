# Zasqua Engine

The **Zasqua engine** is a deployment-agnostic system for publishing large
collections of digital archives as fast, fully static websites — no application
server, no database, no search backend, nothing running at request time. It
compiles a structured JSON dataset into the entire public site — faceted search,
hierarchical browsing, and deep-zoom IIIF image viewing — as plain files (HTML,
JSON, and static image tiles) that any static web platform can serve.

Most archival discovery platforms depend on servers, search engines, and
databases running at request time. The Zasqua engine draws instead on **minimal
computing**: building infrastructure that does not require expensive servers, runs
reliably under difficult conditions, and outlasts the projects and institutions
that funded it. What is novel is doing this **at scale**. Minimal-computing
approaches are usually assumed to break down on large corpora — yet the engine's
reference deployment, [zasqua.org](https://zasqua.org), serves over 106,000
archival descriptions and roughly 41 million deep-zoom image tiles, with full
faceted search, Miller-column hierarchy browsing, and high-resolution image
viewing, without a single server-side process. This is a deliberate application of
minimal computing principles at a scale where they are rarely applied.

The payoff is durability. Because the result is just files, a site built with the
engine can be archived, mirrored, copied to a thumb drive, or rebuilt from its
source exports with no dependency on any running service — and the data is never
locked into a platform. That matters most for the institutions the engine is built
for: collections in lower-resource environments where maintaining servers and
databases is not realistic over the long term.

---

## About

The Zasqua engine is developed by the **Archives, Memory, and Preservation Lab
(AMPL)**, a laboratory in the Center for Latin American and Iberian Research at UC
Santa Barbara, which develops tools and methods for a more egalitarian archiving
practice in Latin America and beyond. It is one of four open-source primitives AMPL
builds with its partners — a digitization toolkit that captures, Fisqua that
catalogs, Zasqua that publishes, and Telar that tells. Each can be used on its
own or as part of the full pipeline.

The name *Zasqua* is a word in the Muisca language meaning "to place oneself," "to
settle," "to remain in a given place" — the act of situating something where it
belongs. The engine carries this name because that is what it does: it places
digitized documentary collections in a stable, open-access space. Documents that
were scattered, hard to consult, or at risk of being lost find a place of their own.

---

## The Engine / Instance / Module Model

Zasqua is organized into three layers:

**Engine** (`@ampl/zasqua`) — the npm package. It provides the `zasqua`
command-line interface, the Hugo base theme, the build pipeline, validation, and
importer tooling. The engine is maintained by AMPL and versioned independently of
any deployment.

**Instance** — a directory that pins the engine and supplies a specific
collection's data, manifest, and optional theme overlay. An instance is a
`package.json` that declares `@ampl/zasqua` as a dependency, a `hugo.toml`, a
`zasqua.manifest.toml`, and an `exports/` directory containing the six-file data
contract. The quickest way to create one is to fork the starter repository,
[`UCSB-AMPLab/zasqua-template`](https://github.com/UCSB-AMPLab/zasqua-template),
which ships a working instance — engine pin, Hugo configuration, a Core-module
manifest, sample data, and a stub overlay theme — that you adapt to your own
collection.

**Module** — an optional capability toggled in `zasqua.manifest.toml`. Core
(descriptions + repositories) is always required. Every other capability is
optional and module-gated:

| Module | Flag | What it adds |
|--------|------|--------------|
| Hierarchy | `hierarchy = true` | Parent-child breadcrumb navigation and hierarchy pages |
| Entities | `entities = true` | Entity authority records and entity explorer |
| Entities graph | `entities_graph = true` | Bipartite co-occurrence graph on entity pages |
| Places | `places = true` | Geographic authority records and place explorer |
| Places map | `places_map = true` | Clustered marker map on the place explorer |
| IIIF viewer | `iiif = true` | Deep-zoom IIIF viewer on description pages |
| OCR full text | `ocr = true` | Full-text OCR content indexed for search |

Modules not listed in the manifest are disabled, and their pages, index bundles,
and UI controls are omitted from the build entirely.

---

## Requirements

- **Node.js 22 or later.** The engine pulls in Hugo Extended, Pagefind, and
  Tailwind as npm dependencies, so you do not need to install any build tool
  separately.

---

## Quickstart

**1. Fork the starter repository.** Forking
[`UCSB-AMPLab/zasqua-template`](https://github.com/UCSB-AMPLab/zasqua-template)
gives you a complete instance under your own account, with a visible link back to
the upstream starter:

```
gh repo fork UCSB-AMPLab/zasqua-template --clone --fork-name my-archive
cd my-archive
npm install
```

**2. Add your data to `exports/`.** Replace the sample dataset with your own
six-file contract, or import it from a source format (see
[`docs/guide.md`](docs/guide.md) and the importer references below).

**3. Generate the manifest for your data:**

```
zasqua init
```

`zasqua init` scans `exports/` and writes a commented `zasqua.manifest.toml`
enabling the modules your data supports. Review it and adjust before building.

**4. Validate and build:**

```
zasqua validate
SKIP_DOWNLOAD=1 zasqua build
```

The static site lands in `public/`. Serve it from any static host. For a complete
walkthrough — from install to a hosted, branded site — see
[`docs/guide.md`](docs/guide.md).

---

## Commands

| Command | What it does |
|---------|--------------|
| `zasqua build` | Validate the manifest and data, assemble the base theme, and run the full static-site pipeline into `public/` |
| `zasqua fetch` | Run the data-download stage only |
| `zasqua dev` | Assemble the theme and start a local Hugo preview server at `127.0.0.1:1313` |
| `zasqua init` | Scan `exports/` and scaffold a commented `zasqua.manifest.toml` |
| `zasqua validate` | Check the dataset against the contract (`--strict` adds full JSON Schema conformance) |
| `zasqua import <format> <src>` | Convert a source dataset (`csv`, `ead3`, `collectiveaccess`, `fisqua`) into the six-file contract |

---

## The Data Contract

The engine consumes a six-file JSON contract: `descriptions.json`,
`repositories.json`, `entities.json`, `entity_links.json`, `places.json`, and
`place_links.json`. The contract is versioned independently of the engine package
as **Zasqua data contract v1.0**. Any data source that produces conforming files —
whether from a Fisqua catalog, a CSV spreadsheet, an EAD3 finding aid, or a
CollectiveAccess export — can drive a build.

Validate conformance against the versioned JSON Schema files:

```
zasqua validate          # key + type pre-pass
zasqua validate --strict # full JSON Schema (draft-07) pass
```

For the complete field reference — every field, type, required/optional flag, and
description for all six files — see [`docs/data-contract.md`](docs/data-contract.md).
Per-format mapping references are available for
[CSV](docs/model-csv/data-dictionary.md),
[EAD3](docs/importers/ead3-mapping.md), and
[CollectiveAccess](docs/importers/collectiveaccess-mapping.md).

---

## zasqua.org as a Reference Deployment

[zasqua.org](https://zasqua.org) is an example instance, not the engine. It is the
digital archive of **Neogranadina**, a Colombian digital-humanities non-profit that
works to democratize access to historical knowledge. Built at AMPL as the successor
to Neogranadina's earlier
CollectiveAccess-based platform — the ABC (Archivo, Biblioteca, Catálogo) —
zasqua.org serves approximately 191,000 pages drawn from five repositories, four in
Colombia and one in Peru: the Archivo Histórico de Rionegro, the Archivo Histórico
del Juzgado del Circuito de Istmina, the Archivo Histórico Regional de Boyacá, the
Centro de Investigaciones Históricas José María Arboleda Llorente (Universidad del
Cauca), and the Biblioteca Nacional del Perú.

The Neogranadina instance runs the full module set (Core + Hierarchy + Entities +
Places + IIIF + OCR) with a custom `neogranadina` overlay theme on top of the
`base` theme. Its data is cataloged in Fisqua, exported to a Backblaze B2 bucket,
and the built site is hosted on Cloudflare R2 behind a Cloudflare Worker. This is
one valid deployment choice; the engine prescribes no hosting platform, storage
backend, or cataloging system.

---

## Standards, Language, and Theming

**Descriptive standards.** The engine ships built-in support for ISAD(G), DACS, and
RAD field labels and section headings, selectable per repository via
`zasqua.manifest.toml`. Vocabularies are defined as YAML data files under
`themes/base/data/standards/`, making it straightforward to add further standards
without engine changes.

**UI language.** The interface language is a single BCP-47 locale tag declared in
the manifest (`language = "en-US"` or `language = "es-CO"`). All three surfaces —
Hugo templates, `ui.yaml` data, and client JavaScript — derive locale from this
single source. The engine ships English and Colombian Spanish bundles; adding a new
language means adding an `i18n/` TOML file and a `themes/base/data/vocab/<lang>.yaml`
file.

**Theming.** The base theme provides a neutral, unstyled starting point. An instance
overlays its own visual identity by placing a second theme directory alongside
`themes/base/` and adding it to `hugo.toml`'s `theme` array:
`theme = ["my-theme", "base"]`. Hugo resolves templates from left to right, so the
overlay takes precedence on any template it defines.

---

## License, Governance, and Citation

The Zasqua engine is free software released under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

It is maintained by the
**[Archives, Memory, and Preservation Lab (AMPL)](https://ampl.clair.ucsb.edu)** at
the University of California, Santa Barbara. The authoritative repository is at
[UCSB-AMPLab/zasqua](https://github.com/UCSB-AMPLab/zasqua) on GitHub.

Contributions are welcome. Please open an issue or pull request against the
UCSB-AMPLab repository.

To cite Zasqua in academic work, use the metadata in [`CITATION.cff`](CITATION.cff)
or the GitHub "Cite this repository" button on the public repository page.

The names "Zasqua", "Fisqua", and "AMPL" are not covered by the AGPL license. The
AGPL covers the software source code only.
