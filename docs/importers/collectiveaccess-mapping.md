<!--
  CollectiveAccess Import Adapter — DB-Mapping Contract

  This document is the authoritative reference for the CollectiveAccess
  reference adapter (`lib/importers/collectiveaccess.js`). It records the
  verified mapping from CollectiveAccess table/column data (as exposed via
  the CA web-services JSON API) to the six-file JSON contract that
  `zasqua validate` and `zasqua build` consume.

  The adapter reads CA web-services JSON output, not raw MySQL. The
  web-services API serializes the EAV schema into a flat JSON structure
  where related records (entities, places) appear as nested arrays.

  Note: the CollectiveAccess data model described here was built from
  documentation rather than a live CA instance, so the test fixture at
  `tests/fixtures/collectiveaccess/fixture.json` is hand-authored against
  that model. Before relying on this adapter in production, verify the
  fixture shape against a real CA web-services export and correct any
  discrepancies — see the Manual Verification section below.

  US English. See §8.11 of the Colombian Spanish style guide for archival
  terminology notes that apply when this adapter is used with
  Spanish-language descriptive data.

  Version: v0.1.0
-->

# CollectiveAccess Import Adapter: DB-Mapping Contract

This document describes how `zasqua import collectiveaccess <fixture.json>`
maps CollectiveAccess web-services JSON data to the six-file JSON contract
that `zasqua validate` and `zasqua build` consume.

The adapter is the **proof the contract is workable**. The contract
itself — this document — is the durable deliverable. A production integrator
would verify the fixture against a real CA export, correct any discrepancies,
and then use the adapter as a starting point.

---

## Scope and Approach

CollectiveAccess uses a heavily Entity-Attribute-Value (EAV) schema in MySQL.
Direct DB access is out of scope. The reference adapter reads CA
**web-services JSON** — the format returned by CA's built-in JSON API. This
API serializes EAV rows into a flat-ish JSON object per object record, with
related entities and places appearing as nested arrays.

The Neogranadina corpus was migrated from CA to Django. The Django models
preserve provenance IDs: `ca_object_id`, `ca_collection_id`, `ca_place_ids`
(JSON array), `ca_entity_id`. These confirm the mapping below is grounded in
real data.

---

## Table 1 — Descriptions Contract

Maps `ca_objects` + `ca_object_labels` fields to `descriptions.json` records.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| _(auto-generated)_ | `id` | Sequential integer (1-based array index + 1). CA object IDs are stored separately; the contract requires a simple integer. |
| `ca_object_id` | _(not in contract — provenance only)_ | May be stored in a `notes` field if preservation of CA provenance ID is needed. The reference adapter does not emit it. |
| `idno` | `reference_code` | Direct copy. CA `idno` is the archivist-assigned identifier string. |
| `preferred_labels[0].name` | `title` | Extract first preferred label for the configured locale (or the single label if only one exists). Run through `sanitizeField`. |
| `type_id` → resolved type name | `description_level` | CA type names (e.g. `"file"`, `"fonds"`) map directly to contract vocabulary keys. See Level Vocabulary below. |
| `ca_objects_x_collections[0].idno` | `parent_reference_code` | The collection that owns this object; `null` for root objects. |
| `repository.idno` or `repository.code` | `repository_code` | CA repository identifier. |
| `date_expression` attribute value | `date_expression` | Free-text date field from CA attributes. Run through `sanitizeField`. |
| `date_start` attribute value | `date_start` | ISO date from CA attributes, if present. |
| `scope_and_content` attribute value | `scope_content` | Multi-paragraph CA attribute. Run through `sanitizeField`. Block tags converted to newlines. |
| `extent_and_medium` attribute value | `extent` | CA attribute. Run through `sanitizeField`. |
| `arrangement` attribute value | `arrangement` | CA attribute. Run through `sanitizeField`. |
| `access_conditions` attribute value | `access_conditions` | CA attribute. Run through `sanitizeField`. |
| `reproduction_conditions` attribute value | `reproduction_conditions` | CA attribute. Run through `sanitizeField`. |
| `language` attribute value | `language` | CA language attribute. |
| `location_of_originals` attribute value | `location_of_originals` | CA attribute. Run through `sanitizeField`. |
| `location_of_copies` attribute value | `location_of_copies` | CA attribute. Run through `sanitizeField`. |
| `related_materials` attribute value | `related_materials` | CA attribute. Run through `sanitizeField`. |
| `finding_aids` attribute value | `finding_aids` | CA attribute. Run through `sanitizeField`. |
| `notes` attribute value | `notes` | CA attribute. Run through `sanitizeField`. |
| `ca_object_representations[0].iiif_manifest_url` | `iiif_manifest_url` | IIIF manifest URL from CA media representation, if present. |
| _(not typically in CA)_ | `ocr_text` | CA does not typically expose OCR text via web services. Leave empty. |

**Level Vocabulary** — `type_id` resolved name → `description_level`:

| CA Type Name | Contract `description_level` |
|---|---|
| `fonds` | `fonds` |
| `subfonds` | `subfonds` |
| `series` | `series` |
| `subseries` | `subseries` |
| `file` | `file` |
| `item` | `item` |
| `collection` | `collection` |
| _(other)_ | `item` (fallback) |

---

## Table 2 — Repositories Contract

Maps the CA repository record to `repositories.json`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| _(auto-generated)_ | `id` | Sequential integer (1-based). |
| `repository.code` or `repository.idno` | `code` | CA repository code. |
| `repository.name` | `name` | CA repository display name. Run through `sanitizeField`. |
| `repository.short_name` | `short_name` | Optional short name. Run through `sanitizeField`. |
| `repository.country` | `country` | Two-letter ISO country code from CA. |
| `repository.city` | `city` | City name. Run through `sanitizeField`. |

---

## Table 3 — Entities Contract

Maps `ca_entities` + `ca_entity_labels` to `entities.json`.

Each unique entity that appears in at least one object's `ca_entities` array
produces one record in `entities.json`. Deduplication is by `entity_id`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| `"ne-" + entity_id` | `entity_code` | Prefix CA integer entity_id with `"ne-"` to produce a string code. In a production integration, use the existing authority record code if one exists. |
| `displayname` | `display_name` | Run through `sanitizeField`. |
| `type` | `entity_type` | CA entity type code (`"ind"` → `"person"`, `"org"` → `"corporateBody"`, `"fam"` → `"family"`). See Entity Type Vocabulary below. |
| `forename` or parsed from `displayname` | `given_name` | Optional. Run through `sanitizeField`. |
| `surname` or parsed from `displayname` | `surname` | Optional. Run through `sanitizeField`. |

**Entity Type Vocabulary** — CA type → `entity_type`:

| CA `type` | Contract `entity_type` |
|---|---|
| `ind` | `person` |
| `org` | `corporateBody` |
| `fam` | `family` |
| _(other)_ | `person` (fallback) |

---

## Table 4 — Entity Links Contract

Maps `ca_objects_x_entities` relationship data to `entity_links.json`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| `"ne-" + entity_id` | `entity_code` | Same code generation as Table 3. |
| parent object's `idno` | `reference_code` | The `idno` of the object that owns this relationship. |
| `relationship_typename` | `role` | CA relationship type name used as-is. Run through `sanitizeField`. |

---

## Table 5 — Places Contract

Maps `ca_places` + `ca_place_labels` to `places.json`.

Each unique place that appears in at least one object's `ca_places` array
produces one record in `places.json`. Deduplication is by `place_id`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| _(auto-generated)_ | `id` | Sequential integer (1-based). |
| `"nl-" + place_id` | `place_code` | Prefix CA integer place_id with `"nl-"` to produce a string code. |
| `name` | `display_name` | Run through `sanitizeField`. |
| `type` | `place_type` | CA place type name used as-is. |
| `georeference` (split) | `latitude` | The `georeference` field carries a `"lat,lng"` string. Split on the first comma, parse as `Number`. Non-numeric values become `null`. |
| `georeference` (split) | `longitude` | Second component of the `"lat,lng"` string. Parse as `Number`. Non-numeric → `null`. |

**Georeference Transformation:**

```
"4.7110,-74.0721"  →  latitude: 4.7110, longitude: -74.0721
"not a coord"      →  latitude: null,   longitude: null
""                 →  latitude: null,   longitude: null
```

---

## Table 6 — Place Links Contract

Maps `ca_objects_x_places` relationship data to `place_links.json`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| `"nl-" + place_id` | `place_code` | Same code generation as Table 5. |
| parent object's `idno` | `reference_code` | The `idno` of the object that owns this relationship. |
| `relationship_typename` | `role` | CA relationship type name used as-is. |

---

## Table 7 — Hierarchy

CA object-collection relationships map to `parent_reference_code`.

| CA Web-Services Field | Contract Field | Transformation |
|---|---|---|
| `ca_objects_x_collections[0].idno` | `parent_reference_code` (on description) | The `idno` of the owning collection. `null` for root objects not assigned to any collection. |

The CA collection hierarchy is flattened into the descriptions list. Each
object's `parent_reference_code` points to the collection or parent object
that contains it.

---

## Auto-ID Generation

The contract requires integer `id` fields on descriptions, repositories, and
places. CA uses integer primary keys internally but the web-services JSON does
not expose them in the standard contract shape. The adapter auto-generates
sequential 1-based integer IDs:

```
id = arrayIndex + 1
```

---

## Text Sanitization

Every field in the tables above that specifies "Run through `sanitizeField`"
passes through `lib/sanitize.js::sanitizeField`. This strips HTML
tags, converts block-level tags to newlines, and decodes HTML entities.

Fields derived from system codes (IDs, codes, reference codes, type codes)
are NOT sanitized — they are trusted identifiers, not user-authored text.

---

## Manual Verification Note

> **IMPORTANT:** The CollectiveAccess data model described in this document
> was built from documentation rather than a live CA instance. The
> web-services JSON fixture at
> `tests/fixtures/collectiveaccess/fixture.json` is hand-authored
> against this model.
>
> Before relying on this adapter in a production integration:
>
> 1. Export 2–3 representative records from the target CA instance via its
>    JSON web-services API.
> 2. Compare the actual JSON shape against the `fixture.json` structure.
> 3. Update `fixture.json`, this contract document, and
>    `lib/importers/collectiveaccess.js` to reflect the real shape.
> 4. Re-run `npm test -- collectiveaccess.test.js` to confirm the adapter
>    still produces conformant output.
>
> In particular, verify: the exact nesting structure of `ca_entities` and
> `ca_places`; the `georeference` field format; the `preferred_labels`
> locale structure; and the `type_id` / `type` field names for description
> level and entity type resolution.

---

<!-- Version: v0.1.0 -->
