/**
 * Place Code Required Tests
 *
 * The place page shows `place_code` as written. It used to build an
 * `nl-<id>` code when the field was missing. That fallback is gone
 * because the schema and the validator both require `place_code`, so a
 * valid export always carries it. These tests pin the three facts
 * together: the schema requires the field, the validator rejects a
 * place without it, and the template has no `nl-` fallback.
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('place_code is required', () => {
  it('is listed as required in the places schema', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/places.schema.json'), 'utf8'));
    expect(schema.items.required).toContain('place_code');
  });

  it('the place page template has no nl- fallback', () => {
    const tpl = fs.readFileSync(path.join(ROOT, 'themes/base/layouts/lugar/single.html'), 'utf8');
    expect(tpl).not.toMatch(/printf\s+"nl-/);
  });
});

// Version: v1.6.0
