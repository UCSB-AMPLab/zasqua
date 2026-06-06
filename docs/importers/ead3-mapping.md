<!--
  EAD3 Import Adapter — Element-to-Field Mapping and Reconciliation-Report Spec

  This document is the authoritative reference for the EAD3 importer
  (`lib/importers/ead3.js`). It records the verified element-to-field
  mapping table, the canonical description_level vocabulary, the
  links-only authority policy, the `--standard` flag behavior, and the
  reconciliation-report schema (import-report.json).

  All mappings in this document have been verified against the AtoM and
  ArchivesSpace EAD3 test fixtures at:
    tests/fixtures/ead3-atom/export.xml
    tests/fixtures/ead3-archivesspace/export.xml

  US English. See §8.11 of the Colombian Spanish style guide for archival
  terminology notes that apply when this adapter is used with Spanish-language
  descriptive standards.

  Version: v0.1.0
-->

# EAD3 Import Adapter: Element-to-Field Mapping

This document describes how `zasqua import ead3 <export.xml>` maps EAD3 XML
elements and attributes to the six-file JSON contract that `zasqua validate`
and `zasqua build` consume.

The adapter supports canonical EAD3 exports from two major systems:

- **AtoM** (Access to Memory): uses numbered component elements (`<c01>`,
  `<c02>`, etc., an EAD2002 convention).
- **ArchivesSpace**: uses unnumbered `<c>` for all nesting levels (the EAD3
  standard form).

Both dialects are handled transparently.

---

## 1. EAD3 Element → Contract Field Mapping

### 1.1 Repository Record (`repositories.json`)

| EAD3 Source | Contract Field | Notes |
|---|---|---|
| `<eadid @countrycode>` + `<eadid @mainagencycode>` | `code` | Joined as `{countrycode}-{mainagencycode}` (e.g. `co-test-ahr`). Falls back to `@identifier` if no countrycode/mainagencycode; then to eadid text content. |
| `<archdesc>/<did>/<repository>/<corpname>` | `name` | Minimal record. `short_name`, `country`, and `city` must be filled by the archivist after import (see §5). |
| (auto-generated) | `id` | Sequential integer, always `1` for the single repository record derived per file. |

### 1.2 Description Records (`descriptions.json`)

| EAD3 Element / Attribute | Contract Field | Notes |
|---|---|---|
| `<archdesc>/@level` | `description_level` | Mapped via the level vocabulary table in §2. |
| `<archdesc>/<did>/<unitid>` | `reference_code` | Text content of the element. May include repository code prefix in some AtoM exports. |
| `<archdesc>/<did>/<unittitle>` | `title` | Text content; HTML stripped via `sanitizeField`. |
| `<archdesc>/<did>/<unitdate>` text | `date_expression` | Free-text date label as written in the XML. |
| `<archdesc>/<did>/<unitdate @normal>` | `date_start` | `@normal` start portion (before `/`). ISO date preferred. Empty if `@normal` absent. |
| `<archdesc>/<did>/<repository>/<corpname>` | `repository_code` | Derived from eadid, propagated to all child descriptions. |
| `<archdesc>/<scopecontent>/<p>` | `scope_content` | `<p>` elements joined with `\|` (pipe). Renders as a bullet list on description pages. |
| `<archdesc>/<accessrestrict>/<p>` | `access_conditions` | First `<p>` text; pipe-joined if multiple. |
| `<archdesc>/<userestrict>/<p>` | `reproduction_conditions` | First `<p>` text; pipe-joined if multiple. |
| `<archdesc>/<arrangement>/<p>` | `arrangement` | Pipe-joined `<p>` texts. |
| `<archdesc>/<did>/<physdesc>/<extent>` | `extent` | Text content of `<extent>`. |
| `<archdesc>/<did>/<langmaterial>/<language>` | `language` | Text content. If `<language>` is absent, falls back to `<langmaterial>` text. |
| `<archdesc>/<originalsloc>/<p>` | `location_of_originals` | Pipe-joined. |
| `<archdesc>/<altformavail>/<p>` | `location_of_copies` | Pipe-joined. |
| `<archdesc>/<relatedmaterial>/<p>` or `<separatedmaterial>/<p>` | `related_materials` | First match wins; pipe-joined. |
| `<archdesc>/<otherfindaid>/<p>` | `finding_aids` | Pipe-joined. |
| `<archdesc>/<odd>/<p>` or `<note>/<p>` | `notes` | Pipe-joined. Bare access-point names (see the links-only authority policy in §3) are appended to this field. |
| `<archdesc>/<did>/<dao @href>` or `@xlink:href` | `iiif_manifest_url` | **Only** when the URL ends in `/manifest.json` or contains `/manifest` (IIIF-shaped). Otherwise: added to `notes`; flagged in the reconciliation report. See §4.4. |
| `--standard` flag | `descriptive_standard` | Applied to all descriptions. Default: `isadg`. |
| (auto-generated) | `id` | Sequential integer starting at 1 across all descriptions (fonds, then components in document order). |
| parent element's `<unitid>` | `parent_reference_code` | `null` for the root `<archdesc>`. Set to the direct parent's `reference_code` for all `<c>` / `<c01>–<c12>` elements. |

All text content fields are run through `sanitizeField` at import time: HTML tags
and attributes are stripped, `</p>` and `<br>` are converted to newlines, and HTML entities
are decoded. The `{{` and `{%` sequences are left untouched (Go template auto-escaping handles
these as plain text).

### 1.3 Component Hierarchy

Each `<c>` / `<c01>`–`<c12>` child element within `<dsc>` (or within another component)
produces one description record. The `parent_reference_code` is set to the `reference_code`
of the enclosing component, enabling `zasqua build` to derive the `children/` shards.

**Example (AtoM c01/c02 nesting):**

```
archdesc unitid="co-ahr-f001"          → descriptions[0].reference_code = "co-ahr-f001"
  dsc
    c01 unitid="co-ahr-f001-s01"       → descriptions[1].parent_reference_code = "co-ahr-f001"
      c02 unitid="co-ahr-f001-s01-001" → descriptions[2].parent_reference_code = "co-ahr-f001-s01"
```

---

## 2. EAD3 `@level` → Canonical `description_level` Vocabulary

| EAD3 `@level` | Canonical `description_level` | Notes |
|---|---|---|
| `fonds` | `fonds` | |
| `subfonds` | `subfonds` | |
| `series` | `series` | |
| `subseries` | `subseries` | |
| `file` | `file` | |
| `recordgrp` | `file` | EAD3 synonym for file-level groupings |
| `item` | `item` | |
| `collection` | `collection` | ArchivesSpace default for resource-level records |
| `subgrp` | `subseries` | |
| `class` | `section` | AtoM convention |
| `otherlevel` | `item` (fallback) or `@otherlevel` value | When `@otherlevel` is present, its value is used directly (lowercased). If absent, defaults to `item`. |

The canonical keys are defined in `themes/base/data/standards/isadg.yaml` and used
across all standards profiles. Importers always map to these keys; display labels are
resolved at build time from the active standard profile.

---

## 3. Links-Only Authority Policy

The EAD3 adapter **never mints authority records**. It does not create new entries in
`entities.json` or `places.json`.

### 3.1 When a link IS emitted

An `entity_link` or `place_link` record is written **only** when all three conditions hold:

1. The `<controlaccess>` element carries an `@identifier` attribute.
2. The `@identifier` value matches an existing `entity_code` (for `persname`, `corpname`,
   `famname`) or `place_code` (for `geogname`) in the instance's authority files.
3. The instance authority files (`entities.json`, `places.json`) are present in the
   directory passed as `instanceRoot` to the adapter.

### 3.2 Match key

The `@identifier` value is compared directly (string equality) against the authority code:

```
<persname identifier="ne-abc12" relator="creator">López Gutiérrez, Juan</persname>
  → entity_links: { entity_code: "ne-abc12", reference_code: "...", role: "creator" }
```

### 3.3 Role from `@relator`

The `role` field in `entity_links` / `place_links` is taken from the `@relator` attribute.
If `@relator` is absent, `"subject"` is used as the default for entity links and `"place"`
for geographic links.

### 3.4 Bare / unmatched names

A `<controlaccess>` element is **bare** if it carries no `@identifier`, or if its
`@identifier` does not match any authority code. Bare names are:

- **Not** added to `entity_links` or `place_links`.
- **Not** used to mint new authority records.
- **Appended** to the parent description's `notes` field as:
  `Bare name (no @identifier) dropped to prose: {name text}`
- **Tallied** in the reconciliation report under `access_points.skipped`.

This preserves the information in the record without contaminating the authority graph
with unverified names.

---

## 4. `--standard` Flag

```
zasqua import ead3 export.xml --standard isadg
zasqua import ead3 export.xml --standard dacs
zasqua import ead3 export.xml --standard rad
```

The `--standard` value is written to `descriptive_standard` on every description record
in the output. The default is `isadg` when the flag is omitted.

`descriptive_standard` is a repository-level field in the Zasqua data model. The adapter
writes it on each description record for compatibility; archivists
should verify the value and optionally move it to `repositories.json` if their pipeline
requires repository-level standard assignment.

---

## 5. Genuinely Ambiguous Mappings

These mappings involve judgment calls that the adapter cannot resolve automatically. The
adapter follows the "surface, do not invent" principle and documents them in the
reconciliation report.

### 5.1 `<dao>` → `iiif_manifest_url`

Not all digital object links are IIIF manifests. The adapter applies this heuristic:

- If the `@href` (or `@xlink:href`) contains `/manifest.json` or `/manifest`, the URL
  is written to `iiif_manifest_url`.
- Otherwise, the URL is logged in the reconciliation report under `dialect_quirks` as
  `dao href detected (non-IIIF): {url}` and the field is left empty.

Archivists should review the import report and add non-IIIF DAO URLs to the `notes` or
`mets_url` field in the generated `descriptions.json` as appropriate.

### 5.2 Repository record completeness

EAD3's `<repository>/<corpname>` provides only a display name. The adapter creates a
minimal repository record with `id`, `code`, and `name`. The optional fields
`short_name`, `country`, and `city` (used in the UI repository landing page) must be
filled by the archivist after import by editing the generated `repositories.json` before
promoting it to `exports/`.

### 5.3 `<unitdatestructured>` → `date_start`

When `<unitdatestructured>/<daterange>` is present without a `@standarddate` attribute,
`date_start` will be empty. The adapter does not attempt to parse free-text date ranges.

---

## 6. Reconciliation Report Schema (`import-report.json`)

The adapter writes `import-report.json` to the staging directory alongside the six
contract files.

```json
{
  "format": "ead3",
  "dialect": "atom" | "archivesspace",
  "standard": "isadg",
  "descriptions_count": 3,
  "repositories_count": 1,
  "access_points": {
    "carried": 2,
    "skipped": 1,
    "skipped_list": [
      {
        "element": "persname",
        "text": "Martínez Herrera, Pedro",
        "reason": "no @identifier"
      }
    ]
  },
  "dialect_quirks": [
    "numbered component elements (c01/c02) detected — treated as <c> per EAD3 recommendation",
    "dao xlink:href detected on 1 component(s)"
  ]
}
```

| Field | Description |
|---|---|
| `format` | Always `"ead3"`. |
| `dialect` | `"atom"` if numbered `<c01>`/`<c02>` elements were detected; `"archivesspace"` if only unnumbered `<c>`. |
| `standard` | The value passed to `--standard`. |
| `descriptions_count` | Total description records written. |
| `repositories_count` | Always 1 (one repository per EAD3 export file). |
| `access_points.carried` | Number of `<controlaccess>` elements that produced an `entity_link` or `place_link` (matched `@identifier`). |
| `access_points.skipped` | Number of `<controlaccess>` elements that were bare or unmatched — dropped to prose. |
| `access_points.skipped_list` | Array of `{ element, text, reason }` objects, one per skipped access point. `reason` is `"no @identifier"` or `"@identifier '{code}' not in authority file"`. |
| `dialect_quirks` | Array of strings noting non-standard features encountered (numbered components, non-IIIF DAOs, etc.). |

---

## 7. Security Notes

### Text content injection

All text fields from the EAD3 XML are run through `sanitizeField` from
`lib/sanitize.js` before being written to the output JSON. This strips HTML
tags, event attributes, and script elements from any untrusted markup that may appear
in EAD3 exports from third-party systems.

### XML external entity / DOCTYPE expansion

`fast-xml-parser` does not resolve external entities or fetch external DTDs by default.
No entity-processing option is enabled in the adapter's parser configuration. This
prevents XML External Entity (XXE) and billion-laughs expansion attacks from untrusted
EAD3 files.

### False authority records from bare names

The links-only policy (§3) is the primary mitigation. The adapter explicitly tests that
bare names produce zero `entity_links` records, and the test suite asserts this via the
`ead3.test.js` fixture that includes one bare `<persname>` with no `@identifier`.

---

<!-- Version: v0.1.0 -->
