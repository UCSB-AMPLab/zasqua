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

  Version: v1.6.0
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
`zasqua.manifest.toml` pre-scaffolded for Core plus the Hierarchy, Entities,
and Places modules, and a bilingual sample dataset in `exports/`. It ships no
overlay theme: a fresh fork builds a fully functional, localized site on the
engine's neutral base theme alone. Branding with your own colours, fonts, and
layout overrides is an overlay theme you add later (see Section 8).

```
gh repo fork UCSB-AMPLab/zasqua-template --clone --fork-name my-archive
cd my-archive
npm install
```

`npm install` pulls `@ucsb-ampl/zasqua` and its toolchain from the npm registry.
The engine binary is then available as `zasqua` via `npx` or directly from
`node_modules/.bin/`.

You receive engine updates by bumping the `@ucsb-ampl/zasqua` version in your
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

`language` is a BCP 47 tag (`en-US`, `es-CO`) and is the site's only
language setting. The build passes it to Hugo, which picks the matching
i18n bundle and writes it to `<html lang>`. The build also writes dates
("March 15, 1723", "15 de marzo de 1723") and counts ("1,000", "1.000")
in that language, and builds the search indexes with its base subtag
(`en`, `es`), so search stems words by that language's rules. Browser
scripts read the language from `<html lang>`. Leave the `languageCode`
and `defaultContentLanguage` in `hugo.toml` alone; the build overrides
them from the manifest. Without a `language`, the site is in `en-US`.

The place page names a place's country from its ISO 3166-1 alpha-3
code, using `themes/base/data/countries.yaml` (every assigned code, in
English and Spanish). To change a name, add a `place.countries.<CODE>`
key to your i18n bundle; it takes precedence over the data file.

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
| `zasqua import collectiveaccess <file>` | CollectiveAccess web-services JSON file |
| `zasqua import fisqua <dir>` | Fisqua cataloguing system passthrough |

Every importer takes `--out <dir>` (staging directory, default
`import-out/`) and `--standard <std>` (descriptive standard, default
`isadg`). The CollectiveAccess importer also takes `--entity-prefix` and
`--place-prefix` (see `docs/importers/collectiveaccess-mapping.md`).

**HTML sanitisation.** The CSV, EAD3 and CollectiveAccess importers strip
HTML from text fields; the Fisqua importer copies the files as they are.
Two flags override the default for any format: `--trusted` skips
sanitisation, and `--sanitize` applies it (programmatically, the `trusted`
option). Use `--sanitize` on a Fisqua export that did not come from a
source you control, and `--trusted` on a spreadsheet whose markup you want
kept.

The `zasqua-template` repository ships a small bilingual sample dataset
in `exports/` to demonstrate a working Core + Hierarchy + Entities +
Places build out of the box. It holds two multilevel fonds drawn from
the published worked examples in the ISAD(G) standard, reproduced with
acknowledgement (see the template's `NOTICE` file): an English-language
Department of Railways and Canals fonds (records held by Library and
Archives Canada, `ca-lac-r610`) and a Spanish-language Consejo Real de
España e Indias fonds (records held by the Archivo General de Simancas,
`es-ags-crei`). Replace `exports/` with your own data before publishing.

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

`zasqua build` reads the six contract files from your local `exports/`
directory and renders the static site into `public/`. The engine does not
fetch data on its own and is tied to no storage backend — getting your
exports onto disk (a `zasqua import` run, a copy from your cataloging
system, or a fetch step in your own deployment pipeline) is a step you run
beforehand. If the core files are missing, the build stops with a clear
message rather than producing an empty site.

The build runs seven stages in order:

1. **Precompute links** — builds the entity and place link shards
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
31 Hugo pages in your `public/` directory, including the two fonds at
`/ca-lac-r610/` and `/es-ags-crei/` and their nested hierarchy pages
(`/ca-lac-r610-134/`, `/es-ags-crei-hacienda/`, and so on).

### METS documents (`zasqua mets`)

METS generation is a separate command, not a build stage — it reads
`exports/` and `hugo.toml` directly (not the rendered site), so it can run on
its own and target its own host:

```
zasqua mets
```

This writes one METS 1.12.1 XML document per description (Dublin Core
descriptive metadata) to `METS_DIR`, which defaults to `public/mets/` — so a
single-bucket deployment runs `zasqua build` then `zasqua mets` and serves both
together at `/mets/{reference_code}.xml`. A deployment that hosts METS on a
separate domain sets `METS_DIR` to a staging directory outside `public/` and
points the reuse-section link at it with `mets_base_url`. METS configuration
lives in `hugo.toml [params]`:

- `mets_creator_name` / `mets_creator_url` — the METS CREATOR agent (default:
  the site `title`, and `about_url`/`source_url`).
- `mets_default_rights` — optional `dc:rights` fallback for records with no
  per-record or per-repository rights.
- `mets_base_url` — the public URL base for the reuse-section METS link
  (default: `/mets`, served with the site).

`dc:rights` is data-driven: a repository's `image_reproduction_text` for a
digitised item, else the record's own reproduction/access conditions, else the
optional house default, else omitted. IIIF manifests, when a record supplies
`iiif_manifest_url`, are referenced from `<fileSec>` — the engine never
generates IIIF.

### EAC-CPF records (`zasqua eac`)

EAC-CPF generation is also a separate command, not a build stage. It reads
`exports/entities.json` and `hugo.toml` directly, so it can run on its own and
target its own host:

```
zasqua eac
```

This writes one EAC-CPF 2010 XML record per entity (person, corporate body or
family) to `EAC_DIR`, which defaults to `public/eac/`, so a single-bucket
deployment runs `zasqua build` then `zasqua eac` and serves the records with the
site at `/eac/{entity_code}.xml`. A deployment that hosts the records on a
separate domain sets `EAC_DIR` to a staging directory outside `public/` and
uploads it there. EAC-CPF configuration lives in `hugo.toml [params]`:

- `eac_agency_name` — the maintenance agency named in each record (default: the
  site `title`, else `Zasqua`).
- `eac_agency_code` — optional agency code, such as an ISIL; omitted when unset.
- `eac_language_code` — optional ISO 639-2 code for the language of the
  records (e.g. `spa`), declared with Latin script; omitted when unset.
- `eac_base_url` — the public URL base the records are served from; when it is
  an absolute URL and `EAC_DIR` resolves under `public/`, `zasqua eac` warns
  that the files would be served with the site instead.

An `eac_agency_code` that is not an ISIL code, or an `eac_language_code` that
is not a three-letter lowercase code, is ignored with a warning, and the
records are written without it.

Only populated elements are emitted: names and name variants, dates of
existence, functions, history, and VIAF and Wikidata links each appear when
the entity carries them. The output carries no timestamps, so an unchanged
export produces byte-identical files. A record that breaks the entity contract
(no `entity_code`, an unknown `entity_type`), or whose filename an earlier
record has already taken, is skipped with a warning naming it, and the run
continues. So is a record whose `entity_code` is not an XML name token
(letters, digits, `.`, `_`, `:` and `-` only), since EAC-CPF uses the code as
the record identifier.

### Linked Places records (`zasqua places`)

Linked Places generation is also a separate command, not a build stage. It
reads `exports/places.json`, `exports/place_links.json`,
`exports/descriptions.json` and `hugo.toml` directly, so it can run on its own
and target its own host:

```
zasqua places
```

This writes one Linked Places Format (LPF) file per place to `PLACES_DIR`,
which defaults to `public/places/`: each place as its own collection at
`{place_code}.json`, and every place that carries a `when` together in
`index.json`. `index.json` is the LPF-conformant corpus, the file to upload to
the World Historical Gazetteer (WHG) or another gazetteer that ingests LPF in
bulk. LPF requires a record-level `when` or a citation year on a name, and a
place no dated description mentions has neither: its file is written, so the
link on its page resolves, but it is not a conformant record and is left out
of `index.json`. A single-bucket deployment runs `zasqua build` then
`zasqua places` and serves the records with the site at
`/places/{place_code}.json`. A deployment that hosts the records on a separate
domain sets `PLACES_DIR` to a staging directory outside `public/` and uploads
it there. Linked Places configuration lives in `hugo.toml`:

- `places_language` (in `[params]`) — the language tag declared on each
  place name (e.g. `es`); omitted when unset. The site's
  `defaultContentLanguage` is not used, since the language of the interface
  says nothing about the language of the place names.
- `places_base_url` (in `[params]`) — the public URL base the records are
  served from; when it is an absolute URL and `PLACES_DIR` resolves under
  `public/`, `zasqua places` warns that the files would be served with the
  site instead.

Each record's `@id` is the place's page on the site (`baseURL` followed by
`/{place_code}/`), and its first name cites the site `title`. The record's
`when` is the span from the earliest to the latest year of the dated
descriptions linked to the place in `place_links.json`, each description's
years taken from its `date_start` and `date_expression` as the date facets
take them. A place that no dated description mentions, or every place when
`place_links.json` or `descriptions.json` is absent, carries no `when`; it is
written as its own file and left out of `index.json`, and the command reports
how many records lack one. Of the authority identifiers, only WHG, TGN and
Wikidata ids are emitted, as `closeMatch` links. The output carries no
timestamps, so an unchanged export produces byte-identical files. A record
that breaks the place contract (no `place_code`, no `display_name`, an unknown
`fclass`, or coordinates that are not a valid pair), or whose filename an
earlier record has already taken, is skipped with a warning naming it, and the
run continues. So is a place whose code would be written as `index.json`,
and a place whose `place_code` is not an XML name token (letters, digits, `.`,
`_`, `:` and `-` only), since the code becomes the record's URL and filename.

### Reuse links

Each description, entity and place page has a reuse section that points at
the page's record in a standard format. Three `hugo.toml [params]` settings
name where those records are served, and each matches the command that
writes them:

- `mets_base_url` — METS documents written by `zasqua mets`, linked from
  description pages as `{mets_base_url}/{reference_code}.xml` (default:
  `/mets`, served with the site). See
  [METS documents](#mets-documents-zasqua-mets).
- `eac_base_url` — EAC-CPF records written by `zasqua eac`, linked from
  entity pages as `{eac_base_url}/{entity_code}.xml`. See
  [EAC-CPF records](#eac-cpf-records-zasqua-eac).
- `places_base_url` — Linked Places records written by `zasqua places`,
  linked from place pages as `{places_base_url}/{place_code}.json`. See
  [Linked Places records](#linked-places-records-zasqua-places).

A trailing slash on any of the three is dropped, so each link has a single
slash between the base and the code. When `eac_base_url` or
`places_base_url` is unset, the entity or place page shows a "coming soon"
note in place of the link: unlike `mets_base_url`, the two have no default,
so a site that serves the records with its pages sets them to `/eac` and
`/places`, the directories the commands write to by default. Run each command, and upload its output to the
host its setting names, before the site that links to it goes live.

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
example of a hosting arrangement. The reference Worker and the R2
diff-upload script are not part of the engine package — deployment
tooling now lives in the site-instance project's `deploy/` directory.

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
logo            = "/img/logo.svg"       # image in the header, homepage and explorers; omit for a text-only header
about_url       = "https://example.org/about"
catalog_url     = "https://catalog.example.org"
footer_copyright = "© 2026 My Institution"
footer_credits  = "Powered by Zasqua"
footer_tagline  = "A sentence about the site, shown first in the footer"
source_url      = "https://github.com/my-org/my-archive"
entity_code_label = "Person / Organisation"
place_code_label  = "Place"
```

`footer_tagline` is a sentence about the site, shown first in the footer;
without it the footer has no tagline. When the export includes a
`publisher.json` with a `legal_name`, the copyright line names it and
`footer_copyright` is not read.

`footer_logo` sets the mark at the left of the footer, and `footer_seals`
the logos at its right, after the engine's credit. Each entry takes `src`
and `alt`, and `href` to make it a link; the engine draws them white.

```toml
footer_logo  = { src = "/img/my-seal.svg", alt = "My Institution", href = "https://example.org" }
footer_seals = [ { src = "/img/partner.png", alt = "Partner" } ]
```

Without `footer_logo`, the footer takes the publisher's `logo_url` from
`publisher.json`; without `footer_seals`, the logos of its credits. With
`footer_seals = []`, no seals are shown.

`entity_code_label` and `place_code_label` control the labels shown on
authority record explorer pages; set them to the terminology your
institution uses (`Agent`, `Creator`, `Locality`, or similar).

### Home page cards

The home page shows one card per repository, built from its record in
`repositories.json`: the title, subtitle, image, and a category line with
the city and region. Cards are ordered by `home_order`, then by name, and
each links to the repository's page. To send a card elsewhere or give it
another category line, add a table for its code under `[params]`:

```toml
[params.home_cards.my-archive]
link     = "/my-archive-collection/"
category = "Featured collection"
```

Either key may be left out. The title, subtitle and image still come from
the record.

### Examples in the explorers

The entity explorer and the places explorer can offer a few records as
starting points. List them in `[params]`; each needs the record's code
and the name shown on its button. The last two names are joined with the
language's word for "or"; in Spanish it becomes "u" before a name that
starts with an /o/ sound ("Cartagena u Ospina"). Without these settings
the pages show no examples.

```toml
entity_examples = [
  { code = "ENTITY-CODE", label = "Name on the button" },
]
place_examples = [
  { code = "PLACE-CODE", label = "Name on the button" },
]
```

### Initial map view of the places explorer

By default the places explorer opens on a view that fits all of the
site's places that have coordinates (at most zoom 8), and on a world
view when there are none. A site with a few distant outliers can set the
opening view in `[params]` as `[[west, south], [east, north]]`, in
degrees. When the setting is present it is used instead of the fit; a
value that is not a valid box is ignored.

```toml
place_explorer_bounds = [[-83.0, -5.0], [-60.0, 15.0]]
```

### Colour and font palette (tokens.css)

Everything beyond identity strings — colours, fonts, layout overrides —
lives in an overlay theme, which a fresh fork does not include. Create
one and put it first in the theme chain so it takes precedence over the
base. In `hugo.toml`, change the theme line to list your overlay first:

```toml
theme = ["my-theme", "base"]
```

Then create the overlay directory and add a `tokens.css` file at
`themes/my-theme/assets/css/tokens.css`. This is where you redefine the
engine's design tokens — colours and font stacks — using a Tailwind v4
`@theme` block:

```css
@theme {
  --color-primary:       #1F4E79;
  --color-primary-deep:  #173B5C;
  --color-primary-light: #4F7FAF;
  --color-primary-dark:  #0F2740;
  --color-primary-pale:  #E6EEF6;
  --color-secondary:     #B5893C;
  --color-tertiary:      #7C8C7A;
  --color-accent:        #CFE0F5;
  --color-bg:            #FAFAF9;

  --font-sans:    "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
  --font-serif:   "Source Serif 4", ui-serif, Georgia, serif;
  --font-display: "Source Serif 4", ui-serif, Georgia, serif;
}
```

Replace each value with your own colours and fonts. The tokens are named
by the role they play:

| Token | Used for |
|---|---|
| `primary` | links, buttons, focus borders, person nodes in the entity graphs, map markers |
| `primary-deep` | buttons and active states |
| `primary-light` | link hover, person badges |
| `primary-dark` | footer and hero background |
| `primary-pale` | a pale tint of the primary colour, for overlay templates |
| `secondary`, `tertiary` | spare colours for overlay templates; the base theme does not use them |
| `accent` | underlines, highlights, type pills, footer link hover |
| `bg` | page background, and the inside of hollow graph nodes |

The engine base theme defines the same tokens in neutral greys; Tailwind
v4 merges `@theme` blocks and the last-declared value wins, so your
overlay takes precedence automatically. The matching utility classes
(`bg-primary-dark`, `hover:text-accent`, ...) are available to your
overlay templates.

**Older token names (deprecated).** Before 1.6.0 the tokens carried the
palette names of the reference deployment: `burgundy`, `burgundy-deep`,
`burgundy-light`, `burgundy-dark`, `pale-rose`, `ochre`, `sage` and
`periwinkle`, in that order matching `primary`, `primary-deep`,
`primary-light`, `primary-dark`, `primary-pale`, `secondary`, `tertiary`
and `accent`. A `tokens.css` that sets the old names still colours the
whole site, and templates that use the old utility classes
(`bg-burgundy-dark`, `hover:text-periwinkle`, ...) still get the right
colours whichever set of names you set. The old names will be removed in
2.0.0; rename them in your `tokens.css` and templates before then. Do not
set an old name to `var()` of its new name: the two would refer to each
other and both would end up unset.

**Graph and map colours.** The entity graphs, the place maps and their
legends draw with a further set of colours. They are plain CSS custom
properties, not `@theme` tokens, so set them in a `:root` rule in
`tokens.css` (outside the `@theme` block):

```css
:root {
  --graph-person: #1F4E79;          /* person nodes; defaults to primary */
  --graph-corporate: #6A5ACD;       /* corporate bodies and families */
  --graph-document: #9A9A9A;        /* document nodes */
  --graph-document-hover: #6E6E6E;
  --graph-document-dimmed: #E6E6E6;
  --graph-entity-dimmed: #DDDDDD;
  --graph-node-fill: #FFFFFF;       /* inside of hollow nodes; defaults to bg */
  --graph-link: #E0E0E0;            /* edges on the entity page */
  --graph-link-faint: rgba(150, 150, 150, 0.3); /* edges in the entity explorer */
  --map-marker: #1F4E79;            /* defaults to primary */
}
```

Use hex, `rgb()` or `hsl()` values here: the map library does not read
every CSS colour syntax. Unless you set them, `--graph-person` and
`--map-marker` follow `primary` and `--graph-node-fill` follows `bg`; the
others default to the colours the graphs have always used (a blue-violet
for corporate bodies and families, warm greys for documents and edges).
In 2.0.0 those defaults become neutral greys, so set them if you want to
keep them.

**Fonts.** The font stacks above name the families; the stylesheets that
load them are a setting in `hugo.toml`:

```toml
[params]
font_stylesheets = [
  "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Serif+4:wght@400;700&display=swap",
]
```

`font_stylesheets` takes one URL or a list, linked in order in every
page's head; a path on your own site (`"/fonts/fonts.css"`) works too.
Set it to `[]` to load no web fonts. Without the setting the engine links
DM Sans, Crimson Text and Cormorant Garamond from Google Fonts, as it did
before 1.6.0; that default is deprecated, and from 2.0.0 the engine loads
no brand fonts unless you name them. The Material Symbols icon font is
always loaded, because the templates draw their icons with it.

For a hero image, add a `static/img/hero.jpg` file to your theme
directory. If no hero image is present, the base theme renders the hero
area in the `--color-primary-dark` tone.

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

When the export includes a `publisher.json`, the engine adds sections
after your text, each only when its fields have values: Publisher,
Credits, Represented archives (from `repositories.json`), How to cite (the
publisher's site citation template), License (the publisher's terms of use
and each repository's catalogue licence), Privacy and data, Takedown
policy, and Contact. Leave those subjects out of your Markdown so the page
does not repeat them.

Every colophon, with or without a `publisher.json`, ends with a section on
the engine: its mark, version and licence, in the site's language. The
engine draws no mark above your text; to show one, put it in your Markdown.

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
