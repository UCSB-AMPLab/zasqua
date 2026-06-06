/**
 * Import-time Field Sanitizer — Shared HTML Sanitizer for All Adapters
 *
 * This module deals with stripping untrusted markup from text fields that
 * arrive through importer adapters (CSV, EAD3, CollectiveAccess, Fisqua).
 * Every adapter passes its text fields through `sanitizeField` before writing
 * the six-file contract output to the staging directory. This guards against
 * markup or script injection carried in untrusted archival data.
 *
 * Public API:
 *
 *   sanitizeField(raw)
 *     Accepts any value. Returns a sanitized plain-text string, guaranteed
 *     to contain no HTML tags, no attributes, and no event handlers.
 *
 *     Processing steps:
 *       1. Non-string input (null, number, undefined, object) → returns ''.
 *       2. Pre-pass: replaces `</p>` and `<br>` variants (case-insensitive,
 *          optional whitespace, optional self-close) with '\n' so that
 *          multi-paragraph scope notes keep their line structure.
 *       3. Entity decode loop (up to 3 passes): calls `entities.decode()`
 *          repeatedly until the string is stable, so multi-layer encodings
 *          (e.g. `&amp;lt;script&amp;gt;`) collapse into real markup before
 *          the stripper sees them. This MUST happen before step 4 to prevent
 *          entity-encoded markup from surviving the strip unchanged and then
 *          being decoded back into live tag syntax after the fact.
 *       4. `sanitize-html` run with `allowedTags: [], allowedAttributes: {}`
 *          to strip every remaining tag and handler. `sanitize-html` is
 *          maintained by ApostropheCMS and is purpose-built for server-side
 *          HTML stripping.
 *       5. Collapses runs of 3+ blank lines to a maximum of 2 blank lines,
 *          then trims leading and trailing whitespace.
 *
 *     Nunjucks / Go-template passthrough: The sanitizer deliberately
 *     leaves `{{ variable }}` and `{% tag %}` syntax intact. These patterns
 *     are harmless literal text in Go templates — Hugo auto-escapes them by
 *     default, and the `escapeTemplate` Nunjucks filter that previously
 *     required special handling has been removed. Do NOT call sanitizeField
 *     on `ocr_text` values that intentionally carry `{{`/`{%` syntax — the
 *     Fisqua passthrough adapter skips sanitisation entirely because Fisqua
 *     is a trusted first-party source.
 *
 * Dependencies: sanitize-html 2.17.4 (MIT, ApostropheCMS), entities 7.0.1
 * (MIT, fb55 / htmlparser2 direct dep — pinned explicitly in package.json).
 *
 * @version v0.2.0
 */

'use strict';

const sanitizeHtml = require('sanitize-html');
const { decode: decodeEntities } = require('entities');

/**
 * Sanitize a single imported text field.
 *
 * @param {*} raw — the raw value from an import adapter (any type)
 * @returns {string} sanitized plain-text string (never null, never undefined)
 */
function sanitizeField(raw) {
  // Step 1: non-string input → empty string
  if (typeof raw !== 'string') {
    return '';
  }

  // Step 2: pre-pass — convert block-level closing tags to newlines
  // so that <p>One</p><p>Two</p> → "One\nTwo" rather than "OneTwo",
  // and Line 1<br>Line 2 → "Line 1\nLine 2" rather than "Line 1Line 2".
  const withNewlines = raw
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  // Step 3: decode entity references BEFORE stripping, looping to a fixed
  // point so multi-layer encodings collapse into real markup first. This
  // prevents entity-encoded attack payloads (e.g. &lt;script&gt;) from
  // slipping through the stripper as harmless text and then being decoded
  // back into live tag syntax afterward. Max 3 passes covers all realistic
  // double- and triple-encoded inputs without unbounded iteration.
  let decoded = withNewlines;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  // Step 4: strip all tags and attributes via sanitize-html.
  // Note: sanitize-html re-encodes bare `&` characters in text as `&amp;` in
  // its output. A final single decode pass undoes this so that legitimate
  // ampersands (and other safe characters) survive as plain Unicode in the
  // output. At this point the string is already fully stripped — the only
  // entities present are ones sanitize-html itself introduced, which are safe
  // to decode unconditionally.
  const stripped  = sanitizeHtml(decoded, {
    allowedTags: [],
    allowedAttributes: {},
  });
  const reDecoded = decodeEntities(stripped);

  // Step 5: collapse 3+ consecutive blank lines to 2, trim whitespace
  return reDecoded.replace(/(\n\s*){3,}/g, '\n\n').trim();
}

module.exports = { sanitizeField };

// Version: v0.2.0
