<!--
  Zasqua Data Contract v1.0 — Field Reference

  This document is the human-readable companion to the six JSON Schema files
  in schemas/. It describes every field in the six contract files that
  `zasqua validate --strict` enforces. The schemas are the machine-readable
  source of truth; this document is derived against them so prose and
  enforcement cannot drift.

  When the schema and prior prose disagree, the schema is authoritative.
  If you add or change a field, update the corresponding schemas/*.schema.json
  first, then update this document to match.

  Contract version: 1.0 (independent of engine package version)

  Version: v1.1.0
-->

# Zasqua Data Contract v1.0

**Zasqua data contract v1.0** is the specification for the six JSON files
that a Zasqua instance consumes. Every importer, cataloguing system, and
data-preparation tool that feeds Zasqua must produce files conforming to
this contract. The contract is versioned independently of the
`@ucsb-ampl/zasqua` engine package version.

## Versioning

| Item | Version |
|------|---------|
| Data contract | **1.0** |
| Schema files | `schemas/*.schema.json` |
| Engine package | independent (see `package.json`) |

The contract version advances independently of the engine. A **major-version
increment** (e.g. 1.0 → 2.0) marks a breaking change: removing a required
field, changing a required field's type, or renaming a required field.
Adding new optional fields or relaxing constraints is a non-breaking change
within the same major version.

The canonical schema `$id` — the logical identifier and contract-version
namespace embedded inside each schema file — is:

```
https://ucsb-amplab.github.io/zasqua/schemas/v1.0/<file>.schema.json
```

This is not an on-disk filesystem path. The `v1.0` segment in the URL is
the `$id` identifier for the contract version, not a directory on disk.
The schema files live at `schemas/*.schema.json` in the engine repository
(flat directory, no `v1.0/` subdirectory).

## The Six Contract Files

All six files live in the `exports/` directory of your instance. All are
JSON arrays — an empty array `[]` is valid when the corresponding module
is disabled.

| File | Module | Always required |
|------|--------|----------------|
| `descriptions.json` | Core | Yes |
| `repositories.json` | Core | Yes |
| `entities.json` | Entities | No (empty array if entities disabled) |
| `entity_links.json` | Entities | No (empty array if entities disabled) |
| `places.json` | Places | No (empty array if places disabled) |
| `place_links.json` | Places | No (empty array if places disabled) |

Run `zasqua validate --strict` to validate all six files against these schemas
using ajv (JSON Schema draft-07). A passing run prints
`validate schema=<file> status=pass` for each file.

---

## `descriptions.json`

**Schema:** `schemas/descriptions.schema.json`
**Type:** Array of description objects
**Module:** Core (always required)

One record per archival description (fonds, subfonds, series, file, item, etc.).
`reference_code` is the primary identifier and becomes the URL slug for the
published page.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | Yes | Internal numeric identifier. |
| `reference_code` | string | Yes | Unique identifier; becomes the URL slug (e.g. `co-ahrb-aht-009-d001`). |
| `local_identifier` | string | No | Institution-specific reference code per ISAD(G) 3.1.1 / DACS 2.1 ("local identifier"). Use it to preserve the archive's original code (which may contain spaces or punctuation) when `reference_code` is a slugified form. Rendered in the identity area. |
| `title` | string | Yes | Title of the unit of description per ISAD(G) 3.1.2. |
| `description_level` | string | Yes | Level of arrangement. Must be a canonical key from the `isadg.yaml` vocabulary (e.g. `fonds`, `series`, `item`). |
| `parent_reference_code` | string or null | Yes | `reference_code` of the parent description; `null` for top-level (fonds) descriptions. |
| `repository_code` | string | Yes | `code` of the holding repository (foreign key to `repositories.json`). |
| `country` | string | No | Country code or name; used as a search facet. |
| `date_expression` | string | No | Free-text date or date range per ISAD(G) 3.1.3 (e.g. `1573 .. 1574`). |
| `date_start` | string or null | No | ISO date string representing the start of the date range (e.g. `1573-01-01`); `null` when no date is known. Used as the chronological sort key. |
| `has_children` | boolean | No | Whether the description has child descriptions in the hierarchy. |
| `has_digital` | boolean | No | Whether digitized images are available for this description. |
| `scope_content` | string | No | Scope and content note per ISAD(G) 3.3.1. |
| `extent` | string | No | Extent and medium per ISAD(G) 3.1.5 (e.g. `3 boxes, 450 folios`). |
| `arrangement` | string | No | System of arrangement per ISAD(G) 3.3.4. |
| `access_conditions` | string | No | Conditions governing access per ISAD(G) 3.4.1. |
| `reproduction_conditions` | string | No | Conditions governing reproduction per ISAD(G) 3.4.2. |
| `language` | string | No | Language(s) of the material per ISAD(G) 3.4.3. |
| `location_of_originals` | string | No | Existence and location of originals per ISAD(G) 3.5.1. |
| `location_of_copies` | string | No | Existence and location of copies per ISAD(G) 3.5.2. |
| `related_materials` | string | No | Related units of description per ISAD(G) 3.5.3. |
| `finding_aids` | string | No | Finding aids per ISAD(G) 3.4.5. |
| `notes` | string | No | General notes per ISAD(G) 3.6.1. |
| `iiif_manifest_url` | string | No | URL of the IIIF Presentation manifest for the digitized material. Enables the deep-zoom viewer when the `iiif` module is active. |
| `mets_url` | string | No | URL of a METS package, if available. Displayed in the reuse section. |
| `ocr_text` | string | No | Full-text OCR content for Pagefind indexing. Active when the `ocr` module is enabled. May contain `{{ }}` / `{% %}` template syntax — passed through unchanged. |
| `archivist_note` | string | No | Archivist's note per ISAD(G) 3.7.1 — how the description was prepared and by whom, including sources consulted. Rendered in the Control section. |
| `rules_conventions` | string | No | Rules or conventions per ISAD(G) 3.7.2 (the descriptive standard followed, e.g. ISAD(G), DACS, RAD). Rendered in the Control section. |
| `date_of_description` | string | No | Date(s) of description per ISAD(G) 3.7.3. When present, it is shown in the Control section in place of the build-derived last-modified date. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |
| `parent_id` | integer or null | No | Numeric id of the parent description; `null` for top-level descriptions. |

---

## `repositories.json`

**Schema:** `schemas/repositories.schema.json`
**Type:** Array of repository objects
**Module:** Core (always required)

One record per archival repository. Descriptions reference repositories by
the `code` field via `repository_code`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | Yes | Internal numeric identifier. |
| `code` | string | Yes | Repository identifier (e.g. `co-ahrb`); the join key for `descriptions.repository_code`. |
| `name` | string | Yes | Full display name of the repository. |
| `short_name` | string | No | Abbreviated display name; falls back to `name` when absent. |
| `country` | string | No | Country where the repository is located. |
| `city` | string | No | City where the repository is located. |
| `description_count` | integer | No | Total number of descriptions held by this repository. Used on repository landing pages. |
| `image_reproduction_text` | string | No | Repository-specific text for the image reproduction / reuse section. |
| `root_descriptions` | array | No | Array of top-level fonds codes for this repository's landing page. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |
| `descriptive_standard` | string | No | The descriptive standard applied to this repository's holdings (e.g. `isadg`, `dacs`, `rad`). |

---

## `entities.json`

**Schema:** `schemas/entities.schema.json`
**Type:** Array of entity objects
**Module:** Entities (optional; empty array when the `entities` module is disabled)

One record per entity authority record (ISAAR-CPF: persons, corporate bodies,
families). `entity_code` is the primary identifier and becomes the URL slug.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_code` | string | Yes | Unique identifier with `ne-` prefix (e.g. `ne-da5jn`); becomes the URL slug at `/{entity_code}/`. |
| `display_name` | string | Yes | Full display name used in page titles, list cards, and graph labels. |
| `entity_type` | string | Yes | Entity type: `person`, `corporate`, or `family`. |
| `sort_name` | string | No | Normalized name used for alphabetical sorting (typically surname-first for persons). |
| `primary_function` | string | No | Primary function or occupation; used as a Pagefind facet. |
| `functions` | array | No | Array of function objects (`{function, count}`); displayed in the entity detail page. |
| `dates_of_existence` | string | No | Free-text dates of existence per ISAAR-CPF 5.2.1. |
| `date_earliest` | string | No | Earliest year of activity (YYYY or YYYY-MM-DD); used for date facets. |
| `date_latest` | string | No | Latest year of activity (YYYY or YYYY-MM-DD); used for date facets. |
| `surname` | string | No | Surname component of a person's name; used in structured name display. |
| `given_name` | string | No | Given name component; used in structured name display. |
| `honorific` | string | No | Title or honorific (e.g. `Don`, `Doña`); used in structured name display. |
| `name_variants` | array | No | Array of name variant strings; included in Pagefind metadata. |
| `history` | string | No | Biographical or administrative history per ISAAR-CPF 5.2.2. |
| `viaf_id` | string | No | VIAF authority identifier; displayed as an external authority link. |
| `dbe_id` | integer or null | No | DBE (Diccionario Biográfico Español) identifier; `null` when absent. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |

---

## `entity_links.json`

**Schema:** `schemas/entity_links.schema.json`
**Type:** Array of entity link objects
**Module:** Entities (optional; empty array when the `entities` module is disabled)

One row per entity appearance in a description. Many rows may share the same
`entity_code` or the same `reference_code`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_code` | string | Yes | Foreign key to `entities.entity_code` (e.g. `ne-da5jn`). |
| `reference_code` | string | Yes | Foreign key to `descriptions.reference_code` (e.g. `co-ahrb-aht-009-d001`). |
| `role` | string | Yes | Role of the entity in the description (e.g. `plaintiff`, `notary`). Must match a key in the instance's role vocabulary. |
| `title` | string | No | Cached title of the description; used in entity detail page list cards without a separate fetch. |
| `date_expression` | string | No | Cached date expression from the description; displayed on list cards. |
| `repository_code` | string | No | Cached repository code from the description; displayed as a badge on list cards. |
| `role_raw` | string | No | Original unprocessed role text from the source document; preserved for traceability. |

---

## `places.json`

**Schema:** `schemas/places.schema.json`
**Type:** Array of place objects
**Module:** Places (optional; empty array when the `places` module is disabled)

One record per geographic authority record. `place_code` is the primary
identifier and becomes the URL slug.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer | Yes | Internal numeric identifier. |
| `place_code` | string | Yes | Unique identifier with `nl-` prefix (e.g. `nl-qfsbu`); becomes the URL slug at `/{place_code}/`. |
| `display_name` | string | Yes | Display name used in page titles, markers, and list cards. |
| `place_type` | string | No | Place type (e.g. `city`, `administrative_division`, `region`, `country`, `geographical_feature`, `river`, `other`). |
| `latitude` | number or null | No | WGS 84 latitude; `null` for places without known coordinates. Places without coordinates are valid — the map skips them. |
| `longitude` | number or null | No | WGS 84 longitude; `null` for places without known coordinates. |
| `country_code` | string | No | ISO 3166-1 alpha-2 or alpha-3 country code; resolved to a country name via the Intl API. |
| `name_variants` | array | No | Array of name variant strings; included in Pagefind metadata. |
| `wikidata_id` | string | No | Wikidata identifier (e.g. `Q12345`); displayed as an external authority link. |
| `tgn_id` | string | No | Getty Thesaurus of Geographic Names identifier; displayed as an external authority link. |
| `whg_id` | string | No | World Historical Gazetteer identifier; displayed as an external authority link. |
| `hgis_id` | string | No | HGIS de las Indias identifier; displayed as an external authority link. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |

---

## `place_links.json`

**Schema:** `schemas/place_links.schema.json`
**Type:** Array of place link objects
**Module:** Places (optional; empty array when the `places` module is disabled)

One row per place mention in a description.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `place_code` | string | Yes | Foreign key to `places.place_code` (e.g. `nl-qfsbu`). Note: join is on `place_code`, not `id`. |
| `reference_code` | string | Yes | Foreign key to `descriptions.reference_code` (e.g. `co-ahrb-aht-009-d001`). |
| `title` | string | No | Cached title of the description; used in place detail page list cards. |
| `date_expression` | string | No | Cached date expression from the description; displayed on list cards. |
| `repository_code` | string | No | Cached repository code; displayed as a badge on list cards. |
| `role` | string | No | Optional role of the place in the description (mapped to the place role vocabulary). |

---

## Conformance and Validation

```
# Default validate: key+type pre-pass + manifest check + i18n bundle
zasqua validate

# Strict validate: all of the above plus full JSON Schema (draft-07) pass
zasqua validate --strict
```

The `--strict` pass validates every file in `exports/` against the
corresponding schema in `schemas/`. Conformance errors are printed as:

```
validate schema=descriptions.schema.json status=fail error="/0/reference_code must be string"
```

A non-zero exit code means the data does not conform and the build should
not proceed.

---

## Cross-File Constraints

The data the curator prepares must satisfy the following referential integrity
constraints. Enforcing these constraints — ensuring that every cross-file
reference resolves before data reaches Zasqua — is the responsibility of the
importer or curator upstream. Zasqua publishes faithfully and does not resolve
cross-file references; `zasqua validate` performs per-file key-and-type
checking plus JSON Schema (`--strict`) validation only. It does NOT enforce
cross-file foreign keys.

The curator must ensure:

- Every `repository_code` in `descriptions.json` matches a `code` in
  `repositories.json`.
- Every `entity_code` in `entity_links.json` matches an `entity_code`
  in `entities.json` (when entities are enabled).
- Every `place_code` in `place_links.json` matches a `place_code`
  in `places.json` (when places are enabled).
- Every `reference_code` in `entity_links.json` and `place_links.json`
  matches a `reference_code` in `descriptions.json`.
