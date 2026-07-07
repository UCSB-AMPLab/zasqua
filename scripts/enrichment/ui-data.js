/**
 * Role-label vocabulary (Colombian Spanish) — enrichment-only
 *
 * The canonical Colombian-Spanish labels for entity-document role
 * relationships (Productor, Testigo, Escribano…). Read by
 * `scripts/generate-content.js`, which is the ONLY consumer: it maps
 * each enriched description record's role codes onto these labels.
 *
 * This file carries ONLY the `roles` table — the one string set the
 * enrichment step needs at content-generation time, before the Hugo data
 * layer exists. Every other UI string (navigation, search, explorer,
 * description-level, error copy) lives solely in the i18n bundles
 * (`themes/base/i18n/{es,en}.toml`) and the render-time vocabulary in
 * `themes/base/data/ui.yaml` — do not add another block here; doing so
 * puts the same Spanish string in two places again. Role labels are also
 * present in `ui.yaml` for template render; this enrichment copy is the
 * build-step twin, not a duplicate surface string.
 *
 * @version v1.4.0
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

// Version: v1.4.0
