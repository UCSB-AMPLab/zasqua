<!--
  Zasqua Data Contract v1.1 — Field Reference

  This document is the human-readable companion to the JSON Schema files
  in schemas/. It describes every field in the contract files that
  `zasqua validate --strict` enforces. The schemas are the machine-readable
  source of truth; this document is derived against them so prose and
  enforcement cannot drift.

  When the schema and prior prose disagree, the schema is authoritative.
  If you add or change a field, update the corresponding schemas/*.schema.json
  first, then update this document to match.

  Contract version: 1.1 (independent of engine package version)

  Version: v1.6.0
-->

# Zasqua Data Contract v1.1

**Zasqua data contract v1.1** is the specification for the JSON files
that a Zasqua instance consumes: six record files and two optional files
that describe the publisher and the vocabulary. Every importer, cataloguing system, and
data-preparation tool that feeds Zasqua must produce files conforming to
this contract. The contract is versioned independently of the
`@ucsb-ampl/zasqua` engine package version.

## Versioning

| Item | Version |
|------|---------|
| Data contract | **1.1** |
| Schema files | `schemas/*.schema.json` |
| Engine package | independent (see `package.json`) |

The contract version advances independently of the engine. A **major-version
increment** (e.g. 1.0 → 2.0) marks a breaking change: removing a required
field, changing a required field's type, or renaming a required field.
Adding new optional fields or relaxing constraints is a non-breaking change
within the same major version.

### Changes in 1.1

Every file that conforms to 1.0 conforms to 1.1.

- Two optional files: `publisher.json` and `vocabulary.json`.
- `repositories.json` records can carry the full institution record:
  display title, subtitle, images, other names, institution type,
  `contact`, the ISDIAH description and access fields, image and catalogue
  licences, funders, attribution, `home_order` and timestamps.
- Optional text fields of `repositories.json` accept null.
- `former_codes` on entities and places and `former_reference_codes` on
  descriptions list the addresses a record was published under before.
- `modified_at` (from older exports) gives way to `updated_at`, and
  `image_reproduction_text` to `attribution`. Both older fields are still
  accepted; Fisqua writes `image_reproduction_text` during the transition.

The canonical schema `$id` — the logical identifier and contract-version
namespace embedded inside each schema file — is:

```
https://ucsb-amplab.github.io/zasqua/schemas/v1.1/<file>.schema.json
```

This is not an on-disk filesystem path. The `v1.1` segment in the URL is
the `$id` identifier for the contract version, not a directory on disk.
The schema files live at `schemas/*.schema.json` in the engine repository
(flat directory, no `v1.1/` subdirectory).

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

Two further files are optional and are single JSON objects, not arrays:
`publisher.json` (the institution that publishes the site) and
`vocabulary.json` (labels for types, roles and authority sources). When they
are absent, the engine uses its own strings.

Run `zasqua validate --strict` to validate every file present against these
schemas using ajv (JSON Schema draft-07). A passing run prints
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
| `id` | integer or string | Yes | Stable internal identifier, unique within the file: an integer in exports from the retired Django backend, a UUID string in exports from Fisqua. The build never depends on which. |
| `reference_code` | string | Yes | Unique identifier; becomes the URL slug (e.g. `co-ahrb-aht-009-d001`). |
| `local_identifier` | string or null | No | Institution-specific reference code per ISAD(G) 3.1.1 / DACS 2.1 ("local identifier"). Use it to preserve the archive's original code (which may contain spaces or punctuation) when `reference_code` is a slugified form. Rendered in the identity area, and shown as the item number before a leaf item's title in the collection tree. Null or an empty string shows no number. When the key is absent from a record, the tree falls back to a number parsed from `reference_code`; that fallback is deprecated and will be removed in 2.0.0. |
| `title` | string | Yes | Title of the unit of description per ISAD(G) 3.1.2. |
| `description_level` | string | Yes | Level of arrangement. Must be a canonical key from the `isadg.yaml` vocabulary (e.g. `fonds`, `series`, `item`). |
| `parent_reference_code` | string or null | Yes | `reference_code` of the parent description; `null` for top-level (fonds) descriptions. |
| `repository_code` | string | Yes | `code` of the holding repository (foreign key to `repositories.json`). |
| `country` | string | No | Country code or name; used as a search facet. |
| `date_expression` | string | No | Free-text date or date range per ISAD(G) 3.1.3 (e.g. `1573 .. 1574`). |
| `date_start` | string or null | No | ISO date string representing the start of the date range (e.g. `1573-01-01`); `null` when no date is known. Used as the chronological sort key. |
| `children_level` | string or null | No | The description level that most of this description's published children have, as a key from the standards profiles (for example `file`, `item`, `subseries`, `collection`); `null` when it has no children. The collection tree uses it to name what the count under a container counts ("12 files"). When absent or null, the tree uses the most common `description_level` among the children it has loaded. |
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
| `related_materials` | string or null | No | Related units of description per ISAD(G) 3.5.3. |
| `finding_aids` | string | No | Finding aids per ISAD(G) 3.4.5. |
| `notes` | string | No | General notes per ISAD(G) 3.6.1. |
| `iiif_manifest_url` | string | No | URL of the IIIF Presentation manifest for the digitized material. Enables the deep-zoom viewer when the `iiif` module is active. |
| `mets_url` | string or null | No | URL of the description's METS document, shown in the reuse section. **Engine-derived** from `[params].mets_base_url` (`${mets_base_url}/{reference_code}.xml`), so you do not need to supply it. Three-state: when `mets_base_url` is **set**, every record's link is derived from it and any supplied `mets_url` is ignored (uniform URLs); when `mets_base_url` is **unset**, a supplied `mets_url` is respected, else it defaults to `/mets/{reference_code}.xml`. A `mets_url` of null or an empty string counts as absent. |
| `creator_display` | string | No | Pre-formatted creator string (ISAD(G) 3.2.1), populated by upstream cataloging — **not** produced by `zasqua import`. Feeds METS `dc:creator`. May be a multi-value `;`-joined display string (not DC-atomic). |
| `place_display` | string | No | Pre-formatted place string, populated by upstream cataloging — not produced by `zasqua import`. Feeds METS `dc:subject`. |
| `imprint` | string | No | Publication imprint for bibliographic items, populated by upstream cataloging — not produced by `zasqua import`. Feeds METS `dc:publisher`. |
| `ocr_text` | string | No | Full-text OCR content for Pagefind indexing. Active when the `ocr` module is enabled. May contain `{{ }}` / `{% %}` template syntax — passed through unchanged. |
| `archivist_note` | string | No | Archivist's note per ISAD(G) 3.7.1 — how the description was prepared and by whom, including sources consulted. Rendered in the Control section. |
| `rules_conventions` | string | No | Rules or conventions per ISAD(G) 3.7.2 (the descriptive standard followed, e.g. ISAD(G), DACS, RAD). Rendered in the Control section. |
| `date_of_description` | string | No | Date(s) of description per ISAD(G) 3.7.3. When present, it is shown in the Control section in place of the build-derived last-modified date. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |
| `former_reference_codes` | array of strings | No | Reference codes the description was published under before, each as it appeared in the page address. The engine does not build pages for them; a deployment can redirect them to the current address. |
| `parent_id` | integer, string or null | No | Id of the parent description, in the same type as `id`; `null` for top-level descriptions. |

---

## `repositories.json`

**Schema:** `schemas/repositories.schema.json`
**Type:** Array of repository objects
**Module:** Core (always required)

One record per archival repository. Descriptions reference repositories by
the `code` field via `repository_code`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer or string | Yes | Stable internal identifier, unique within the file: an integer in exports from the retired Django backend, a UUID string in exports from Fisqua. The build never depends on which. |
| `code` | string | Yes | Repository identifier (e.g. `co-ahrb`); the join key for `descriptions.repository_code`. |
| `name` | string | Yes | Full display name of the repository. |
| `short_name` | string or null | No | Abbreviated display name; falls back to `name` when absent. |
| `display_title` | string or null | No | Title shown on the repository page and its home card; falls back to `name`. |
| `subtitle` | bilingual | No | One-sentence description under the title on the repository page and the home card. A plain string, as 1.0 exports send it, is also accepted. |
| `hero_image_url` | string or null | No | Absolute URL of the image behind the repository page header and on its home card. |
| `logo_url` | string or null | No | Absolute URL of the repository's logo, shown in the identification section. |
| `other_names` | array of strings | No | Other forms of the name (ISDIAH 5.1.3–5.1.4), shown joined with commas. |
| `institution_type` | string or null | No | Type of institution (ISDIAH 5.1.5). |
| `contact` | object | No | `street_address`, `city`, `region`, `country`, `country_code` (ISO 3166-1 alpha-3), `postal_code`, `telephone`, `email`, `website`; each a string or null. The page header shows the place, the contact strip shows the website, email and telephone, and the contact block shows the address. |
| `country` | string or null | No | Country where the repository is located. Duplicates `contact.country`; read when `contact` is absent. |
| `country_code` | string or null | No | ISO 3166-1 alpha-3 code. Duplicates `contact.country_code`. |
| `city` | string or null | No | City where the repository is located. Duplicates `contact.city`; read when `contact` is absent. |
| `address` | string or null | No | Street address. Duplicates `contact.street_address`. |
| `website` | string or null | No | Website. Duplicates `contact.website`. |
| `holdings` | bilingual | No | Holdings (ISDIAH 5.3.7). Markdown. |
| `history` | bilingual | No | History of the institution (ISDIAH 5.3.1). Markdown. |
| `access` | object | No | `opening_times`, `conditions` and `accessibility`, each bilingual Markdown (ISDIAH 5.4). |
| `reproduction_services` | bilingual | No | Reproduction services (ISDIAH 5.5.2). Markdown. |
| `image_licence` | object | No | `uri` (string or null) and `label` (bilingual) of the licence of the repository's digital images. |
| `catalogue_licence` | object | No | `uri` and `label` of the licence of the repository's catalogue and descriptions. Feeds the licence line on description pages and METS `dc:rights`; without it the site states that the catalogues are freely accessible. |
| `funders` | array | No | One object per funder: `name` (string, required), `programme`, `project_id`, `url` (each a string or null). |
| `attribution` | bilingual | No | The credit line printed with the repository's images, as the exporter composes it. |
| `description_language` | string or null | No | Language of the repository record: a language code, normally ISO 639-2 (e.g. `spa`). A value the engine does not recognise is shown as the code itself. |
| `home_order` | integer or null | No | Position of the repository's card on the home page; cards without it follow, by name. |
| `created_at`, `updated_at` | string or null | No | ISO 8601 timestamps of the repository record. |
| `description_count` | integer | No | Total number of descriptions held by this repository. Used on repository landing pages. |
| `image_reproduction_text` | string or null | No | Repository-specific reproduction-rights text. Fisqua still writes it beside `attribution` while instances move to engine 1.6.0. Feeds METS `dc:rights` for that repository's **digitised** descriptions (`has_digital = true`) and stands in for `attribution` when that is absent. |
| `root_descriptions` | array | No | Array of top-level fonds codes for this repository's landing page. |
| `modified_at` | string or null | No | ISO date (YYYY-MM-DD) of the last backend modification, from older exports; `updated_at` takes its place. |
| `descriptive_standard` | string or null | No | The descriptive standard applied to this repository's holdings (e.g. `isadg`, `dacs`, `rad`). |

A **bilingual** field is an object keyed by language code, for example
`{ "es": "…", "en": null }`. The engine shows the member for the site's
language; when that member is empty and another is not, it shows the other
inside an element marked with its `lang`. A field whose members are all
null or empty counts as absent, and so does any null or blank string.

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
| `display_name` | string | Yes | Full display name used in page titles, list cards, and graph labels. Feeds the EAC-CPF authorized `nameEntry`. |
| `entity_type` | string | Yes | Entity type: `person`, `corporate`, or `family`. Feeds EAC-CPF `entityType`. `corporate` is the contract value; the EAC-CPF exporter also accepts `corporate_body` and `corporateBody`. |
| `sort_name` | string | No | Normalized name used for alphabetical sorting (typically surname-first for persons). |
| `primary_function` | string | No | Primary function or occupation; used as a Pagefind facet. |
| `functions` | array | No | Array of function objects (`{function, count}`); displayed in the entity detail page. Each non-empty `function` feeds an EAC-CPF `function` term; counts are not exported. |
| `dates_of_existence` | string | No | Free-text dates of existence per ISAAR-CPF 5.2.1. Feeds the text of EAC-CPF `existDates`. |
| `date_earliest` | string or null | No | Earliest year of activity (YYYY or YYYY-MM-DD); used for date facets. Feeds the EAC-CPF `existDates` `standardDate`; the EAC-CPF exporter accepts an integer year as well as the string forms. |
| `date_latest` | string or null | No | Latest year of activity (YYYY or YYYY-MM-DD); used for date facets. Feeds the EAC-CPF `existDates` `standardDate`; the EAC-CPF exporter accepts an integer year as well as the string forms. |
| `surname` | string | No | Surname component of a person's name; used in structured name display. Feeds an EAC-CPF name `part` (`localType="surname"`). |
| `given_name` | string | No | Given name component; used in structured name display. Feeds an EAC-CPF name `part` (`localType="forename"`). |
| `honorific` | string | No | Title or honorific (e.g. `Don`, `Doña`); used in structured name display. Feeds an EAC-CPF name `part` (`localType="honorific"`). |
| `name_variants` | array | No | Array of name variant strings; included in Pagefind metadata. Each distinct variant feeds a further EAC-CPF `nameEntry`. |
| `history` | string | No | Biographical or administrative history per ISAAR-CPF 5.2.2. Feeds EAC-CPF `biogHist`. |
| `viaf_id` | string or null | No | VIAF authority identifier; displayed as an external authority link. Feeds an EAC-CPF identity `cpfRelation` to `https://viaf.org/viaf/{viaf_id}`. |
| `wikidata_id` | string or null | No | Wikidata identifier (e.g. `Q12345`). Feeds an EAC-CPF identity `cpfRelation` to `http://www.wikidata.org/entity/{wikidata_id}`. |
| `dbe_id` | integer or null | No | DBE (Diccionario Biográfico Español) identifier; `null` when absent. Not shown on the entity page and not yet exported as an EAC-CPF link. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |
| `former_codes` | array of strings | No | Codes the entity was published under before, each as it appeared in the page address. The engine does not build pages for them; a deployment can redirect them to the current address. |

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
| `id` | integer or string | Yes | Stable internal identifier, unique within the file: an integer in exports from the retired Django backend, a UUID string in exports from Fisqua. The build never depends on which. |
| `place_code` | string | Yes | Unique identifier with `nl-` prefix (e.g. `nl-qfsbu`); becomes the URL slug at `/{place_code}/`. |
| `display_name` | string | Yes | Display name used in page titles, markers, and list cards. Feeds the Linked Places `title` and first, cited name. |
| `label` | string | No | Short name of the place. Feeds a further Linked Places name when it differs from `display_name`. |
| `place_type` | string | No | Place type (e.g. `city`, `administrative_division`, `region`, `country`, `geographical_feature`, `river`, `other`). Feeds Linked Places `types` for `city`, `river` and `region` (Getty AAT concepts); other values are not exported. |
| `fclass` | string | No | GeoNames feature class: one of `A`, `H`, `L`, `P`, `R`, `S`, `T`. Optional in the contract but required by `zasqua places`, which feeds it to Linked Places `fclasses` and skips a place without a valid one. |
| `latitude` | number or null | No | WGS 84 latitude; `null` for places without known coordinates. Places without coordinates are valid — the map skips them. Feeds the Linked Places Point geometry, which is `null` when both coordinates are. |
| `longitude` | number or null | No | WGS 84 longitude; `null` for places without known coordinates. Feeds the Linked Places Point geometry. |
| `country_code` | string or null | No | ISO 3166-1 alpha-2 or alpha-3 country code; resolved to a country name via the Intl API. Not yet exported; would feed Linked Places `ccodes` when populated. |
| `name_variants` | array | No | Array of name variant strings; included in Pagefind metadata. Each distinct variant feeds a further Linked Places name. |
| `wikidata_id` | string or null | No | Wikidata identifier (e.g. `Q12345`); displayed as an external authority link. Feeds a Linked Places `closeMatch` link to `http://www.wikidata.org/entity/{wikidata_id}`. |
| `tgn_id` | string or null | No | Getty Thesaurus of Geographic Names identifier; displayed as an external authority link. Feeds a Linked Places `closeMatch` link to `http://vocab.getty.edu/tgn/{tgn_id}`. |
| `whg_id` | string or null | No | World Historical Gazetteer identifier; displayed as an external authority link. Feeds a Linked Places `closeMatch` link to `https://whgazetteer.org/places/{whg_id}/detail`. |
| `hgis_id` | string or null | No | HGIS de las Indias identifier; displayed as an external authority link. Not exported as a Linked Places link. |
| `modified_at` | string | No | ISO date (YYYY-MM-DD) of the last backend modification; used for per-page ETag stability. |
| `former_codes` | array of strings | No | Codes the place was published under before, each as it appeared in the page address. The engine does not build pages for them; a deployment can redirect them to the current address. |

The Linked Places `when` comes from the dated descriptions linked to the
place in `place_links.json` (their `date_start` and `date_expression`). Every
place is written as its own file; `index.json`, the LPF-conformant corpus for
bulk ingest, holds only the places that carry a `when`. A place no dated
description mentions has neither a `when` nor a citation year, so its own
file is not a conformant LPF record, and it is left out of `index.json`. The
contract carries no language for place names, so a name declares a
`lang` only when the deployer sets `places_language` in `hugo.toml`.

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

## `publisher.json`

**Schema:** `schemas/publisher.schema.json`
**Type:** Object
**Optional**

The institution that publishes the site. The footer, the colophon and the
description pages read it; without it they use the engine's own strings.

| Field | Type | Description |
|-------|------|-------------|
| `federation` | string or null | Code of the publishing federation in the cataloguing system (e.g. `example`). |
| `legal_name` | string or null | Legal name, used in the footer copyright line and the colophon. |
| `display_name` | string or null | Short name; the alt text of the publisher's logo. |
| `tax_id` | string or null | Tax identifier as it should be printed (e.g. `NIT 000.000.000-0`). |
| `location` | string or null | City and country as printed in the colophon. |
| `website` | string or null | Website; the link of the publisher's logo. |
| `email` | string or null | Contact address shown in the colophon. |
| `logo_url` | string or null | Absolute URL of the logo shown in the footer and the colophon. |
| `description` | bilingual | Paragraph about the publisher in the colophon. |
| `terms_of_use` | bilingual | Terms of use in the colophon's licence section. |
| `privacy` | bilingual | Privacy statement in the colophon. |
| `takedown` | bilingual | How to request that content be taken down. |
| `citation_template` | object | `site` and `record`, each bilingual: templates for citing the site and a record. Both are Markdown; the engine renders them first and fills the placeholders afterwards, so a field value appears as written, even if it contains asterisks or HTML. Placeholders: `{title}`, `{date}`, `{reference_code}`, `{repository}`, `{url}`, `{site}`, `{version}`, `{year}`. Without a template the citation section is not shown. |
| `credits` | array | In display order, one object per credit: `name` (string, required), `role` (required: `partner`, `funder`, `developer` or `host`), `url` and `logo_url` (each a string or null). |

In the record template, `{title}`, `{date}`, `{reference_code}` and `{repository}` are the record's title, date, reference code and repository (display title, else name), and `{url}` is the record page's address. In the site template those four are left as written and `{url}` is the site's address. In both, `{site}` is the site title, `{version}` the `version` setting in `hugo.toml`, and `{year}` the year of the build. A placeholder the engine does not know is left as written.

---

## `vocabulary.json`

**Schema:** `schemas/vocabulary.schema.json`
**Type:** Object of arrays
**Optional**

Labels for the controlled values that the record files use as codes. Every
entry has a `label` (bilingual). An entry that is no longer recommended
carries `"deprecated": true`; approved entries omit the member. A deprecated
value is still labelled wherever a record uses it.

| Array | Key | Further fields |
|-------|-----|----------------|
| `entity_types` | `code` | — |
| `place_types` | `code` | `external` (optional): `uri` of the equivalent concept in an external vocabulary, with `scheme` and `label`, each a string or null. |
| `role_groups` | `code` | `order` (integer): position of the group on entity pages. |
| `entity_roles` | `code` | `group`: the `code` of a role group, or null. Roles without a group are listed after the grouped ones. |
| `place_roles` | `code` | — |
| `authority_sources` | `key` | `url_template` (a URL with `{id}`, or null for a source the site does not link to), `applies_to` (array of record kinds, e.g. `entity`, `place`). |

The engine uses these labels in place of its bundled ones, entry by entry.
It keeps its own label for a code the file leaves out and for an entry
whose label is empty in every language. The role filters on entity pages
are grouped by each role's `group` and ordered by each group's `order`; a
role without a `group` member is left in the engine's group for it.
`otros` names the group of roles without a group; a role with
`group: "otros"` counts as having no group, and a `role_groups` entry with
the code `otros` sets only that group's heading, never its position. The
engine does not read `authority_sources` yet.

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
