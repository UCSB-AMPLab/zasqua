<!--
  Run Your Own Instance — Zasqua Deployment Guide

  This guide walks through every step required to stand up a Zasqua
  archival discovery site from scratch: install the engine, configure
  your instance manifest, prepare or import your data, validate
  conformance, build the static site, host it, and brand it with your
  own identity. It is written for repository managers, archivists, and
  developers who want to deploy Zasqua against their own archival
  collection.

  The guide is linear. Follow the numbered legs in order; each step
  produces verified output that the next step consumes.

  Version: v0.3.0
-->

# Run Your Own Instance

This guide walks through every step required to deploy Zasqua against
your own archival collection. Start here if you are standing up a new
instance for the first time.

---

## 1. Prerequisites

You need Node.js 22 or later. Check your version:

```
node --version
```

If you do not have Node.js 22, install it from [nodejs.org](https://nodejs.org/)
or through a version manager such as `nvm`:

```
nvm install 22 && nvm use 22
```

You do not need to install Hugo or any other build tool directly —
the engine pulls them in as npm dependencies.

---

## 2. Fork the Starter Repository

Fork the `zasqua-template` repository on GitHub (use the **Fork** button,
or `gh repo fork` below) to create your instance workspace under your own
account or organization. Forking keeps a visible link back to the upstream
starter. Your fork gives you a `package.json` that declares the engine as a
dependency, a `hugo.toml` with the required Hugo configuration, a
`zasqua.manifest.toml` pre-scaffolded for the Core module, sample data in
`exports/`, and a stub overlay theme.

```
gh repo fork UCSB-AMPLab/zasqua-template --clone --fork-name my-archive
cd my-archive
npm install
```

`npm install` pulls `@ampl/zasqua` and its toolchain from the npm registry.
The engine binary is then available as `zasqua` via `npx` or directly from
`node_modules/.bin/`.

You receive engine updates by bumping the `@ampl/zasqua` version in your
`package.json` and reinstalling — not by syncing the fork. The fork holds
only your instance's configuration, data, and theme; the engine is a
versioned npm dependency you upgrade on your own schedule.

---

## 3. Configure the Manifest

Open `zasqua.manifest.toml`. This file is the control panel for your
instance. It specifies the UI language and which optional modules are
enabled.

```toml
[ui]
language = "en-US"

[modules]
hierarchy = true
entities = false
entities_graph = false
places = false
places_map = false
iiif = false
ocr = false
```

**Core** (descriptions + repositories) is always required and needs no
manifest flag. Every optional module must be explicitly enabled:

| Module | Flag | What it adds |
|--------|------|--------------|
| Hierarchy | `hierarchy = true` | Parent-child breadcrumb navigation and hierarchy pages |
| Entities | `entities = true` | Entity authority records and the entity explorer (`/entidades/`) |
| Entities graph | `entities_graph = true` | Bipartite co-occurrence graph on entity detail pages |
| Places | `places = true` | Geographic authority records and the place explorer (`/lugares/`) |
| Places map | `places_map = true` | Clustered marker map on the place explorer |
| IIIF viewer | `iiif = true` | Deep-zoom IIIF viewer on description pages |
| OCR full text | `ocr = true` | Full-text OCR content indexed for search |

Run `zasqua validate` after editing the manifest to confirm the file is
well-formed and that your data files match the modules you have enabled.

---

## 4. Prepare Your Data

Zasqua consumes a six-file JSON contract: `descriptions.json`,
`repositories.json`, `entities.json`, `entity_links.json`, `places.json`,
`place_links.json`. All six files must exist in the `exports/` directory
of your instance, even if some are empty arrays.

You have two paths depending on where your data comes from.

### Path A: You already emit the contract shape

If your cataloguing system already produces the six-file contract
(for example, Fisqua emits it directly via `zasqua import fisqua ...`),
place the JSON files in `exports/` and proceed to the Validate step.

### Path B: You have data in a foreign format

Run the appropriate importer to convert your data to the contract shape.
The model-CSV importer is the recommended starting point for archivists
who manage data in spreadsheets:

```
zasqua import csv <path-to-csv-directory> --out exports/
```

This reads your CSV sheets and writes the six contract files into
`exports/`. For a full description of the model-CSV column format, the
required fields, and the controlled vocabularies, see
[`docs/model-csv/data-dictionary.md`](model-csv/data-dictionary.md).

Other importers available in the current release:

| Command | Source format |
|---------|---------------|
| `zasqua import csv <dir>` | Model-CSV spreadsheets |
| `zasqua import ead3 <file>` | EAD3 finding-aid XML |
| `zasqua import ca <dir>` | CollectiveAccess JSON export |
| `zasqua import fisqua <dir>` | Fisqua cataloguing system passthrough |

The `zasqua-template` repository ships a sample dataset in `exports/` —
a five-description slice of the public `co-ahrb-aht` fonds (Archivo
Histórico Regional de Boyacá, Legajo 009, 1573–1574) — to demonstrate
a working Core + Hierarchy build out of the box.

---

## 5. Validate

Before building, validate your data to confirm it conforms to the contract:

```
zasqua validate
```

This runs the key-and-type pre-pass: it checks that all required fields
are present in every record and that the i18n bundle for your declared
language is complete. It does NOT resolve cross-file references — cross-file
referential integrity (for example, that every `repository_code` in
`descriptions.json` exists in `repositories.json`) is the curator's
responsibility upstream, handled before data reaches Zasqua.

For full JSON Schema conformance against the versioned contract schemas,
add `--strict`:

```
zasqua validate --strict
```

The `--strict` pass validates each export file against the corresponding
`schemas/*.schema.json` via ajv (draft-07). A passing run prints one
`validate schema=<file> status=pass` line per schema file. Any violation
causes a non-zero exit with a `status=fail` line identifying the failing
field and path.

For the complete field reference — every field in every contract file,
with its type, required/optional status, and description — see
[`docs/data-contract.md`](data-contract.md).

---

## 6. Build

Build the static site with:

```
zasqua build
```

If your `exports/` data is already local (for example, you ran
`zasqua import` or copied the sample `exports/` files from the template),
skip the remote data download step:

```
SKIP_DOWNLOAD=1 zasqua build
```

The build runs seven stages in order:

1. **Fetch** — downloads export files from your configured remote storage
   (skipped with `SKIP_DOWNLOAD=1`)
2. **Derive children** — computes `children/` hierarchy shards from
   `descriptions.json`
3. **Install** — runs `npm ci` inside the instance directory
4. **Generate content** — enriches the raw JSON into Hugo-ready data files
5. **Populate static data** — copies runtime shards into `static/data/`
6. **Hugo** — renders all pages; output lands in `public/`
7. **Pagefind** — builds the search index over the rendered HTML

A successful run prints:

```
=== Build complete ===
Pages: <N>   Site size: <size>
```

The sample dataset shipped in the `zasqua-template` repository produces
27 Hugo pages in your `public/` directory, including hierarchy pages at
`/co-ahrb-aht-009/`, `/co-ahrb-aht-009-d001/`, and so on.

---

## 7. Host

The build output is a standard static site in `public/`. Any static host
works: Netlify, Vercel, GitHub Pages, Cloudflare Pages, or a plain web
server.

### Serving locally

```
cd public && npx serve .
```

### Cloudflare Pages / R2

zasqua.org, the reference deployment, uses Cloudflare R2 for storage and
a Cloudflare Worker for serving. This is not a requirement — it is one
example of a hosting arrangement. The engine's `worker/` directory
contains the reference Worker and `scripts/upload-to-r2.py` contains the
diff-upload script for R2.

For a simpler setup, Cloudflare Pages accepts a static output directory
directly from a GitHub Actions build job.

### Notes

- All pages are static HTML with no runtime server dependency.
- Pagefind search runs entirely in the browser from the pre-built index
  in `public/pagefind/`.
- If you enable the places map module (`places_map = true`), the map
  tiles are served from a separate PMTiles source configured in
  `zasqua.manifest.toml`.

---

## 8. Identity and Theming

A freshly built instance uses the engine's neutral base theme — functional
but unstyled with any institutional identity. This section covers the four
steps to give your site a branded look: setting identity strings in
`hugo.toml`, overriding the colour and font palette in `tokens.css`,
authoring the colophon page, and optionally overriding base layout
templates.

### Identity strings in hugo.toml

Open `hugo.toml` in your instance directory. The `[params]` block holds
the identity strings that appear across the site — in the header, footer,
and entity/place explorer labels:

```toml
[params]
logo            = "My Archive"          # site name shown in the header
about_url       = "https://example.org/about"
catalog_url     = "https://catalog.example.org"
footer_copyright = "© 2026 My Institution"
footer_credits  = "Powered by Zasqua"
source_url      = "https://github.com/my-org/my-archive"
entity_code_label = "Person / Organisation"
place_code_label  = "Place"
```

`entity_code_label` and `place_code_label` control the labels shown on
authority record explorer pages; set them to the terminology your
institution uses (`Agent`, `Creator`, `Locality`, or similar).

### Colour and font palette (tokens.css)

Your stub overlay theme ships a `tokens.css` file at
`themes/my-theme/assets/css/tokens.css`. This is where you redefine the
engine's design tokens — colours, font stacks, and spacing variables —
using a Tailwind v4 `@theme` block:

```css
@theme {
  --color-burgundy:       #8B2942;
  --color-burgundy-deep:  #6B1F33;
  --color-burgundy-light: #B14D66;
  --color-burgundy-dark:  #4A1522;
  --color-pale-rose:      #F5E6EA;
  --color-ochre:          #C5965F;
  --color-sage:           #8A9B8E;
  --color-periwinkle:     #C9D5FF;
  --color-bg:             #FAFAF9;

  --font-sans:    "DM Sans", ui-sans-serif, system-ui, sans-serif;
  --font-serif:   "Crimson Text", ui-serif, Georgia, serif;
  --font-display: "Cormorant Garamond", ui-serif, Georgia, serif;
}
```

The block above is the Neogranadina palette from the reference deployment;
replace each value with your own brand colours and fonts. The engine base
theme defines placeholder tokens with the same names; Tailwind v4 merges
`@theme` blocks and the last-declared value wins, so your overlay takes
precedence automatically.

For a hero image, add a `static/img/hero.jpg` file to your theme
directory. If no hero image is present, the base theme renders the hero
area in the `--color-burgundy-dark` tone.

### Colophon

The colophon page (`/colofon/` by default) is the institutional
statement that accompanies an archival publication — rights, provenance,
licensing, funding acknowledgments. Author it as a standard Markdown file
at `content/colofon/_index.md` in your instance:

```markdown
---
title: "Colofón"
---

Describe the collection, its origins, the institution responsible, and
the terms under which it is made available.
```

The base theme renders this page from the `colofon/list.html` template
(see Overridable templates below).

### Overridable base templates

Five base layout templates are designed to be overridden at the instance
level. To override any of them, recreate the same path under
`themes/my-theme/layouts/` in your instance directory. Hugo's theme
composition (`theme = ["my-theme", "base"]`) gives your overlay priority
over the base:

| Template path | What it renders |
|---------------|-----------------|
| `layouts/index.html` | Homepage |
| `layouts/_partials/header.html` | Site header (navigation, logo) |
| `layouts/_partials/footer.html` | Site footer (copyright, credits, framework credit) |
| `layouts/repository/single.html` | Individual repository landing page |
| `layouts/colofon/list.html` | Colophon page |

Copy the base version of the template you want to change into your
overlay path, then edit it. Your copy takes precedence; all other
templates continue to resolve from the base theme.
