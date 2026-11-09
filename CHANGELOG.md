# Changelog

All notable changes to the Zasqua engine (`@ucsb-ampl/zasqua`) are documented in this
file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/).

This changelog covers the **engine** — the npm package that provides the `zasqua`
command-line interface, the base theme, the build pipeline, and the importer and
validation tooling. The engine is versioned independently of any deployment; the
release history of the zasqua.org reference archive lives with that instance, not
here.

## [1.6.0] — 2026-11-08

### Added

- **The engine's mark in the footer and the colophon.** The engine credit is shown at the right of the footer beside the Zasqua pomegranate, linked to a section on the engine that now closes every colophon: the mark, the engine's version and license, and links to its source code and to AMPL, in the site's language.
- **`footer_logo` and `footer_seals`.** These `hugo.toml` settings set the mark at the left of the footer and the logos at its right. Without them, the publisher's logo and its credits' logos are taken from `publisher.json`, as before. With `footer_seals = []`, no seals are shown.
- **Data contract 1.1: publisher, vocabulary and full repository records.** `zasqua validate` accepts two optional files, `publisher.json` and `vocabulary.json`, and the full repository record: display title, subtitle, contact, ISDIAH description and access fields, image and catalog licenses, funders, attribution and home-page order. Every new field may be null, and every 1.0 export still conforms. `--strict` checks the new files against `schemas/publisher.schema.json` and `schemas/vocabulary.schema.json`. See `docs/data-contract.md`.
- **CollectiveAccess code prefixes are options.** `zasqua import collectiveaccess` takes `--entity-prefix` and `--place-prefix` (programmatic: `entityPrefix`, `placePrefix`) for the prefixes of entity and place codes. See `docs/importers/collectiveaccess-mapping.md`.
- **Sanitization is an import setting.** `zasqua import` takes `--trusted` (skip HTML sanitization) and `--sanitize` (apply it); programmatically, the `trusted` option. The defaults are as before: the Fisqua format is copied unsanitized and every other format is sanitized. See `docs/guide.md`.
- **`place_explorer_bounds` sets the places explorer's opening view.** A `[params]` value `[[west, south], [east, north]]` is used instead of the fit to the site's places; without it the map fits to the places (zoom capped at 8), and shows the world when there are none.
- **Country names for every ISO 3166-1 code.** The place page names a place's country
  from `themes/base/data/countries.yaml`, which lists all 249 assigned alpha-3 codes with
  English and Spanish names from CLDR, instead of fourteen codes written into the
  template. A site's `place.countries.<CODE>` i18n key still takes precedence. The file is
  written by `scripts/generate-country-names.js`.
- **`repository.exploreCollections` i18n key** for the home page's collections heading,
  which was English on every site.
- **Font stylesheets are a setting.** `font_stylesheets` in `hugo.toml` takes the URL, or
  a list of URLs, of the stylesheets that load the site's web fonts; `[]` loads none.
  Without it the engine links DM Sans, Crimson Text and Cormorant Garamond from Google
  Fonts, as before. The Material Symbols icon font is still linked on every page.
- **Graph and map color tokens.** The entity graphs, the place maps and their legends
  read `--graph-person`, `--graph-corporate`, `--graph-document`,
  `--graph-document-hover`, `--graph-document-dimmed`, `--graph-entity-dimmed`,
  `--graph-node-fill`, `--graph-link`, `--graph-link-faint` and `--map-marker`, which a
  site can set in a `:root` rule. Person nodes and map markers follow the primary
  color and hollow nodes the page background; the others default to the colors the
  graphs drew with before.
- **Repository pages show the full repository record.** The header takes the display title, subtitle, hero image and place. Website, email and telephone sit in a strip below it. The ISDIAH sections are behind a closed "About the repository" bar above the tree: identification, description, access, services, reuse, funders and control, with the address beside them. Prose fields are rendered as Markdown with raw HTML escaped. A 1.0 record still shows its name, place, count and tree.
- **Home cards come from the repository record.** Each card takes the title, subtitle, hero image and place from the record and links to the repository page. Cards are ordered by `home_order`, then by name. A card without an image takes the header color.
- **The publisher in the footer and colophon.** `footer_tagline` sets the footer's first line. With a `publisher.json`, the copyright line names the publisher, its logo and the credits' logos appear as seals, and the colophon gains the publisher, credits, represented archives, citation, license, privacy, takedown and contact sections.
- **Catalogue license and citation on description pages.** The catalog line names the repository's catalog license, linked to it. The images credit takes the repository's attribution. A new "How to cite" section renders the publisher's record citation template as Markdown, fills its placeholders after rendering so record values appear as written, and offers a copy button that copies the citation as plain text.
- **A home card's link and category can be set in `hugo.toml`.** A `[params.home_cards.<code>]` table sets `link` and `category` for that repository's card, so a site can point a card at a collection instead of the repository page without overriding the home template.
- **Labels from `vocabulary.json`.** On the entity and place pages and their explorers, the engine takes the labels of entity types, place types, roles, role groups and place roles from the export's `vocabulary.json`, entry by entry, and keeps its bundled label for a code the file leaves out or labels empty. The role filters are grouped and ordered by the file's `group` and `order`. The bundled role grouping lives in `themes/base/data/vocab/role-groups.yaml`.
- **Language names for description languages.** `themes/base/data/languages.yaml` gives Spanish and English names for three-letter language codes, from CLDR. It is written by `scripts/generate-language-names.js`.
- **`zasqua validate` warns on codes the vocabulary does not define.** For each `entity_type` in `entities.json`, `place_type` in `places.json` and `role` in `entity_links.json` and `place_links.json` that `vocabulary.json` does not list (compared as the pages compare them: exactly as written and untrimmed, except that roles ignore case), one warning line gives the file, the code, the number of records that use it, and whether the pages show it with the engine's label or as the code. Without `vocabulary.json`, only codes the engine's bundled vocabulary lacks are reported. The warnings never change the exit status.
- **Former codes in the contract.** Entities and places can carry `former_codes`, and descriptions `former_reference_codes`: the codes each record was published under before, as they appeared in its address, so that a deployment can redirect them. The engine builds no pages for them. `zasqua validate` warns when a former code is also a live code in the same file, since that address shows the other record instead of redirecting; the warning never changes the exit status.

### Changed

- **The colophon no longer shows `logo` above the site's text.** A site that wants a mark there places it in its colophon Markdown.
- **Footer marks and seals are drawn white whatever their ink**, with the filter the home hero uses, instead of being inverted.
- **«Responsable del sitio».** In Spanish, the heading of the publisher's section in the colophon is «Responsable del sitio» instead of «Entidad editora».
- **Interface strings name the site by its title.** The search landing, reuse blurbs, explorer intros, entity sentences and graph sentence said "Zasqua"; they now take `{{ .Site }}`.
- **METS and EAC read the institution records.** In METS `dc:rights`, a record with images takes the repository's attribution, then `image_reproduction_text`; otherwise the record's own reproduction or access conditions, then the repository's catalog license, then `mets_default_rights`. When `publisher.json` has a `legal_name`, the METS creator agent is named with the legal name, tax ID and location, and its note is the publisher's `website`; the EAC-CPF maintenance agency is named with the legal name alone. Without a `legal_name`, both fall back to their `hugo.toml` settings (`mets_creator_name` and `mets_creator_url`, `eac_agency_name`).
- **The site's language reaches every build step.** The manifest's `[ui] language`
  setting, read through a new `lib/site-language.js`, now also sets the language of
  formatted dates and counts and of the search indexes. Dates and counts were always
  Spanish ("15 de marzo de 1723", "1.000") and the indexes always used Spanish stemming;
  an English site now gets "March 15, 1723", "1,000" and English stemming. Spanish
  output is unchanged.
- **Century labels and the century facet work in every language.** The search page and
  the entity explorer took the century facet key by stripping "Siglo " from the visible
  label, which failed on English sites; they now derive it from the filter's years.
- **Browser scripts take the language from `<html lang>` only.** The entity page and the
  connection graph no longer fall back to `es-CO` or special-case English to order
  dates; they format dates with the same rules as the build.
- **The engine's templates no longer read `data/ui.yaml`.** The search page's facet
  labels and the home page's collections heading come from the i18n bundles.
- **Color tokens are named by role.** The base theme's color tokens and utility classes
  are now `primary`, `primary-deep`, `primary-light`, `primary-dark`, `primary-pale`,
  `secondary`, `tertiary` and `accent`, instead of the reference deployment's palette
  names (`burgundy`, `burgundy-deep`, `burgundy-light`, `burgundy-dark`, `pale-rose`,
  `ochre`, `sage`, `periwinkle`). A site that sets the old names keeps its colors, and
  the old utility classes still work; see Deprecated.
- **The graph and map scripts no longer hard-code colors.** `entity.js`,
  `entity-explorer.js`, `infinite-bipartite-explorer.js`, `place.js` and
  `place-explorer.js` read the graph and map tokens through a new `theme-colors.js`,
  instead of drawing in burgundy and beige whatever the site's palette. A site without
  color tokens of its own now gets grey person nodes and map markers, matching the
  rest of its neutral theme.
- **One spelling for the corporate entity type.** The CollectiveAccess importer, the
  model-CSV data dictionary and the test fixtures use `corporate`, the contract value,
  instead of `corporateBody` or `corporate_body`. `zasqua validate` warns when it finds
  the older spellings; the EAC-CPF export still accepts them.
- **Record ids may be strings.** The validator and the contract schemas now accept `id` on
  descriptions, repositories and places as either an integer or a string, instead of
  integers only. Exports from the retired Django backend carry integers; exports from
  Fisqua carry UUID strings, and the build never depended on the type, only the
  validation did. `parent_id` follows `id`. The strict schemas also accept `null` where
  an optional field is empty — `related_materials` on descriptions, `date_earliest`,
  `date_latest`, `viaf_id` and `wikidata_id` on entities, `country_code`, `wikidata_id`,
  `tgn_id`, `whg_id` and `hgis_id` on places — instead of requiring the key to be
  absent; the build already treated null and absent alike.
- **The explorer logo and examples come from the site.** The entity explorer's empty
  state and the search page requested `/img/zasqua-3-burgundy-sm.svg`, a file only the
  zasqua.org instance has, so other sites showed a broken image there. Both now show the
  image set as `logo` in `hugo.toml`, as the header and homepage already do, and none
  when it is unset. The four example entities in the empty state and the four example
  places in the places explorer named records in the zasqua.org corpus; they now come
  from two new settings, `entity_examples` and `place_examples`, each a list of
  `{ code, label }`, and the pages leave the examples out without them. The example place
  buttons now find the place by its code instead of by a slug of its name. A site that
  showed the built-in examples must set the two lists to keep them.
- **The digitized-records filter value is `hosted`.** The `digital_status` search facet used the value `zasqua`; it now uses `hosted`, and the interface labels name the site by its title (`site.Title`) instead of the word "Zasqua". Filter URLs that carry `digital_status=zasqua` still select the same records. The i18n keys `search.digitalStatus.inZasqua` and `search.digitalStatusPill.inZasqua` stay in the bundles but are no longer read; they are deprecated and will be removed in 2.0.0. Use `hosted` in their place.
- **The place page shows `place_code` as written.** It no longer builds an `nl-<id>` code when the field is missing; the schema and `zasqua validate` already require it.
- **Level order and METS types come from the standards profiles.** `themes/base/data/standards/{isadg,dacs,rad}.yaml` carry two language-independent keys, `level_order` (a list of level codes in hierarchy order) and `dc_types` (level code to Dublin Core type). The search page's level facet is sorted by `level_order` of the ISAD(G) profile, passed as `data-level-order`; the METS generator reads `dc_types` under the record's own standard. Output for the current levels is unchanged. A site that ships its own copy of a profile gets the engine's values for these keys until it adds them. `js-yaml` moves from `devDependencies` to `dependencies` because the METS generator reads the profiles.
- **Neutral examples.** The search hint for exclusion terms (`search.onlyNotMessage`) now gives "letter -draft" (English) and "carta -borrador" (Spanish) in place of an example from one corpus, and comments that named one deployment's archives, places or storage now use neutral examples.
- **The collection tree numbers items from `local_identifier`.** The number before a
  leaf item's title is now the record's `local_identifier`, instead of a number parsed
  out of the reference code, which assumed one publisher's code format. A null or empty
  `local_identifier` shows no number. A record without the field at all, as in an
  export made before it existed, still gets the parsed number. The tree also no longer
  leaves out the number when a leaf's title contains a word such as "caja" or "tomo".
  The root and child data the build writes for the tree now carry `local_identifier`
  and `children_level` when the records have them.
- **The collection tree names the level of an item's children.** The count under a
  container used to read "12 composite units" or "12 simple units", decided from a
  Spanish list of container words, with a Spanish fallback in the script. It now reads
  "12 files" or "12 expedientes": the level comes from the record's `children_level`,
  else from the most common `description_level` among the children already loaded, and
  the words come from the active standards profile. When neither is known the tree uses
  the generic `tree.childUnit` string. "View record" and the filter placeholder come
  from the i18n bundles and are no longer defaulted to Spanish in the script. The
  strings reach the page in a JSON block written by a new partial, `tree-strings.html`,
  which `baseof.html` calls, so a site layout that replaces the repository or
  description template needs no change.
- **The standards profiles carry singular level labels.** Each of `isadg.yaml`,
  `dacs.yaml` and `rad.yaml` gains a `levelsSingular` table in English and Spanish,
  next to `levels` and `levelsPlural`. A profile copied from an earlier release without
  it still works: the tree falls back to the lowercased `levels` label.
- **`local_identifier` may be null** in `descriptions.json`, and `children_level` is
  documented in the data contract.
- **Two tree strings are gone.** `tree.childUnitCompuesta` and `tree.childUnitSimple`
  are removed from the English and Spanish bundles and from the required-key list,
  because nothing reads them.
- **Linked Places type terms come from `vocabulary.json`.** `zasqua places` takes a place type's term from the `place_types` entry with an `http` or `https` `external.uri` that names a host, labelled with `external.label`, else the entry's label in the site's language. A code without such an entry, and every code in an export without `vocabulary.json`, falls back to the engine's table, which gives a Getty AAT term for `city`, `river` and `region` only; any other code gets no `types`, so that output is unchanged. `external.scheme` is not written, as Linked Places has no member for it.
- **Repository names in search come from the record.** The repository facet and the result cards name a repository by its `display_title`, then its `short_name`, then its `name`, then its code.

### Deprecated

- The i18n key `graph.connectedToZasqua`, replaced by `graph.connectedToSite`. Removal in 2.0.0.
- The i18n keys `search.digitalStatus.inZasqua` and `search.digitalStatusPill.inZasqua`, replaced by `hosted`. Removal in 2.0.0.
- Running `zasqua import collectiveaccess` without `--entity-prefix` and `--place-prefix`. The importer still uses `ne-` and `nl-` and prints a notice; 2.0.0 will require both.
- **`themes/base/data/ui.yaml`**, for removal in 2.0.0. It is Spanish-only and the engine
  no longer reads it; it stays for instance themes that read `hugo.Data.ui.*` directly.
  Most keys have the same path in the i18n bundles (`hugo.Data.ui.nav.home` becomes
  `i18n "nav.home"`); the file's header lists the exceptions.
- **The palette token names.** `--color-burgundy`, `--color-burgundy-deep`,
  `--color-burgundy-light`, `--color-burgundy-dark`, `--color-pale-rose`,
  `--color-ochre`, `--color-sage` and `--color-periwinkle`, and their utility classes,
  remain as aliases of the role names and will be removed in 2.0.0.
- **The default web fonts.** Linking DM Sans, Crimson Text and Cormorant Garamond when
  `font_stylesheets` is unset will stop in 2.0.0; sites that use those fonts should
  name them in `font_stylesheets`.
- **The graph color defaults.** In 2.0.0 the defaults of `--graph-corporate`,
  `--graph-document` and the other graph colors that do not follow a role token become
  neutral greys.
- **Parsing an item number from the reference code** in the collection tree, used when a
  record has no `local_identifier` key. It is isolated in one function in `tree.js` and
  will be removed in 2.0.0; exports should carry `local_identifier`.

### Removed

- **`REPO_NAME_OVERRIDES`** in `scripts/generate-pagefind-indices.js`, which gave one repository a fixed name in search. That repository is named from its record, as every other one is.

### Fixed

- **WHG links reach the place.** The place page linked a `whg_id` to `whgazetteer.org/places/<id>/portal`, which the World Historical Gazetteer answers with a not-found page. It links to `/places/<id>/detail`, the address the Linked Places export already uses.
- **The entity page no longer links `dbe_id`.** The link went to `dbe.rah.es/biografias/<id>`, which the Real Academia de la Historia now redirects to the home page of its Historia Hispánica site, so it reached no biography. The field stays in the contract and the EAC-CPF output is unchanged; an entity with only a `dbe_id` has no external-identifiers section.
- **Entity date facets read full dates.** An entity whose `date_earliest` or `date_latest` was a full date (`YYYY-MM-DD`), which the contract allows, got no century or decade in the entity explorer, and its result card showed the full dates. Both now read the year from either form.
- **A blank `functions` no longer stops `zasqua eac`.** An entity whose `functions` is
  an empty string, as Fisqua writes it, is read as having none, instead of being skipped
  with "functions must be an array".
- **Year 0000 is refused in EAC-CPF dates.** The number 0 already was, but the strings
  "0000" and "0000-01" passed and produced records that fail the schema.
- **`zasqua mets`, `zasqua eac` and `zasqua places` no longer leave earlier records
  behind.** Each removes the files of its own kind from its output directory before
  writing, so a record dropped from the input loses its file, and `places/index.json`
  agrees with the per-place files. A run that fails on its input leaves the previous
  output in place. None of the three will clear the site root or `public/` itself.
- **Seventeen more roles have labels.** Thirteen entity roles (fiador, apoderado,
  albacea, heir, donor, spouse, grantor, victim, mortgagee, mortgagor, editor,
  photographer, artist) and four place roles (sent_from, sent_to, created, published)
  appeared on pages as their raw keys. The entity explorer's role filter lists roles
  that belong to no group under "Other"; before, they didn't appear in the filter.
- **Pages keep inside the window at every width.** Tailwind generated its own
  `container` utility, which overrode the engine's width rule, so pages were 768px wide
  in a 1,000px window and grew past `--max-width` above 1,280px. The header no longer
  overlaps between the hamburger breakpoint and about 1,100px: the logo keeps its width
  and the search field narrows instead. The two columns of entity and place pages no
  longer run 32px past the page between 769px and 1,200px, and the homepage hero fits
  on phones.
- **"1 description", not "1 descriptions".** The intro on an entity page now has a
  singular form. In Spanish, the error shown when linked descriptions fail to load
  addresses the reader with "tú", as the rest of the interface does.
- **The fallback engine version is current.** `themes/base/data/engine.yaml` said 1.4.0. It now says 1.6.0, and a test requires it to equal the version in `package.json`.
- **No 0001-01-01 date on records without `modified_at`.** Description, entity and place pages printed that date when a record had no `modified_at`; the last-updated line is now left out. A description page still shows `date_of_description` when the record has one.

## [1.5.0] — 2026-10-24

### Added

- **A new `zasqua eac` command writes one EAC-CPF record per entity.** Each
  person, corporate body and family in `entities.json` gets an EAC-CPF 2010
  authority record, carrying its names and name variants, dates of existence,
  functions, history and any VIAF or Wikidata identifiers, so other archival
  systems can take the entities in the standard they use for authority
  records. Like `zasqua mets`, the command runs apart from the site build and
  writes to `EAC_DIR` (by default `public/eac/`, served with the site); the
  maintenance agency, agency code and record language come from new `eac_*`
  settings in `hugo.toml`, and `eac_base_url` names the host the records are
  served from; when it is an absolute URL and the output would land under
  `public/`, the command warns that the records would be served with the
  site instead. The records carry no timestamps, so an unchanged export
  produces identical files.
- **A new `zasqua places` command writes one Linked Places file per
  place.** Each place in `places.json` gets a Linked Places Format record (the
  GeoJSON-LD format gazetteers such as the World Historical Gazetteer
  ingest), carrying its names, feature class and type, coordinates, any WHG,
  TGN or Wikidata identifiers, and the span of years in which the archive's
  dated descriptions mention it. Alongside the per-place files the command
  writes `index.json`, every dated place in one collection, ready for a
  gazetteer's bulk upload; a place that no dated description mentions is
  published only as its own file, which is not a conformant record, since the
  format requires a `when` or a citation year on every place. Like `zasqua eac`, it runs apart from the site
  build and writes to `PLACES_DIR` (by default `public/places/`). A new
  `places_language` setting in `hugo.toml` sets the language of the place
  names, and `places_base_url` names the host the records are served from,
  with the same warning as `eac_base_url`. An unchanged export produces
  identical files.
- **Entity and place pages link to their EAC-CPF and Linked Places
  records.** When a site sets `eac_base_url` or `places_base_url` in
  `hugo.toml`, the reuse section of each entity or place page shows the URL
  of its record (`{eac_base_url}/{entity_code}.xml` or
  `{places_base_url}/{place_code}.json`) with a copy button, as description
  pages already do for METS. A trailing slash on either setting is dropped.
  When a setting is unset, the page keeps its "Coming soon" note; a site that
  serves the records with its pages sets `/eac` and `/places`, the default
  output directories.

The six-file data contract (v1.0) is unchanged. The entity schema now lists
the optional `wikidata_id` field, and the place schema the optional `label`
and `fclass` fields; `zasqua places` skips a place without a valid
`fclass`. The data contract reference notes which EAC-CPF or Linked Places
element each entity and place field feeds.

## [1.4.1] — 2026-07-07

### Changed

- **Very short free-text search terms are no longer sent to Pagefind.** Search
  terms under three characters previously triggered the same full-corpus
  ranking pass as any other query. Pagefind ranks every matching record before
  slicing off the displayed page, with no cheaper mode for very large result
  sets, so a short, common fragment could take noticeably longer to return
  than a typical search. The minimum length applies only to the free-text
  search box; filter selections are unaffected.

## [1.4.0] — 2026-07-06

### Changed

- **Entity network graph expansion is now fast and data-driven.** Expanding an
  entity in the co-occurrence graph now reads each neighbour's name, type, and
  linked-record count from a single structured index file
  (`static/data/entity-index.json`), fetched once and reused for every
  expansion. Previously this metadata was read out of each entity's rendered
  page one request at a time; on large graphs, against a production host, that
  could take twenty to forty-five seconds. Expansion is now near-instant.
- **The deep-zoom image viewer attaches its custom controls more reliably.** The
  self-hosted TIFY viewer now adds its custom toolbar controls (expand, collapse,
  full screen, thumbnails) the moment the viewer signals it is ready, rather than
  after a fixed delay. The old delay could fire before a large document had
  finished rendering — leaving the custom controls missing — or wait needlessly
  on a small one. The thumbnails (Miniaturas) toggle is now driven through the
  viewer's public interface and reads the panel's open or closed state live, so
  it stays in step with the viewer's own keyboard shortcut for thumbnails.

### Fixed

- **Century and decade counts in the date filter are correct for records whose
  dates span a boundary.** The century → decade → year facet tree now counts each
  record once per century and decade it covers, using the counts the search
  indexer produces, rather than adding up year-level counts — which over- or
  under-counted a record whose date range crossed a century or decade boundary.
  Century rows now look their counts up by the same Roman-numeral key the indexer
  emits (for example `XVIII`), so century totals render correctly.
- **Client-side HTML escaping now also escapes single quotes.** The escaping
  helpers used when the place timeline builds its markup now escape `'` alongside
  `&`, `<`, `>`, and `"`, matching the standard escape set.
- **Deployment guide correction.** The guide now states correctly that the
  Cloudflare Worker and R2 upload tooling belong to the site instance, not the
  engine.

## [1.3.0] — 2026-06-09

### Added

- METS generation, as a new `zasqua mets` command. It writes one METS 1.12.1
  XML document per description (Dublin Core descriptive metadata) to a
  configurable output directory, making the reuse section's "uses the METS
  standard for metadata" claim resolve to a real file on every description
  page. The command is independent of the Hugo build — it reads `exports/`
  and `hugo.toml`, not the rendered site — so a deployment can generate and
  upload METS on its own step and to its own host. By default it writes
  `public/mets/{reference_code}.xml` (served with the site); a deployment with
  a separate manifests host sets `METS_DIR` and `mets_base_url` accordingly.
  Until now METS was produced by a separate, now-retired cataloging backend;
  bringing generation into the engine removes that external dependency.
  Generation is deployment-agnostic — every institution-specific value is
  deployer-owned configuration in `hugo.toml [params]`:
    - `mets_creator_name` (defaults to the site `title`) and `mets_creator_url`
      (defaults to `about_url`/`source_url`) — the METS CREATOR agent.
    - `mets_default_rights` — an optional house `dc:rights` fallback.
    - `mets_base_url` — the public METS URL base for the reuse-section link.
  `dc:rights` is data-driven: the repository's `image_reproduction_text` for a
  digitised item, else the record's own reproduction/access conditions, else
  the optional house default, else omitted. No institution name or rights text
  is hardcoded. The metsHdr carries no `CREATEDATE` (a build-time creation date
  is meaningless and would make output non-deterministic).
- IIIF passthrough in METS. When a description carries an `iiif_manifest_url`
  (a deployer-supplied field), the METS document points at it from `<fileSec>`.
  The engine never generates IIIF tiles or manifests — it only references what
  the deployer supplies.

### Fixed

- The Miller-column hierarchy tree no longer renders empty when a contract
  export sets `parent_reference_code` but leaves `parent_id` null — common
  for data produced outside the original cataloging backend.
  `derive-children` now resolves the parent through a reference-code → id
  map when the numeric id is absent, keying the children shard by the
  resolved id.
- Repository landing pages now show their top-level descriptions (the first
  Miller column) straight from a fresh six-file export. `root_descriptions`
  is auto-derived per repository — the descriptions with no parent — when
  the deployer did not supply one. An explicit `root_descriptions` is
  respected and never overwritten.

The six-file data contract (v1.0) is unchanged. `mets_url` is engine-derived
from `mets_base_url` and need not be supplied; when `mets_base_url` is unset a
deployer-supplied `mets_url` is respected. The descriptions' optional
`creator_display`, `place_display`, and `imprint` fields (populated by upstream
cataloging) now feed `dc:creator`, `dc:subject`, and `dc:publisher`, and the
repository `image_reproduction_text` field now also feeds digitised `dc:rights`.

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

[1.6.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.6.0
[1.5.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.5.0
[1.4.1]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.4.1
[1.4.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.4.0
[1.3.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.3.0
[1.2.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.2.0
[1.1.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.1.0
[1.0.2]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.2
[1.0.1]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.1
[1.0.0]: https://github.com/UCSB-AMPLab/zasqua/releases/tag/v1.0.0
