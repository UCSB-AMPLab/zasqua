/**
 * Publisher Data Tests
 *
 * `generate-content.js` copies the optional `publisher.json` and
 * `vocabulary.json` exports (single JSON objects) to `assets/hugo-data/`
 * when they are in the data directory, and deletes a copy left there by an
 * earlier build when they are not. The `lang-field.html` and
 * `publisher.html` partials read the data in templates.
 *
 * The copy tests run the script as a subprocess on a temporary instance.
 * The partial tests build a small Hugo site in a temporary directory with
 * the two partials copied in, once with Spanish and once with English as
 * the site language.
 *
 * @version v1.6.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'fisqua-institutions');
const PARTIALS = path.join(ENGINE_ROOT, 'themes', 'base', 'layouts', '_partials');
const HUGO = path.join(ENGINE_ROOT, 'node_modules', '.bin', 'hugo');

function makeInstance(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-publisher-test-'));
  const exportsDir = path.join(dir, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'hugo-data'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'zasqua.manifest.toml'),
    '[modules]\nhierarchy = false\nentities = false\nentities_graph = false\nplaces = false\nplaces_map = false\niiif = "auto"\nocr = "auto"\n'
  );
  const base = { 'descriptions.json': [], 'repositories.json': [{ id: 1, code: 'test', name: 'Test' }] };
  for (const [name, content] of Object.entries({ ...base, ...files })) {
    fs.writeFileSync(path.join(exportsDir, name), JSON.stringify(content));
  }
  return dir;
}

function runGenerateContent(instance) {
  execFileSync('node', [path.join(ENGINE_ROOT, 'scripts', 'generate-content.js')], {
    env: {
      ...process.env,
      INSTANCE_ROOT: instance,
      DATA_DIR: path.join(instance, 'exports'),
      HUGO_DATA_DIR: path.join(instance, 'assets', 'hugo-data'),
    },
    cwd: instance,
    stdio: 'pipe',
  });
}

describe('generate-content.js optional exports', () => {
  let instance;
  afterEach(() => fs.rmSync(instance, { recursive: true, force: true }));

  it('copies publisher.json and vocabulary.json when present', () => {
    const publisher = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'publisher.json'), 'utf8'));
    const vocabulary = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'vocabulary.json'), 'utf8'));
    instance = makeInstance({ 'publisher.json': publisher, 'vocabulary.json': vocabulary });
    runGenerateContent(instance);
    const out = path.join(instance, 'assets', 'hugo-data');
    expect(JSON.parse(fs.readFileSync(path.join(out, 'publisher.json'), 'utf8'))).toEqual(publisher);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'vocabulary.json'), 'utf8'))).toEqual(vocabulary);
  });

  it('writes neither file when the export has neither', () => {
    instance = makeInstance({});
    runGenerateContent(instance);
    const out = path.join(instance, 'assets', 'hugo-data');
    expect(fs.existsSync(path.join(out, 'publisher.json'))).toBe(false);
    expect(fs.existsSync(path.join(out, 'vocabulary.json'))).toBe(false);
  });

  it('deletes a stale copy when the export no longer has the file', () => {
    instance = makeInstance({ 'vocabulary.json': { a: 1 } });
    const out = path.join(instance, 'assets', 'hugo-data');
    fs.writeFileSync(path.join(out, 'publisher.json'), '{"legal_name":"Old"}');
    fs.writeFileSync(path.join(out, 'vocabulary.json'), '{"old":true}');
    runGenerateContent(instance);
    expect(fs.existsSync(path.join(out, 'publisher.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'vocabulary.json'), 'utf8'))).toEqual({ a: 1 });
  });

  it('fails when an export is an array', () => {
    instance = makeInstance({ 'publisher.json': [] });
    expect(() => runGenerateContent(instance)).toThrow();
  });
});

describe('lang-field.html and publisher.html', () => {
  const cases = `{{ $cases := slice nil "  plain " (dict "es" "hola" "en" "hello") (dict "es" nil "en" "hello") (dict "es" " " "en" nil) (dict "es" "" "en" "") (dict "es" nil "fr" "bonjour" "ca" "hola") (dict "en" "only" "es" "  ") (dict "en" "hello" "es" "hola") }}
{{ range $cases }}[{{ (partial "lang-field.html" .).text }}|{{ (partial "lang-field.html" .).lang }}]
{{ end }}PUB={{ (partialCached "publisher.html" .).legal_name }}
`;

  function build(lang, publisher) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zasqua-partial-test-'));
    fs.mkdirSync(path.join(dir, 'layouts', '_partials'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'hugo-data'), { recursive: true });
    for (const f of ['lang-field.html', 'publisher.html']) {
      fs.copyFileSync(path.join(PARTIALS, f), path.join(dir, 'layouts', '_partials', f));
    }
    fs.writeFileSync(
      path.join(dir, 'hugo.toml'),
      `baseURL = "/"\ndefaultContentLanguage = "${lang}"\ndisableKinds = ["taxonomy", "term", "RSS", "sitemap", "section"]\n`
    );
    fs.writeFileSync(path.join(dir, 'layouts', 'home.html'), cases);
    if (publisher) fs.writeFileSync(path.join(dir, 'assets', 'hugo-data', 'publisher.json'), JSON.stringify(publisher));
    execFileSync(HUGO, ['--quiet'], { cwd: dir, stdio: 'pipe' });
    const html = fs.readFileSync(path.join(dir, 'public', 'index.html'), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    return html.split('\n').map(l => l.trim()).filter(Boolean);
  }

  it('picks the site-language member, or the other with its code (site language es)', () => {
    const lines = build('es', { legal_name: 'Fundación' });
    expect(lines).toEqual([
      '[|]',
      '[plain|]',
      '[hola|]',
      '[hello|en]',
      '[|]',
      '[|]',
      '[hola|ca]',
      '[only|en]',
      '[hola|]',
      'PUB=Fundación',
    ]);
  });

  it('picks the site-language member, or the other with its code (site language en)', () => {
    const lines = build('en', null);
    expect(lines.slice(0, 9)).toEqual([
      '[|]',
      '[plain|]',
      '[hello|]',
      '[hello|]',
      '[|]',
      '[|]',
      '[hola|ca]',
      '[only|]',
      '[hello|]',
    ]);
  });

  it('returns an empty dict from publisher.html when publisher.json is absent', () => {
    expect(build('es', null).at(-1)).toBe('PUB=');
  });
});

// Version: v1.6.0
