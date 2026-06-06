/**
 * Role-label vocabulary (Colombian Spanish) — enrichment-only
 *
 * The canonical Colombian-Spanish labels for entity-document role
 * relationships (Productor, Testigo, Escribano…). Read by
 * `scripts/generate-content.js`, which is the ONLY consumer: it maps
 * each enriched description record's role codes onto these labels.
 *
 * This file once carried the full UI string table — navigation,
 * search, explorer, description-level, and error copy — but those
 * surfaces now read their strings from the i18n bundles
 * (`themes/base/i18n/{es,en}.toml`) and the render-time vocabulary in
 * `themes/base/data/ui.yaml`. Keeping a second copy here meant every
 * Spanish string lived in two places, so the strings were consolidated
 * to a single source and every block was removed except `roles`, which
 * the enrichment step still needs at content-generation time (before the
 * Hugo data layer exists). Role labels themselves are also present in
 * `ui.yaml` for template render; this enrichment copy is the build-step
 * twin, not a duplicate surface string.
 *
 * @version v2.0.0
 */

module.exports = {
  // Entity roles (complete role vocabulary)
  roles: {
    // Core roles (existing 5)
    creator: "Productor",
    contributor: "Colaborador",
    publisher: "Editor",
    subject: "Materia",
    mentioned: "Mencionado",
    // Extended roles from entity_links.json
    sender: "Remitente",
    recipient: "Destinatario",
    defendant: "Demandado",
    plaintiff: "Demandante",
    witness: "Testigo",
    official: "Oficial",
    scribe: "Escribano",
    notary: "Notario",
    judge: "Juez",
    author: "Autor",
    buyer: "Comprador",
    seller: "Vendedor",
    guarantor: "Fiador",
    petitioner: "Solicitante",
    appellant: "Apelante",
    executor: "Albacea",
    guardian: "Tutor",
    attorney: "Apoderado",
    interpreter: "Intérprete",
    appraiser: "Tasador",
    lessee: "Arrendatario",
    lessor: "Arrendador",
    debtor: "Deudor",
    creditor: "Acreedor"
  }
};

// Version: v2.0.0
