/**
 * Sanitizer Unit Tests
 *
 * Tests for `sanitizeField` from `lib/sanitize.js`. The sanitizer is the
 * security keystone of the importer suite — every adapter runs all imported
 * text fields through it before writing the six-file contract output. These
 * tests prove the injection-prevention contract across twelve distinct
 * behaviors.
 *
 * Behaviors covered:
 *
 *   1. Script tags stripped — `<script>alert(1)</script>` → ''
 *   2. Inline tags stripped, text kept — `<b>Bold text</b>` → 'Bold text'
 *   3. Block tags (</p>) converted to newline — `<p>One</p><p>Two</p>` → 'One\nTwo'
 *   4. Line-break tags converted to newline — `Line 1<br>Line 2` → 'Line 1\nLine 2'
 *   5. HTML entities decoded — `&amp;` → '&'
 *   6. Template variable syntax preserved — `Page: {{ variable }}` unchanged
 *   7. Template tag syntax preserved — `{% if x %}` unchanged
 *   8. Event-handler attributes stripped — `<span onclick="...">text</span>` → 'text'
 *   9. Non-string input returns empty string — null → '', 123 → ''
 *  10. Entity-encoded script tag produces no live tag — `&lt;script&gt;alert(1)&lt;/script&gt;` → ''
 *  11. Entity-encoded img with onerror produces no live tag
 *  12. Double-encoded entity collapse — `&amp;lt;script&amp;gt;` never reaches output as `<script>`
 *
 * Behaviors 10–12 are regression tests for an encoded-markup bypass: entities
 * must be decoded BEFORE tag stripping so entity-encoded markup cannot slip
 * past the sanitizer and be decoded back into live tags afterwards.
 *
 * The `{{`/`{%` sequences once mattered because the old Nunjucks build had a
 * template-escaping filter, since removed. Go templates auto-escape by
 * default, so `{{`/`{%` in imported text are harmless literals — the
 * sanitizer leaves them alone rather than stripping them.
 *
 * Uses the ESM + createRequire bridge pattern so that ESM vitest can import
 * the CommonJS sanitize.js module.
 *
 * @version v0.2.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sanitizeField } = require('../lib/sanitize.js');

// ---------------------------------------------------------------------------
// Behavior 1: script tags stripped
// ---------------------------------------------------------------------------

describe('sanitizeField — script tags stripped', () => {
  it('returns empty string for a bare script tag payload', () => {
    expect(sanitizeField('<script>alert(1)</script>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: inline tags stripped, text content preserved
// ---------------------------------------------------------------------------

describe('sanitizeField — inline tags stripped, text kept', () => {
  it('strips <b> but keeps the text content', () => {
    expect(sanitizeField('<b>Bold text</b>')).toBe('Bold text');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: </p> block tags converted to newlines
// ---------------------------------------------------------------------------

describe('sanitizeField — </p> block tags converted to newlines', () => {
  it('turns <p>One</p><p>Two</p> into "One\\nTwo"', () => {
    expect(sanitizeField('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: <br> line-break tags converted to newlines
// ---------------------------------------------------------------------------

describe('sanitizeField — <br> line-break tags converted to newlines', () => {
  it('turns Line 1<br>Line 2 into "Line 1\\nLine 2"', () => {
    expect(sanitizeField('Line 1<br>Line 2')).toBe('Line 1\nLine 2');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: HTML entities decoded
// ---------------------------------------------------------------------------

describe('sanitizeField — HTML entities decoded', () => {
  it('decodes &amp; to &', () => {
    expect(sanitizeField('&amp;')).toBe('&');
  });
});

// ---------------------------------------------------------------------------
// Behavior 6: template variable syntax preserved
// ---------------------------------------------------------------------------

describe('sanitizeField — template variable syntax preserved', () => {
  it('leaves {{ variable }} intact in surrounding text', () => {
    expect(sanitizeField('Page: {{ variable }}')).toBe('Page: {{ variable }}');
  });
});

// ---------------------------------------------------------------------------
// Behavior 7: template tag syntax preserved
// ---------------------------------------------------------------------------

describe('sanitizeField — template tag syntax preserved', () => {
  it('leaves {% if x %} intact', () => {
    expect(sanitizeField('{% if x %}')).toBe('{% if x %}');
  });
});

// ---------------------------------------------------------------------------
// Behavior 8: event-handler attributes stripped
// ---------------------------------------------------------------------------

describe('sanitizeField — event-handler attributes stripped', () => {
  it('strips onclick handler, keeps text content', () => {
    expect(sanitizeField('<span onclick="alert(1)">text</span>')).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Behavior 9: non-string input returns empty string
// ---------------------------------------------------------------------------

describe('sanitizeField — non-string input returns empty string', () => {
  it('returns "" for null input', () => {
    expect(sanitizeField(null)).toBe('');
  });

  it('returns "" for numeric input', () => {
    expect(sanitizeField(123)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Behaviors 10–12: entity-encoded injection regression tests
// Entities must be decoded BEFORE stripping so encoded markup cannot bypass
// the sanitizer and be decoded back into live tags after the fact.
// ---------------------------------------------------------------------------

describe('sanitizeField — entity-encoded markup cannot bypass sanitizer', () => {
  it('entity-encoded script tag produces no live tag in output', () => {
    // &lt;script&gt;alert(1)&lt;/script&gt; must NOT become <script>alert(1)</script>
    const result = sanitizeField('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).not.toMatch(/<script>/i);
    expect(result).not.toMatch(/<\/script>/i);
    expect(result).toBe('');
  });

  it('entity-encoded img onerror attribute produces no live tag in output', () => {
    // &lt;img src=x onerror=alert(1)&gt; must NOT become a live <img> tag
    const result = sanitizeField('&lt;img src=x onerror=alert(1)&gt;');
    expect(result).not.toMatch(/<img/i);
  });

  it('double-encoded entity collapses before stripping — no <script> in output', () => {
    // &amp;lt;script&amp;gt; decodes first to &lt;script&gt;, then to <script>
    // which must then be stripped; the output must never contain a live tag.
    const result = sanitizeField('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;');
    expect(result).not.toMatch(/<script>/i);
    expect(result).not.toMatch(/<\/script>/i);
  });
});

// Version: v0.2.0
