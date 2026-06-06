/**
 * i18n Key Registry — Canonical Chrome Key Set
 *
 * This module is the single source of truth for every i18n key referenced by
 * the engine's base-theme templates. It exports one constant, REQUIRED_KEYS,
 * which lists every dotted-path leaf key that must be present in any i18n
 * bundle shipped with the engine.
 *
 * Two consumers depend on this list:
 *
 *   1. tests/i18n.test.js — the CI key-parity gate that asserts every
 *      key here appears in both es.toml and en.toml, and that neither bundle
 *      contains more keys than the other (the two bundles must hold identical
 *      key sets).
 *
 *   2. lib/validator.js validateBundle — the per-instance build gate
 *      that checks the selected language bundle covers all required keys
 *      before allowing the Hugo build to proceed.
 *
 * Every new key added to a template in themes/base/layouts/ MUST also
 * be added here. This is the authoritative registry; the TOML bundles and
 * their tests are derived from it. The list below is the exact leaf-key set of
 * es.toml after the single-source consolidation: a shared [ui] chrome
 * section, per-surface explorer keys, and two dead "view all linked
 * descriptions" entity/place keys removed. It mirrors en.toml one-for-one.
 *
 * Plural tables (e.g., tree.childUnit with one/other sub-keys) contribute a
 * single entry at the table path (tree.childUnit), not separate entries for
 * each CLDR category. The test's flattenKeys helper uses the same convention:
 * a TOML object whose only keys are CLDR categories (one/other/few/many/
 * zero/two) is treated as a single terminal key. This applies to the
 * count keys ui.linkedDocLabel, entity.sharedDocsSentence,
 * entity.connectedOtherDocs, entity.resultDocCount, entity.countLabel — each
 * registered once at its table path.
 *
 * @version v0.6.0
 */

'use strict';

/**
 * All i18n keys referenced in themes/base/layouts/ templates and the
 * client JS files that read them from data-i18n attributes. Dotted notation
 * matching the TOML bundle structure.
 *
 * @type {string[]}
 */
const REQUIRED_KEYS = [
  // nav
  'nav.home',
  'nav.search',
  'nav.about',
  'nav.catalogacion',
  'nav.browse',
  'nav.documents',
  'nav.entities',
  'nav.places',

  // error404
  'error404.title',
  'error404.message',
  'error404.home',
  'error404.search',

  // breadcrumb
  'breadcrumb.home',

  // search
  'search.placeholder',
  'search.button',
  'search.results',
  'search.noResults',
  'search.clearFilters',
  'search.filtersHeader',
  'search.sidebarHeading',
  'search.sidebarSearch',
  'search.filterToggle',
  'search.noResultsSuggestion',
  'search.dateFrom',
  'search.dateTo',
  'search.viewAll',
  'search.loadingFilters',
  'search.landingP1',
  'search.landingP2',
  'search.browsePromptCount',
  'search.refinePlaceholder',
  'search.opYes',
  'search.opNo',
  'search.addTextFilter',
  'search.advancedActive',
  'search.advancedDisable',
  'search.advancedActivate',
  'search.advancedActivateNote',
  'search.dateInitial',
  'search.notPrefix',
  'search.onlyNotMessage',
  'search.resultsCount',
  'search.retry',
  'search.facetAncestor',
  'search.facetEntity',
  'search.digitalStatus.group',
  'search.digitalStatus.inZasqua',
  'search.digitalStatus.external',
  'search.digitalStatus.none',
  'search.digitalStatusPill.inZasqua',
  'search.digitalStatusPill.external',
  'search.digitalStatusPill.none',
  'search.sort.label',
  'search.sort.relevance',
  'search.sort.dateAsc',
  'search.sort.dateDesc',
  'search.sort.titleAsc',
  'search.sort.title',
  'search.sort.code',
  'search.sort.date',

  // facets
  'facets.repository',
  'facets.level',
  'facets.dateRange',
  'facets.hasDigital',
  'facets.country',

  // recordMeta
  'recordMeta.descriptionDateLabel',
  'recordMeta.descriptionDateValue',

  // description
  // metadataHeader, bibliographicHeader, accessConditionsHeader, relatedMaterialsHeader,
  // notesHeader, controlHeader, reuseHeader migrated to the standards profiles.
  // entitiesHeader, placesHeader, childrenHeader are cross-standard — kept here.
  'description.entitiesHeader',
  'description.placesHeader',
  'description.metsLabel',
  'description.iiifLabel',
  'description.childrenHeader',
  'description.previous',
  'description.next',
  'description.notDigitised',
  'description.notDigitisedText',
  'description.externalDigital',
  'description.externalDigitalText',
  'description.viewAllChildren',
  'description.catalogSubheading',
  'description.catalogFreeAccess',
  'description.imagesSubheading',
  'description.reuseBlurbIiif',
  'description.reuseBlurb',
  'description.originalsSubheading',
  'description.searchUnit',
  'description.copyButton',
  'description.copied',
  'description.tifyExpand',
  'description.tifyCollapse',
  'description.tifyFullscreen',
  'description.tifyExitFullscreen',
  'description.tifyThumbnails',

  // entity
  'entity.noFunctionsRecorded',
  'entity.breadcrumbParent',
  'entity.timelineHeader',
  'entity.linkedDescriptions',
  'entity.noLinkedDescriptions',
  'entity.shardError',
  'entity.noDateLabel',
  'entity.explorerTitle',
  'entity.explorerIntro',
  'entity.selectPrompt',
  'entity.viewportFilterLabel',
  'entity.viewportFilterActive',
  'entity.viewInExplorer',
  'entity.reuseBlurb',
  'entity.comingSoon',
  'entity.timelineTab',
  'entity.graphTab',
  'entity.exploreAll',
  'entity.filterByRole',
  'entity.graphEmpty',
  'entity.timelineFilteredEmpty',
  'entity.openInExplorer',
  'entity.focalRoleTitle',
  'entity.variantsLabel',
  'entity.cardEyebrow',
  'entity.cardLink',
  'entity.deselect',
  'entity.searchPlaceholder',
  'entity.searchAria',
  'entity.noResults',
  'entity.noResultsSuggestion',
  'entity.errorTitle',
  'entity.errorHint',
  'entity.calculatingTotal',
  'entity.overloadCount',
  'entity.landingCount',
  'entity.overloadHint',
  'entity.landingHint',
  'entity.facetEntityType',
  'entity.facetPrimaryFunction',
  'entity.filterToggle',
  'entity.sections.identification',
  'entity.sections.functions',
  'entity.sections.history',
  'entity.sections.relations',
  'entity.sections.authorityLinks',
  'entity.sections.control',
  'entity.sections.reuse',
  'entity.sections.sources',
  'entity.fields.entityCode',
  'entity.fields.name',
  'entity.fields.normalizedName',
  'entity.fields.type',
  'entity.fields.datesOfExistence',
  'entity.fields.primaryFunction',
  'entity.fields.nameVariants',
  'entity.fields.history',
  'entity.fields.roleInDocument',
  'entity.authorityLinks.dbe',
  'entity.authorityLinks.viaf',
  'entity.emptyState.prose1',
  'entity.emptyState.prose2',
  'entity.legend.person',
  'entity.legend.corporate',
  'entity.legend.corporateFamily',
  'entity.legend.docExpandable',
  'entity.legend.docPlain',
  'entity.legend.docFilled',
  'entity.legend.doc',
  'entity.focal.intro',
  'entity.focal.viewTimeline',
  'entity.focal.viewGraph',
  'entity.focal.viewSearch',
  'entity.focal.sep',
  'entity.focal.tail',
  'entity.sharedDocsSentence',
  'entity.connectedOtherDocs',
  'entity.resultDocCount',
  'entity.countLabel',

  // place
  'place.breadcrumbParent',
  'place.timelineHeader',
  'place.map',
  'place.linkedDescriptions',
  'place.noLinkedDescriptions',
  'place.shardError',
  'place.noDateLabel',
  'place.noCoordinatesTitle',
  'place.noCoordinatesText',
  'place.explorerTitle',
  'place.explorerIntro',
  'place.explorerExamplesPrefix',
  'place.explorerExamplesConj',
  'place.selectPrompt',
  'place.viewportFilterLabel',
  'place.viewInExplorer',
  'place.reuseBlurb',
  'place.comingSoon',
  'place.associatedTo',
  'place.loadingPlaces',
  'place.errorTitle',
  'place.errorHint',
  'place.searchPlaceholder',
  'place.clusterCount',
  'place.cardLink',
  'place.countNoFilter',
  'place.countOne',
  'place.countMany',
  'place.sortChrono',
  'place.sortAlpha',
  'place.viewportFilterActive',
  'place.linkedDescriptionsCount',
  'place.noResultsTitle',
  'place.noResultsText',
  'place.zeroDocs',
  'place.coordsTitle',
  'place.authorityBadge',
  'place.authorityTitle',
  'place.facetType',
  'place.facetCoords',
  'place.facetCoordsOnly',
  'place.facetAuthorities',
  'place.facetAuthorityOnly',
  'place.pillCoords',
  'place.pillAuthorities',
  'place.filteredEmpty',
  'place.sections.identification',
  'place.sections.externalIds',
  'place.sections.control',
  'place.sections.reuse',
  'place.fields.name',
  'place.fields.type',
  'place.fields.placeCode',
  'place.fields.nameVariants',
  'place.fields.coordinates',
  'place.fields.countryCode',
  'place.document',
  'place.countries.COL',
  'place.countries.PER',
  'place.countries.BOL',
  'place.countries.ECU',
  'place.countries.VEN',
  'place.countries.ARG',
  'place.countries.BRA',
  'place.countries.CHL',
  'place.countries.MEX',
  'place.countries.USA',
  'place.countries.ESP',
  'place.countries.FRA',
  'place.countries.GBR',
  'place.countries.PAN',

  // fields — all ISAD(G) descriptive field labels migrated to the standards profiles;
  // this entire block removed from both REQUIRED_KEYS and the TOML bundles.

  // repository
  'repository.itemsCount',
  'repository.dateRange',
  'repository.collections',
  'repository.noCollections',
  'repository.searchCollection',

  // footer
  'footer.copyright',
  'footer.colofon_link_text',
  'footer.sourceLink',

  // general
  'general.loading',
  'general.error',
  'general.viewMore',
  'general.back',

  // ui
  'ui.removeFilter',
  'ui.pagination',
  'ui.closeFilters',
  'ui.sortBy',
  'ui.retry',
  'ui.centuryLabel',
  'ui.decadeLabel',
  'ui.dateConnector',
  'ui.selectedClose',
  'ui.browsePromptWarning',
  'ui.browsePromptHint',
  'ui.linkedDocLabel',
  'ui.sortName',
  'ui.sortDate',
  'ui.sortDocs',
  'ui.clearShort',
  'ui.facetModalSearch',

  // tree
  'tree.contentLabel',
  'tree.filterPlaceholder',
  'tree.viewRecord',
  'tree.childUnit',
  'tree.childUnitCompuesta',
  'tree.childUnitSimple',

  // graph
  'graph.expand',
  'graph.loading',
  'graph.more',
  'graph.docsMore',
  'graph.loadNextBatch',
  'graph.refocus',
  'graph.linkedDocs',
  'graph.overflowDocs',
  'graph.connectedTo',
  'graph.connectedToZasqua',
];

module.exports = { REQUIRED_KEYS };

// Version: v0.6.0
