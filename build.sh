#!/usr/bin/env bash
# Zasqua Frontend Local Build Script (Hugo pipeline)
#
# Runs the end-to-end pipeline on a developer machine the way CI would:
# downloads the current data exports from Backblaze B2, pre-computes the
# entity/place link shards, enriches the archival JSON via Node (producing
# the denormalised inputs Hugo consumes), builds the Hugo Extended site,
# and indexes the output three times with Pagefind (one index per
# discovery surface: descriptions, entity explorer, place explorer).
#
# The v1.0.0 rebuild replaced the Eleventy pipeline with Hugo Extended to
# fix the CI out-of-memory failure at ~192K pages. The Tailwind CSS
# compile is now handled inside Hugo via `css.TailwindCSS` (Hugo Pipes)
# rather than the standalone Tailwind binary this script previously
# downloaded.
#
# The engine/instance split moved this script into the engine package, where
# it is invoked by the Zasqua CLI (`bin/zasqua.js`) with ENGINE_ROOT set to
# the engine package directory and INSTANCE_ROOT / cwd set to the instance.
# Node script invocations use "$ENGINE_ROOT/scripts/X.js" so they resolve
# correctly regardless of the caller's working directory. Stage logic and
# stage ordering are unchanged — the CLI wraps the pipeline, it does not
# rewrite it.
#
# The children/ shards are no longer downloaded from B2. Instead they are
# derived at build time from descriptions.json by Stage 2b
# (derive-children.js). The B2 sync for children/ has been removed from
# Stage 1; only the flat JSON exports are downloaded. Stage 2b runs after
# precompute-links (Stage 2) and before npm ci (Stage 3).
#
# This script is manifest-aware. Module flags (entities, places, hierarchy)
# are read from zasqua.manifest.toml via a node one-liner so Stage 2's shard
# counts and Stage 5's static/data copy are guarded on the actual module
# state. A Core-only build (all explorer modules false) no longer crashes at
# Stage 2's unpiped `ls -lh` or Stage 5's unconditional `cp -r` when the
# disabled-module artifacts are absent. All-enabled behavior is unchanged.
#
# Required environment variables:
#   B2_APPLICATION_KEY_ID  — read-only key ID for the zasqua-export bucket
#   B2_APPLICATION_KEY     — read-only application key
#
# Optional environment variables:
#   ENGINE_ROOT     — path to the engine package directory; defaults to the
#                     directory containing this script if unset
#   DEV_LIMIT       — integer cap on records processed by generate-content.js
#                     (fast local iteration; leave unset for full-corpus)
#   SKIP_DOWNLOAD   — if set to any value, skips the B2 download step
#                     (useful when exports/ is already populated)
#   FETCH_ONLY      — CLI wrap affordance: if set to any value, the script
#                     exits 0 immediately after Stage 1 completes. Set by
#                     `zasqua fetch` in `lib/pipeline.js`; do not use
#                     directly. This is a wrap affordance, not a pipeline
#                     rewrite — stage logic is unchanged.
#
# Version: v2.3.0
set -euo pipefail

# Resolve ENGINE_ROOT: default to the directory that contains this script,
# so the script is self-contained whether invoked directly or via the CLI.
ENGINE_ROOT="${ENGINE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# ---- Stage 1: Data download (B2) ----
if [ -z "${SKIP_DOWNLOAD:-}" ]; then
  echo "=== Stage 1: downloading data from B2 ==="
  pip install b2[full] --quiet
  b2 account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY"

  # Ensure output directories exist for all optional module artifacts so that
  # Stage 5's cp -r finds the directories regardless of module config.
  mkdir -p exports/children exports/entity-links exports/place-links exports/doc-entities

  b2 file download b2://zasqua-export/descriptions.json exports/descriptions.json
  b2 file download b2://zasqua-export/repositories.json exports/repositories.json
  b2 file download b2://zasqua-export/entities.json exports/entities.json
  b2 file download b2://zasqua-export/places.json exports/places.json
  b2 file download b2://zasqua-export/entity_links.json exports/entity_links.json
  b2 file download b2://zasqua-export/place_links.json exports/place_links.json

  ls -lh exports/descriptions.json exports/repositories.json exports/entities.json exports/places.json
  echo "Children: derived from descriptions.json in Stage 2b (not downloaded)"
else
  echo "=== Stage 1: skipped (SKIP_DOWNLOAD set) ==="
fi

# FETCH_ONLY wrap affordance: exit after Stage 1 so `zasqua fetch` runs only
# the B2 download without advancing to later stages. Set by `runFetch()` in
# `lib/pipeline.js`; not intended for direct use.
if [ -n "${FETCH_ONLY:-}" ]; then
  echo "=== FETCH_ONLY set — exiting after Stage 1 ==="
  exit 0
fi

# ---- Read manifest module flags ----
# Gate Stage 2 shard counts and Stage 5 copies on what the manifest actually
# says. A deployer with entities=false should never see build.sh try to list
# or copy entity-index.json — it was never written by precompute-links.
#
# ENGINE_ROOT points at the local engine package; loadManifest reads
# zasqua.manifest.toml from process.cwd() (INSTANCE_ROOT / the instance dir).
MANIFEST_ROOT="${INSTANCE_ROOT:-$(pwd)}"
MODULE_ENTITIES=$(node -e \
  "const {loadManifest}=require('$ENGINE_ROOT/lib/manifest.js');\
const m=loadManifest('$MANIFEST_ROOT');\
process.stdout.write(m.modules.entities?'true':'false')")
MODULE_PLACES=$(node -e \
  "const {loadManifest}=require('$ENGINE_ROOT/lib/manifest.js');\
const m=loadManifest('$MANIFEST_ROOT');\
process.stdout.write(m.modules.places?'true':'false')")

echo "Manifest flags: entities=${MODULE_ENTITIES} places=${MODULE_PLACES}"

# ---- Stage 2: precompute entity/place link shards ----
echo "=== Stage 2: precompute-links.js ==="
node "$ENGINE_ROOT/scripts/precompute-links.js"
# Report shard counts only for enabled modules. The ls | wc -l lines are
# piped (wc exits 0 regardless of ls exit code), so they were safe before,
# but they print misleading "0" for absent dirs. Guard on module flag instead.
if [ "$MODULE_ENTITIES" = "true" ]; then
  echo "Entity shards:      $(ls exports/entity-links/ 2>/dev/null | wc -l)"
  echo "Doc-entities shards: $(ls exports/doc-entities/ 2>/dev/null | wc -l)"
  [ -f exports/entity-index.json ] && ls -lh exports/entity-index.json
fi
if [ "$MODULE_PLACES" = "true" ]; then
  echo "Place shards:       $(ls exports/place-links/ 2>/dev/null | wc -l)"
  [ -f exports/place-index.json ] && ls -lh exports/place-index.json
fi

# ---- Stage 2b: derive children/ shards from descriptions.json ----
# The children/ shards are derived at build time from the parent_id /
# parent_reference_code relationships in descriptions.json rather than
# downloaded from B2. This removes the B2 children sync from Stage 1 and
# makes the hierarchy self-contained in the deployer's data export.
echo "=== Stage 2b: derive-children.js ==="
node "$ENGINE_ROOT/scripts/derive-children.js"
echo "Derived children shards: $(ls exports/children/ 2>/dev/null | wc -l)"

# ---- Stage 3: npm dependencies ----
echo "=== Stage 3: npm ci ==="
npm ci

# ---- Stage 4: enrichment (Node) ----
# Writes sharded descriptions + single-file entities + single-file places
# to assets/hugo-data/ where Hugo's content adapters consume them.
echo "=== Stage 4: generate-content.js ==="
node "$ENGINE_ROOT/scripts/generate-content.js"

# ---- Stage 5: populate runtime data shards under static/data/ ----
# Hugo's static passthrough serves these as-is for client JS (tree.js,
# entity-explorer.js, place-explorer.js, entity.js, place.js) to fetch
# at runtime. Previously these were served from /data/ by Eleventy's
# default passthrough of the top-level data/ directory; Hugo's data/
# is reserved for small UI lookups, so runtime shards live under
# static/data/ instead.
#
# Module-aware copy: disabled-module artifacts are skipped so a Core-only
# build never cp's entity-links/ or place-links/ (which precompute-links
# did not write). children/ is always copied — derive-children.js runs
# unconditionally and the hierarchy tree UI is always present.
echo "=== Stage 5: populate static/data/ runtime shards ==="
mkdir -p static/data
# Remove all optional-module artifact dirs and files before re-populating so
# that stale artifacts from a previous enabled run do not survive a manifest
# change to disabled. children/ is always re-derived (derive-children.js runs
# unconditionally), so it is cleaned and re-copied on every build.
rm -rf static/data/children \
       static/data/entity-links static/data/doc-entities static/data/entity-index.json \
       static/data/place-links static/data/place-index.json
# children/ is always derived at build time (see Stage 2b)
cp -r exports/children static/data/children
# Entity artifacts: only when entities module is enabled
if [ "$MODULE_ENTITIES" = "true" ]; then
  [ -d exports/entity-links  ] && cp -r exports/entity-links  static/data/entity-links
  [ -d exports/doc-entities  ] && cp -r exports/doc-entities  static/data/doc-entities
  [ -f exports/entity-index.json ] && cp exports/entity-index.json static/data/entity-index.json
fi
# Place artifacts: only when places module is enabled
if [ "$MODULE_PLACES" = "true" ]; then
  [ -d exports/place-links   ] && cp -r exports/place-links   static/data/place-links
  [ -f exports/place-index.json ] && cp exports/place-index.json static/data/place-index.json
fi
if [ -f exports/graph.json ]; then cp exports/graph.json static/data/graph.json; fi

# ---- Stage 6: Hugo build ----
# Requires Hugo Extended (css.TailwindCSS + SCSS support). The build
# writes hugo_stats.json; css.TailwindCSS compiles main.css from the
# class set; Pagefind indices are built in stage 7.
echo "=== Stage 6: hugo --minify ==="
hugo --minify

# ---- Stage 7: Pagefind indices (Node API) ----
# HTML-scan fallbacks retained as a commented-out block through the
# initial stabilisation window after the Hugo cutover. Delete after ~1
# week of clean production deploys.
#
# The Node-API generator reads enriched JSON under assets/hugo-data/ and
# writes three corpus-pure bundles to public/pagefind*/ via Pagefind's
# addCustomRecord. The JSON is now the search contract — empirical parity
# was verified against a side-by-side HTML-scan baseline during v1.0.0
# development.
echo "=== Stage 7: generate-pagefind-indices.js (Node API, 3 bundles) ==="
node "$ENGINE_ROOT/scripts/generate-pagefind-indices.js"

# HTML-scan fallbacks (kept through the initial stabilisation window):
# npx pagefind --site public --output-subdir pagefind \
#   --exclude-selectors "[data-pagefind-entity-page],[data-pagefind-place-page]"
# npx pagefind --site public --output-subdir pagefind-entities \
#   --glob "ne-*/**/*.html"
# npx pagefind --site public --output-subdir pagefind-places \
#   --glob "nl-*/**/*.html"

# ---- Done ----
echo "=== Build complete ==="
echo "Pages:     $(find public -name 'index.html' | wc -l)"
echo "Site size: $(du -sh public | cut -f1)"

# Version: v2.3.0
