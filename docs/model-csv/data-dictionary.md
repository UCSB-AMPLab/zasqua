<!--
  Model-CSV Data Dictionary

  This document defines every column in the Zasqua model-CSV import format.
  It is the authoritative reference for archivists who want to produce a
  buildable Zasqua dataset using plain-text spreadsheets, and for developers
  who need to understand the mapping between CSV input and the six-file JSON
  contract that `zasqua validate` and `zasqua build` consume.

  The model-CSV format consists of up to six sheet files, one per module:
  descriptions.csv (required), repositories.csv, entities.csv, places.csv,
  entity_links.csv, place_links.csv. Each sheet's columns must use the
  canonical contract field names defined below — no friendly labels, no
  translations. The matching CSV template is at
  `templates/model-csv/descriptions.csv` (version v0.1.0).

  Version: v0.1.0
-->

# Model-CSV Data Dictionary

This document is the column-by-column reference for the Zasqua model-CSV
import format. Every table row describes one contract field:
its canonical column name, whether it is required, the expected value format,
and any controlled vocabulary or special convention that applies.

## How to use the model-CSV format

1. Copy `templates/model-csv/descriptions.csv` and rename it for your
   collection.
2. Fill each row with one archival description. Use canonical column names
   exactly as listed below — the importer performs a strict header check and
   warns on any unrecognised column name.
3. Create the optional sheets (repositories.csv, entities.csv, etc.) if your
   dataset includes entities, places, or links.
4. Run `zasqua import csv <your-dir> --out staging/` to convert the sheets into
   the six-file JSON contract.
5. Run `zasqua validate` (pointing at the staging directory) to confirm
   conformance.

---

## Sheet 1: `descriptions.csv` (required)

One row per archival description. This sheet covers ISAD(G) Core +
Hierarchy + IIIF + OCR in a single file.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `reference_code` | Yes | string | Unique identifier for the description; becomes the URL slug. Example: `co-ahrb-f001`. |
| `title` | Yes | string | Title of the unit of description per ISAD(G) 3.1.2. |
| `description_level` | Yes | string (enum) | Level of arrangement. Must be one of the canonical keys listed in the **Description Level Vocabulary** section below. |
| `parent_reference_code` | Yes | string or empty | `reference_code` of the parent description in the hierarchy (ISAD(G) 3.1.4). Leave empty or omit for top-level (fonds) descriptions. The importer converts empty cells to `null`. |
| `repository_code` | Yes | string | `code` of the holding repository (foreign key to `repositories.csv`). |
| `date_expression` | No | string | Free-text date or date range (ISAD(G) 3.1.3). Example: `1750 .. 1900` or `1756-06-12`. |
| `scope_content` | No | string | Scope and content note (ISAD(G) 3.3.1). Plain text; HTML tags are stripped at import. Multi-paragraph text may use `\n` separators, or pipe (`\|`) to produce bullet-list rendering. |
| `access_conditions` | No | string | Conditions governing access (ISAD(G) 3.4.1). |
| `reproduction_conditions` | No | string | Conditions governing reproduction (ISAD(G) 3.4.2). |
| `extent` | No | string | Extent and medium (ISAD(G) 3.1.5). Example: `3 cajas, 450 folios`. |
| `language` | No | string | Language(s) of the material (ISAD(G) 3.4.3). Pipe-separated if multiple: `español\|latín`. |
| `arrangement` | No | string | System of arrangement (ISAD(G) 3.3.4). |
| `location_of_originals` | No | string | Existence and location of originals (ISAD(G) 3.5.1). |
| `location_of_copies` | No | string | Existence and location of copies (ISAD(G) 3.5.2). |
| `related_materials` | No | string | Related units of description (ISAD(G) 3.5.3). |
| `finding_aids` | No | string | Finding aids (ISAD(G) 3.4.5). |
| `notes` | No | string | Notes (ISAD(G) 3.6.1). |
| `iiif_manifest_url` | No | string (URL) | URL of the IIIF presentation manifest for the digitized material. Must be a full URL starting with `https://`. Enables the IIIF deep-zoom viewer in the built site. |
| `mets_url` | No | string (URL) | URL of a METS package, if available. Used in the Reuse section. |
| `ocr_text` | No | string or `@file:` path | Full-text OCR content (ISAD(G) reutilization, Pagefind indexing). May contain literal `{{ }}` and `{% %}` Go-template syntax — these pass through the importer unchanged. To supply OCR text from an external file, use the `@file:` convention: `@file:ocr/page1.txt`. The path must be relative to the CSV directory and must not contain `..` segments or start with `/`. |

### Description Level Vocabulary

The `description_level` column must use one of these canonical engine keys,
sourced from `themes/base/data/standards/isadg.yaml`:

| Key | ISAD(G) label (English) | ISAD(G) etiqueta (español) |
|-----|------------------------|---------------------------|
| `fonds` | Fonds | Fondo |
| `subfonds` | Subfonds | Subfondo |
| `series` | Series | Serie |
| `subseries` | Subseries | Subserie |
| `file` | File | Expediente |
| `item` | Item | Unidad documental |
| `collection` | Collection | Colección |
| `section` | Section | Sección |
| `volume` | Volume | Tomo |

> **Note:** The Spanish-language display labels come from the engine's ISAD(G)
> vocabulary file (`themes/base/data/standards/isadg.yaml`). Do not
> invent Spanish labels — use the canonical keys listed in the Key column above
> and the engine will look up the correct Spanish label at build time.

### Auto-generated `id` field

The importer auto-generates a sequential integer `id` (1, 2, 3, …) for every
description record. This field is required by the contract but does not need to
appear in the CSV. If your CSV includes an `id` column, the importer uses it
(coerced to a number); if not, sequential integers are assigned in row order.

---

## Sheet 2: `repositories.csv`

One row per holding repository. The `code` value is the foreign key referenced
by `repository_code` in `descriptions.csv`.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `code` | Yes | string | Short identifier for the repository. Used as a foreign key. Example: `co-ahrb`. |
| `name` | Yes | string | Full display name. |
| `short_name` | No | string | Abbreviated name for compact display. |
| `country` | No | string | Country name. |
| `city` | No | string | City where the repository is located. |
| `url` | No | string (URL) | Repository website. |
| `descriptive_standard` | No | string | Descriptive standard the repository uses. Example: `isadg`, `dacs`, `rad`. |

The `id` field is auto-generated (same rule as descriptions).

---

## Sheet 3: `entities.csv`

One row per named entity (person, corporate body, or family). Entities are
optional — omit this sheet if your dataset has no entity authority records.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `entity_code` | Yes | string | Unique code, must start with `ne-`. Example: `ne-abc12`. |
| `display_name` | Yes | string | Name as displayed to users. |
| `entity_type` | Yes | string | Type of entity. Common values: `person`, `corporateBody`, `family`. |
| `sort_name` | No | string | Name for alphabetic sorting (surname first for persons). |
| `given_name` | No | string | Given name (persons only). |
| `surname` | No | string | Surname or main name element. |
| `honorific` | No | string | Title or honorific (e.g. `Dr.`, `Fray`). |
| `dates_of_existence` | No | string | Dates of existence as a free-text string. |
| `date_earliest` | No | string | Earliest known date (ISO: `YYYY` or `YYYY-MM-DD`). Used for faceting. |
| `date_latest` | No | string | Latest known date. |
| `primary_function` | No | string | Main function or occupation. |
| `history` | No | string | Biographical or administrative history. HTML is stripped at import. |
| `viaf_id` | No | string | VIAF identifier. |
| `dbe_id` | No | string | DBE (Diccionario Biográfico Español) identifier. |
| `name_variants` | No | pipe-separated string | Variant names separated by `\|`. Example: `Juan de Dios López\|Juan López Herrera`. |

---

## Sheet 4: `places.csv`

One row per geographic place authority record.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `place_code` | Yes | string | Unique code, must start with `nl-`. Example: `nl-qfsbu`. |
| `display_name` | Yes | string | Place name as displayed to users. |
| `place_type` | No | string | Type of place. Examples: `city`, `region`, `country`. |
| `country_code` | No | string | ISO 3166-1 alpha-2 country code. Example: `CO`. |
| `latitude` | No | number | Decimal latitude. Leave empty for coordinate-free records (these are still valid). |
| `longitude` | No | number | Decimal longitude. |
| `wikidata_id` | No | string | Wikidata QID. Example: `Q2841`. |
| `tgn_id` | No | string | Getty TGN identifier. |
| `whg_id` | No | string | World Historical Gazetteer identifier. |
| `hgis_id` | No | string | HGIS de las Indias identifier. |
| `name_variants` | No | pipe-separated string | Variant place names separated by `\|`. |

The `id` field is auto-generated.

---

## Sheet 5: `entity_links.csv`

One row per relationship between a description and an entity.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `entity_code` | Yes | string | Code of the related entity (must exist in `entities.csv`). |
| `reference_code` | Yes | string | Code of the related description (must exist in `descriptions.csv`). |
| `role` | Yes | string | Relationship type. Examples: `subject`, `creator`, `contributor`. |
| `title` | No | string | Display title of the linked description (denormalized for display). |
| `date_expression` | No | string | Date of the linked description. |
| `repository_code` | No | string | Repository code of the linked description. |
| `role_raw` | No | string | Raw role string as it appeared in the source (for reconciliation). |

---

## Sheet 6: `place_links.csv`

One row per relationship between a description and a place.

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `place_code` | Yes | string | Code of the related place (must exist in `places.csv`). |
| `reference_code` | Yes | string | Code of the related description. |
| `role` | No | string | Relationship type, if known. Examples: `created_at`, `mentions`. |

---

## Pipe-separated multi-value fields

Several fields accept multiple values separated by a pipe character (`|`).
The engine renders pipe-separated text as a bullet list on description pages.
Use this convention for fields such as `language`, `name_variants`, and
multi-value `scope_content` entries.

Example: a description in both Spanish and Latin would have `language` set to
`español|latín`.

Do not use HTML markup in pipe-separated lists — the importer strips all HTML
tags from text fields at import time.

---

## Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| `missing required key: title at record 0` | Column name `Title` (capital T) instead of `title` | Use canonical lowercase column names |
| `wrong type for key 'id' at record 0: expected number` | `id` column contains a non-numeric value | Let the importer auto-generate ids (omit the `id` column) |
| `@file: path must not escape the CSV directory` | `ocr_text` cell contains `@file:../../etc/...` | Use a relative path inside the CSV directory |
| `@file: path must be relative (absolute path rejected)` | `ocr_text` cell contains `@file:/absolute/path` | Use a relative path |

<!-- Version: v0.1.0 -->
