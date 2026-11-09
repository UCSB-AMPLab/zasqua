'use strict';

/**
 * Generate METS XML Documents from the Description Contract
 *
 * Zasqua's reuse section tells visitors the archive "uses the METS standard
 * for metadata" and offers a per-record METS link. This script makes that
 * claim true from inside the engine: it writes one METS 1.12.1 XML document
 * per description, carrying Dublin Core descriptive metadata, so every
 * description page's METS link resolves to a real file.
 *
 * Until v1.2.0 METS was produced by a separate, now-retired cataloguing
 * backend and uploaded to a private host. Bringing generation into the engine
 * removes that external dependency and keeps the published claim honest for
 * any deployment, not just the original one. It is invoked as the `zasqua mets`
 * subcommand — independent of the Hugo build (it reads exports/ + hugo.toml,
 * not the rendered site), so the instance can generate and upload METS on its
 * own step/cadence and a METS failure never blocks a site deploy.
 *
 * Deployment-agnostic by construction: the backend hardcoded one foundation
 * as the METS CREATOR agent and a fixed rights statement. Here every such
 * value is deployer-owned config from hugo.toml [params] (mets_creator_name,
 * mets_creator_url, mets_default_rights, mets_base_url), defaulting to the site
 * `title` / about/source URL. dc:rights is data-driven (plan §4.2): per-repo
 * image_reproduction_text for digitised items, else the record's own
 * reproduction/access conditions, else an optional house default, else omit.
 * No institution name, bucket, or rights text is baked into the engine.
 *
 * No metsHdr/@CREATEDATE: a build-time creation date is meaningless and would
 * make output non-deterministic; the attribute is optional in METS.
 *
 * IIIF is never generated here. `iiif_manifest_url` is a deployer-supplied
 * field; when present it is passed through into <fileSec> so the METS points
 * at the manifest. The engine does not mint IIIF tiles or manifests.
 *
 * Output location is wrapper-specified (METS_DIR), exactly as Hugo's publishDir
 * is for HTML. A single-bucket deployer writes the default public/mets/ (served
 * with the site); a deployer with a separate manifests host
 * sets METS_DIR outside public/ and uploads it there. The per-record link is set
 * by generate-content.js from the same mets_base_url, so links and files agree.
 *
 * Before writing, the run removes the earlier `*.xml` files directly inside
 * METS_DIR (other extensions and subdirectories stay) and logs how many it removed,
 * so a record dropped from the input does not leave its file behind. The removal
 * happens after the inputs are read and checked, so a run that fails early leaves
 * the previous output in place.
 *
 * Reads:
 *   exports/descriptions.json   — the flat array of all archival records
 *   exports/repositories.json   — for the CUSTODIAN agent, dc:source, repo rights
 *   exports/publisher.json      — optional; its legal_name, tax_id, location and
 *                                 website replace mets_creator_name / _url
 *   hugo.toml [params]          — METS config (see readMetsConfig)
 * Writes:
 *   {METS_DIR}/{slug}.xml       — one METS document per description
 *     (slug = reference_code with ? and # stripped, matching the permalink)
 *
 * Env flags:
 *   INSTANCE_ROOT  — path to the instance directory; defaults to process.cwd().
 *                    Set by the Zasqua CLI so exports/ and public/ resolve to
 *                    the instance when the engine lives in node_modules.
 *   DATA_DIR       — override the default exports directory (absolute path).
 *   METS_DIR       — override the default public/mets output directory.
 *
 * @version v1.6.0
 */

const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');
const { loadStandardData } = require('../lib/standards');
const { loadManifest } = require('../lib/manifest');
const { siteLanguage } = require('../lib/site-language');
const { readPublisher, publisherLine, pickLang } = require('../lib/publisher');

const INSTANCE_ROOT = process.env.INSTANCE_ROOT || process.cwd();
const DATA_DIR = process.env.DATA_DIR || path.join(INSTANCE_ROOT, 'exports');
const METS_DIR = process.env.METS_DIR || path.join(INSTANCE_ROOT, 'public', 'mets');

// ---------------------------------------------------------------------------
// Namespaces (declared once on the root element)
// ---------------------------------------------------------------------------

const NS_METS = 'http://www.loc.gov/METS/';
const NS_XLINK = 'http://www.w3.org/1999/xlink';
const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_DCTERMS = 'http://purl.org/dc/terms/';

// ---------------------------------------------------------------------------
// Description level → Dublin Core type mapping
//
// The map lives in the descriptive-standard profiles (`dc_types` in
// themes/base/data/standards/*.yaml): aggregate levels are Collection, leaf
// bibliographic levels (item, volume) are Text. `DC_TYPE_MAP` is the ISAD(G)
// map, kept as an export; buildMets looks the type up under the record's own
// standard (repository, then description), so a site can change it in its
// copy of the profile.
// ---------------------------------------------------------------------------

const DC_TYPE_MAP = loadStandardData('isadg').dc_types;

function dcTypeOf(desc, repo, level, opts) {
  const standard = (repo && repo.descriptive_standard) || desc.descriptive_standard || 'isadg';
  return loadStandardData(standard, opts && opts.instanceRoot).dc_types[level] || '';
}

// ---------------------------------------------------------------------------
// XML escaping
//
// METS values come from free-text archival fields, so every value must be
// escaped. Element text escapes &, <, > ; attribute values additionally
// escape the double quote that delimits them.
// ---------------------------------------------------------------------------

function escapeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

/**
 * Derive the on-disk slug / permalink stem from a reference code. Mirrors the
 * permalink the Hugo site renders (reference_code with ? and # removed) so the
 * file path matches the mets_url that generate-content.js writes.
 *
 * @param {string} referenceCode
 * @returns {string}
 */
function metsSlug(referenceCode) {
  return String(referenceCode || '').replace(/[?#]/g, '');
}

/**
 * Build a Dublin Core element line, or '' when the value is blank.
 * Indented to sit inside <xmlData>.
 *
 * @param {string} qname — qualified name, e.g. "dc:title" or "dcterms:isPartOf"
 * @param {*} value
 * @returns {string}
 */
function dcLine(qname, value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return `        <${qname}>${escapeText(text)}</${qname}>\n`;
}

// ---------------------------------------------------------------------------
// METS document builder (pure — exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Resolve a record's dc:rights text from the data, with no institution text
 * written into the engine:
 *   1. digitised item → the repository's `attribution` in opts.language, else
 *      its `image_reproduction_text`
 *   2. else the record's own reproduction/access conditions (ISAD(G) 3.4.2/3.4.1)
 *   3. else the repository's `catalogue_licence`
 *   4. else the deployer's optional house default (opts.defaultRights)
 *   5. else '' (omit)
 * Bilingual members fall back to the other language when the chosen one is
 * empty. opts.language is the site's language base subtag (default 'es').
 *
 * @param {object} desc
 * @param {object|null} repo
 * @param {object} opts — { defaultRights, language }
 * @returns {string}
 */
function computeRights(desc, repo, opts) {
  const lang = opts.language || 'es';
  if (desc.has_digital && repo) {
    const credit = pickLang(repo.attribution, lang) || pickLang(repo.image_reproduction_text, lang);
    if (credit) return credit;
  }
  const conditions = desc.reproduction_conditions || desc.access_conditions;
  if (conditions) return conditions;
  // The repository's catalogue licence stands where the house default would.
  return catalogueLicenceText(repo, lang) || opts.defaultRights || '';
}

/**
 * The repository's catalogue licence as "<label> (<uri>)", the uri alone when
 * there is no label, the label alone when there is no uri, or ''.
 */
function catalogueLicenceText(repo, lang) {
  const licence = repo && repo.catalogue_licence;
  if (!licence || typeof licence !== 'object') return '';
  const label = pickLang(licence.label, lang);
  const uri = typeof licence.uri === 'string' ? licence.uri.trim() : '';
  if (label && uri) return `${label} (${uri})`;
  return uri || label;
}

/**
 * Build a METS 1.12.1 XML document for a single description.
 *
 * @param {object} desc — a description record from the contract
 * @param {object|null} repo — the holding repository record, or null
 * @param {object} opts
 * @param {string} opts.creatorName — CREATOR agent name (deploying institution)
 * @param {string} [opts.creatorNote] — CREATOR agent note (about/source URL)
 * @param {string} [opts.defaultRights] — optional house dc:rights fallback
 * @param {string} [opts.language] — site language base subtag for bilingual fields
 * @returns {string} a complete METS XML document
 */
function buildMets(desc, repo, opts) {
  const ref = desc.reference_code || '';
  const title = desc.title || '';
  const level = desc.description_level || '';

  // ---- Root <mets> with all namespace declarations ----
  let rootAttrs =
    `xmlns="${NS_METS}"` +
    ` xmlns:xlink="${NS_XLINK}"` +
    ` xmlns:dc="${NS_DC}"` +
    ` xmlns:dcterms="${NS_DCTERMS}"` +
    ` OBJID="${escapeAttr(ref)}"` +
    ` LABEL="${escapeAttr(title)}"`;
  if (level) rootAttrs += ` TYPE="${escapeAttr(level)}"`;
  rootAttrs += ` PROFILE="http://www.loc.gov/standards/mets/profiles/"`;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<mets ${rootAttrs}>\n`;

  // ---- <metsHdr> with CREATOR (deploying institution) + CUSTODIAN (repo) ----
  // No CREATEDATE: a build-time creation date is meaningless and would make
  // output non-deterministic (plan §4.3). The attribute is optional in METS.
  xml += `  <metsHdr>\n`;
  xml += `    <agent ROLE="CREATOR" TYPE="ORGANIZATION">\n`;
  xml += `      <name>${escapeText(opts.creatorName)}</name>\n`;
  if (opts.creatorNote) {
    xml += `      <note>${escapeText(opts.creatorNote)}</note>\n`;
  }
  xml += `    </agent>\n`;
  if (repo && repo.name) {
    xml += `    <agent ROLE="CUSTODIAN" TYPE="ORGANIZATION">\n`;
    xml += `      <name>${escapeText(repo.name)}</name>\n`;
    xml += `    </agent>\n`;
  }
  xml += `  </metsHdr>\n`;

  // ---- <dmdSec> Dublin Core (element order matches the retired backend) ----
  xml += `  <dmdSec ID="dmd-001">\n`;
  xml += `    <mdWrap MDTYPE="DC">\n`;
  xml += `      <xmlData>\n`;
  xml += dcLine('dc:title', title);
  xml += dcLine('dc:identifier', ref);
  xml += dcLine('dc:date', desc.date_expression);
  xml += dcLine('dc:description', desc.scope_content);
  // dc:creator — flattened display string (may be multi-value, ';'-joined);
  // populated by upstream cataloguing, not by `zasqua import` (plan §4.0).
  xml += dcLine('dc:creator', desc.creator_display);
  // Language is a plain string in the contract — pass it through verbatim.
  xml += dcLine('dc:language', desc.language);
  xml += dcLine('dc:format', desc.extent);
  xml += dcLine('dc:type', dcTypeOf(desc, repo, level, opts));
  // dc:source — repository name, plus city when known.
  if (repo && repo.name) {
    const source = repo.city ? `${repo.name}, ${repo.city}` : repo.name;
    xml += dcLine('dc:source', source);
  }
  // dc:rights — data-driven ladder, no hardcoded institution text (plan §4.2).
  xml += dcLine('dc:rights', computeRights(desc, repo, opts));
  // dc:subject — place display string (upstream-populated).
  xml += dcLine('dc:subject', desc.place_display);
  // dcterms:isPartOf — the parent reference code, when this is not a root.
  xml += dcLine('dcterms:isPartOf', desc.parent_reference_code);
  // dc:publisher — imprint for bibliographic items (upstream-populated).
  xml += dcLine('dc:publisher', desc.imprint);
  xml += `      </xmlData>\n`;
  xml += `    </mdWrap>\n`;
  xml += `  </dmdSec>\n`;

  // ---- <fileSec> — only when a deployer-supplied IIIF manifest is present ----
  const iiifUrl = (desc.iiif_manifest_url || '').trim();
  if (iiifUrl) {
    xml += `  <fileSec>\n`;
    xml += `    <fileGrp USE="IIIF manifest">\n`;
    xml += `      <file ID="iiif-manifest" MIMETYPE="application/ld+json">\n`;
    xml += `        <FLocat LOCTYPE="URL" xlink:href="${escapeAttr(iiifUrl)}"/>\n`;
    xml += `      </file>\n`;
    xml += `    </fileGrp>\n`;
    xml += `  </fileSec>\n`;
  }

  // ---- <structMap> logical ----
  xml += `  <structMap TYPE="logical">\n`;
  let divAttrs = '';
  if (level) divAttrs += ` TYPE="${escapeAttr(level)}"`;
  divAttrs += ` LABEL="${escapeAttr(title)}" DMDID="dmd-001"`;
  if (iiifUrl) {
    xml += `    <div${divAttrs}>\n`;
    xml += `      <fptr FILEID="iiif-manifest"/>\n`;
    xml += `    </div>\n`;
  } else {
    xml += `    <div${divAttrs}/>\n`;
  }
  xml += `  </structMap>\n`;

  xml += `</mets>\n`;
  return xml;
}

// ---------------------------------------------------------------------------
// METS config from hugo.toml [params] — all deployer-owned, no engine defaults
// that name any institution.
//
// Reads:
//   creatorName  ← params.mets_creator_name, else top-level `title`
//   creatorNote  ← params.mets_creator_url, else params.about_url||source_url
//   defaultRights← params.mets_default_rights (optional house dc:rights fallback)
//   language     ← zasqua.manifest.toml [ui] language (base subtag), else 'es'
//   metsBaseUrl  ← params.mets_base_url (trailing slashes stripped), else null
//                  (null = "unset"; consumers fall back to "/mets" — see the
//                  three-state mets_url derivation in generate-content.js)
//
// Degrades gracefully: a missing or unparseable hugo.toml yields a neutral
// creator name, no note, no default rights, and a null base — rather than a
// build crash. No institution string is ever baked in.
// ---------------------------------------------------------------------------

function readMetsConfig(instanceRoot) {
  const hugoTomlPath = path.join(instanceRoot, 'hugo.toml');
  let creatorName = 'Zasqua archive';
  let creatorNote = '';
  let defaultRights = '';
  let metsBaseUrl = null;
  let language = 'es';
  try {
    if (fs.existsSync(path.join(instanceRoot, 'zasqua.manifest.toml'))) {
      language = siteLanguage(loadManifest(instanceRoot)).base;
    }
  } catch (err) {
    console.warn(`[generate-mets] WARN: could not read the site language (${err.message}); using "es"`);
  }
  try {
    const cfg = parseToml(fs.readFileSync(hugoTomlPath, 'utf8'));
    const params = cfg.params || {};
    creatorName = String(params.mets_creator_name || cfg.title || creatorName);
    const note = params.mets_creator_url || params.about_url || params.source_url || '';
    if (note) creatorNote = String(note);
    if (params.mets_default_rights) defaultRights = String(params.mets_default_rights);
    if (params.mets_base_url) {
      metsBaseUrl = String(params.mets_base_url).replace(/\/+$/, '');
    }
  } catch (err) {
    console.warn(
      `[generate-mets] WARN: could not read METS config from ${hugoTomlPath} ` +
      `(${err.message}); using neutral defaults`
    );
  }
  return { creatorName, creatorNote, defaultRights, metsBaseUrl, language };
}

/**
 * Remove the `.xml` files directly inside `dir` and return how many were
 * removed. Each run writes the whole set again, so a file left from an
 * earlier run would otherwise stay behind for a record that is no longer in
 * the input. Only regular files with this extension are touched: other
 * extensions and subdirectories are left alone, and a missing directory
 * counts as empty.
 */
function clearOutputDir(dir) {
  // The output directory must be the generator's own. Clearing the site root
  // or public/ itself would take the build's sitemap and index files with it.
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(INSTANCE_ROOT) || resolved === path.resolve(INSTANCE_ROOT, 'public')) {
    throw new Error(`[generate-mets] refusing to clear ${resolved}: set the output directory to a folder of its own`);
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
  let removed = 0;
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.xml')) {
      fs.unlinkSync(path.join(dir, entry.name));
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Entry point: read the contract, write one METS file per description.
// ---------------------------------------------------------------------------

async function main() {
  const descriptionsPath = path.join(DATA_DIR, 'descriptions.json');
  const repositoriesPath = path.join(DATA_DIR, 'repositories.json');

  console.log(`[generate-mets] DATA_DIR: ${DATA_DIR}`);
  console.log(`[generate-mets] METS_DIR: ${METS_DIR}`);

  if (!fs.existsSync(descriptionsPath)) {
    throw new Error(`[generate-mets] required input missing: ${descriptionsPath}`);
  }

  const descriptions = JSON.parse(fs.readFileSync(descriptionsPath, 'utf8'));
  console.log(`[generate-mets] descriptions.json: ${descriptions.length} records`);

  // Repositories drive the CUSTODIAN agent and dc:source. Optional — a build
  // with an empty repositories.json simply omits those elements.
  const reposByCode = new Map();
  if (fs.existsSync(repositoriesPath)) {
    const repositories = JSON.parse(fs.readFileSync(repositoriesPath, 'utf8'));
    for (const r of repositories) reposByCode.set(r.code, r);
  }

  const config = readMetsConfig(INSTANCE_ROOT);
  const { defaultRights, metsBaseUrl, language } = config;
  let { creatorName, creatorNote } = config;
  // The publisher record names the legal entity behind the site; without a
  // legal_name the hugo.toml settings stand.
  const publisher = readPublisher(DATA_DIR);
  const publisherName = publisherLine(publisher);
  if (publisherName) {
    creatorName = publisherName;
    creatorNote = typeof publisher.website === 'string' ? publisher.website.trim() : '';
  }
  console.log(`[generate-mets] CREATOR agent: ${creatorName}`);

  // Orphan-trap warning: if the site will link METS off-domain (absolute
  // mets_base_url) but we are writing under the rendered site tree (public/),
  // the files served on-domain won't match the off-domain links. This is the
  // only process where both facts are known (METS_DIR is an env var the
  // validator cannot see), so the check lives here.
  const metsDirResolved = path.resolve(METS_DIR);
  const publicResolved = path.resolve(INSTANCE_ROOT, 'public');
  if (/^https?:\/\//i.test(metsBaseUrl || '') && metsDirResolved.startsWith(publicResolved)) {
    console.warn(
      `[generate-mets] WARN: mets_base_url is off-domain (${metsBaseUrl}) but METS_DIR ` +
      `resolves under public/ (${metsDirResolved}). The site will link off-domain to files ` +
      `served with the site — set METS_DIR outside public/ and upload it to the manifests host.`
    );
  }

  // Inputs are read and checked by now, so a run that failed earlier has not
  // emptied the directory. Clear the previous output before writing the new.
  fs.mkdirSync(METS_DIR, { recursive: true });
  const removed = clearOutputDir(METS_DIR);
  console.log(`[generate-mets] Removed ${removed} xml file${removed === 1 ? '' : 's'} from ${METS_DIR} before writing`);

  let written = 0;
  let skipped = 0;
  for (const desc of descriptions) {
    const ref = desc.reference_code || '';
    if (!ref) {
      skipped++;
      continue;
    }
    const slug = metsSlug(ref);
    const repo = reposByCode.get(desc.repository_code) || null;
    const xml = buildMets(desc, repo, { creatorName, creatorNote, defaultRights, language, instanceRoot: INSTANCE_ROOT });
    fs.writeFileSync(path.join(METS_DIR, `${slug}.xml`), xml, 'utf8');
    written++;
    if (written % 10000 === 0) {
      console.log(`[generate-mets] Wrote ${written} METS files...`);
    }
  }

  console.log(`[generate-mets] Wrote ${written} METS files to ${METS_DIR}`);
  if (skipped > 0) {
    console.warn(`[generate-mets] Skipped ${skipped} record(s) with no reference_code`);
  }
}

module.exports = { buildMets, computeRights, catalogueLicenceText, metsSlug, readMetsConfig, DC_TYPE_MAP };

if (require.main === module) {
  main().catch(err => {
    console.error('[generate-mets] Fatal error:', (err && err.stack) || err);
    process.exit(1);
  });
}

// Version: v1.6.0
