/**
 * Entity and Place Link Enrichment
 *
 * This module deals with turning the compact reverse-lookup files
 * produced by `precompute-links.js` into template-ready link records.
 * The reverse-lookup file for entities maps a description's reference
 * code to an array of `{ code, display_name, entity_type, roles: [] }`
 * entries — already denormalised with display names, but the `roles`
 * are still English slugs (`"sender"`, `"creator"`). Templates need
 * Colombian Spanish labels ("Remitente", "Productor"). This module
 * applies the translation using a `roles` map passed in by the caller
 * (the role-label vocabulary in `scripts/enrichment/ui-data.js`) and
 * renames the `code` field to `entity_code` to match the contract
 * expected by the tests.
 *
 * `enrichEntityLinks` returns an array of `{ entity_code, display_name,
 * entity_type, roles, role_label }` records. `role_label` is the
 * translated label for the first role in the slug list — the public
 * template shows a single role label per chip, even when the entity
 * plays multiple roles in the same document. The `roles` slug array is
 * preserved so future UI work can expand to show all of them without
 * re-running enrichment.
 *
 * `enrichPlaceLinks` does no role translation (places don't carry
 * roles) — it passes the records through unchanged.
 *
 * @version v1.0.0
 */

'use strict';

function enrichEntityLinks(referenceCode, descEntityLookup, rolesMap) {
  const raw = descEntityLookup[referenceCode] || [];
  return raw.map(entry => {
    const primarySlug = (entry.roles && entry.roles[0]) || null;
    const role_label = primarySlug ? (rolesMap[primarySlug] || primarySlug) : '';
    return {
      entity_code: entry.code,
      display_name: entry.display_name,
      entity_type: entry.entity_type,
      roles: entry.roles || [],
      role_label,
    };
  });
}

function enrichPlaceLinks(referenceCode, descPlaceLookup) {
  const raw = descPlaceLookup[referenceCode] || [];
  return raw.map(entry => ({
    place_code: entry.place_code,
    display_name: entry.display_name,
  }));
}

module.exports = { enrichEntityLinks, enrichPlaceLinks };
