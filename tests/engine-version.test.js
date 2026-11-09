/**
 * Engine Version Fallback Test
 *
 * `themes/base/data/engine.yaml` holds the version that a Hugo run
 * reports when it bypasses `zasqua build`; the build overwrites it with
 * the version in `package.json`. The committed value drifted (it stayed
 * at 1.4.0 through 1.5.x), so this test requires the two to be equal.
 *
 * Version: v1.6.0
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = require('js-yaml');

describe('engine.yaml', () => {
  it('carries the version in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const data = yaml.load(fs.readFileSync(path.join(ROOT, 'themes/base/data/engine.yaml'), 'utf8'));
    expect(String(data.version)).toBe(pkg.version);
  });
});

// Version: v1.6.0
