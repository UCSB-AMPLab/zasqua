/**
 * Derive Children Unit Tests
 *
 * Tests for `deriveChildren`, the pure helper in `scripts/derive-children.js`
 * that groups archival description records into per-parent children shards
 * for the Miller-column tree navigation. The function reads a flat descriptions
 * array and returns a Map of parent-id → shard object plus an array of orphan
 * warnings.
 *
 * Five behaviors covered:
 *
 *   1. Shard grouping — deriveChildren groups children under the correct
 *      integer parent_id and emits one shard per parent-with-children.
 *
 *   2. Field set and order — each child object carries exactly the 9
 *      contract fields in a fixed order: id, reference_code, title,
 *      description_level, date_expression, scope_content, child_count,
 *      children_level, has_digital. This order matches the shard format the
 *      navigation tree expects.
 *
 *   3. Sibling sort — siblings are ordered by reference_code ascending,
 *      not by id, so the tree lists children in their archival sequence.
 *
 *   4. Orphan handling — a child whose parent_id has no matching record in
 *      the descriptions array produces a WARN entry in the warnings array
 *      and is silently excluded from the shards Map. The function does not
 *      throw, so one dangling reference cannot abort the whole derivation.
 *
 *   5. count and envelope — the shard envelope wraps children as
 *      {"count": N, "results": [...]} rather than a flat array, matching the
 *      paginated shape the client reads. child_count on each item equals the
 *      number of that item's own children in the input (passed through from
 *      descriptions).
 *
 * Tests operate entirely on synthetic in-memory arrays — no file I/O,
 * no full corpus, no real exports/ directory required.
 *
 * @version v0.1.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { deriveChildren } = require('../scripts/derive-children.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal description factory — only the fields deriveChildren reads.
 */
function makeDesc(overrides) {
  return {
    id: 1,
    reference_code: 'co-ahr-t001',
    title: 'Test Description',
    description_level: 'fonds',
    date_expression: '',
    scope_content: '',
    child_count: 0,
    children_level: null,
    has_digital: false,
    parent_id: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Behavior 1: Shard grouping
// ---------------------------------------------------------------------------

describe('deriveChildren — shard grouping', () => {
  it('emits one shard per parent-with-children', () => {
    const descs = [
      makeDesc({ id: 10, parent_id: null }),
      makeDesc({ id: 20, parent_id: 10, reference_code: 'co-ahr-t001-s01' }),
      makeDesc({ id: 21, parent_id: 10, reference_code: 'co-ahr-t001-s02' }),
    ];
    const { shards, warnings } = deriveChildren(descs);
    expect(shards.size).toBe(1);
    expect(shards.has(10)).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('groups children under the correct integer parent_id', () => {
    const descs = [
      makeDesc({ id: 10, parent_id: null }),
      makeDesc({ id: 11, parent_id: null }),
      makeDesc({ id: 20, parent_id: 10, reference_code: 'co-ahr-t001-s01' }),
      makeDesc({ id: 21, parent_id: 11, reference_code: 'co-ahr-t002-s01' }),
    ];
    const { shards } = deriveChildren(descs);
    expect(shards.size).toBe(2);
    expect(shards.get(10).results).toHaveLength(1);
    expect(shards.get(10).results[0].id).toBe(20);
    expect(shards.get(11).results).toHaveLength(1);
    expect(shards.get(11).results[0].id).toBe(21);
  });

  it('does not create a shard for parents with no children', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: null }),
    ];
    const { shards } = deriveChildren(descs);
    expect(shards.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2: Field set and order (the shard contract)
// ---------------------------------------------------------------------------

describe('deriveChildren — field set and order', () => {
  it('each child has exactly 9 contract fields in the fixed order', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({
        id: 2,
        parent_id: 1,
        reference_code: 'co-ahr-t001-s01',
        title: 'Serie 1',
        description_level: 'series',
        date_expression: '1820 .. 1850',
        scope_content: 'Documentos de la serie',
        child_count: 5,
        children_level: 'file',
        has_digital: true,
      }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    const keys = Object.keys(child);
    expect(keys).toEqual([
      'id',
      'reference_code',
      'title',
      'description_level',
      'date_expression',
      'scope_content',
      'child_count',
      'children_level',
      'has_digital',
    ]);
  });

  it('has_children is absent from the child object', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 1, reference_code: 'co-ahr-t001-s01' }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    expect(child).not.toHaveProperty('has_children');
  });

  it('scope_content and has_digital are present', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({
        id: 2,
        parent_id: 1,
        reference_code: 'co-ahr-t001-s01',
        scope_content: 'Registro civil',
        has_digital: true,
      }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    expect(child.scope_content).toBe('Registro civil');
    expect(child.has_digital).toBe(true);
  });

  it('date_expression defaults to empty string when null', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 1, reference_code: 'co-ahr-t001-s01', date_expression: null }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    expect(child.date_expression).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3: Sibling sort — reference_code ascending
// ---------------------------------------------------------------------------

describe('deriveChildren — sibling sort by reference_code ascending', () => {
  it('siblings are sorted by reference_code ascending, not by id', () => {
    // Intentionally insert in reverse reference_code order to verify sort.
    const descs = [
      makeDesc({ id: 10, parent_id: null }),
      makeDesc({ id: 99, parent_id: 10, reference_code: 'co-ahr-t001-s03' }),
      makeDesc({ id: 12, parent_id: 10, reference_code: 'co-ahr-t001-s01' }),
      makeDesc({ id: 50, parent_id: 10, reference_code: 'co-ahr-t001-s02' }),
    ];
    const { shards } = deriveChildren(descs);
    const results = shards.get(10).results;
    expect(results.map(r => r.reference_code)).toEqual([
      'co-ahr-t001-s01',
      'co-ahr-t001-s02',
      'co-ahr-t001-s03',
    ]);
    // Confirm ids are NOT in ascending order (12, 50, 99 ascending happens to
    // coincide here, so use the reference_code assertion as the definitive check).
    expect(results.map(r => r.id)).toEqual([12, 50, 99]);
  });

  it('sort is NOT id-ascending — ids out of order when codes are reversed', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 30, parent_id: 1, reference_code: 'aa-001' }),
      makeDesc({ id: 20, parent_id: 1, reference_code: 'cc-001' }),
      makeDesc({ id: 10, parent_id: 1, reference_code: 'bb-001' }),
    ];
    const { shards } = deriveChildren(descs);
    const ids = shards.get(1).results.map(r => r.id);
    // reference_code order: aa → bb → cc, so ids should be [30, 10, 20]
    expect(ids).toEqual([30, 10, 20]);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4: Orphan handling — warn+skip, no throw
// ---------------------------------------------------------------------------

describe('deriveChildren — orphan handling', () => {
  it('does not throw when a child references a non-existent parent_id', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      // parent_id=999 does not exist in the array
      makeDesc({ id: 2, parent_id: 999, reference_code: 'co-ahr-orphan' }),
    ];
    expect(() => deriveChildren(descs)).not.toThrow();
  });

  it('adds a warning string for each orphan child', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 999, reference_code: 'co-ahr-orphan-a' }),
      makeDesc({ id: 3, parent_id: 888, reference_code: 'co-ahr-orphan-b' }),
    ];
    const { warnings } = deriveChildren(descs);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/orphan/);
    expect(warnings[0]).toMatch(/id=2/);
    expect(warnings[0]).toMatch(/parent_id=999/);
  });

  it('orphan child is not included in any shard', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 1, reference_code: 'co-ahr-t001-s01' }),
      makeDesc({ id: 3, parent_id: 999, reference_code: 'co-ahr-orphan' }),
    ];
    const { shards } = deriveChildren(descs);
    // Only shard for parent_id=1 should exist; no shard for 999
    expect(shards.has(999)).toBe(false);
    expect(shards.get(1).results.map(r => r.id)).not.toContain(3);
  });
});

// ---------------------------------------------------------------------------
// Behavior 5: Envelope format — {"count": N, "results": [...]}
// ---------------------------------------------------------------------------

describe('deriveChildren — shard envelope format', () => {
  it('each shard wraps children in a {count, results} envelope', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 1, reference_code: 'co-ahr-t001-s01' }),
      makeDesc({ id: 3, parent_id: 1, reference_code: 'co-ahr-t001-s02' }),
    ];
    const { shards } = deriveChildren(descs);
    const shard = shards.get(1);
    expect(shard).toHaveProperty('count', 2);
    expect(shard).toHaveProperty('results');
    expect(Array.isArray(shard.results)).toBe(true);
    expect(shard.results).toHaveLength(2);
  });

  it('count equals the number of direct children for the parent', () => {
    const descs = [
      makeDesc({ id: 10, parent_id: null }),
      makeDesc({ id: 20, parent_id: 10, reference_code: 'co-ahr-t001-a' }),
      makeDesc({ id: 21, parent_id: 10, reference_code: 'co-ahr-t001-b' }),
      makeDesc({ id: 22, parent_id: 10, reference_code: 'co-ahr-t001-c' }),
    ];
    const { shards } = deriveChildren(descs);
    expect(shards.get(10).count).toBe(3);
  });

  it('child_count on each item reflects its own children count (passed through)', () => {
    // child_count is sourced from descriptions.json, not recomputed here
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({
        id: 2,
        parent_id: 1,
        reference_code: 'co-ahr-t001-s01',
        child_count: 7,
        children_level: 'file',
      }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    expect(child.child_count).toBe(7);
    expect(child.children_level).toBe('file');
  });

  it('children_level is null for leaf children (child_count=0)', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({
        id: 2,
        parent_id: 1,
        reference_code: 'co-ahr-t001-s01',
        child_count: 0,
        children_level: null,
      }),
    ];
    const { shards } = deriveChildren(descs);
    const child = shards.get(1).results[0];
    expect(child.children_level).toBeNull();
  });

  it('JSON.stringify produces compact output (no pretty-print newlines)', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null }),
      makeDesc({ id: 2, parent_id: 1, reference_code: 'co-ahr-t001-s01' }),
    ];
    const { shards } = deriveChildren(descs);
    const shard = shards.get(1);
    const serialized = JSON.stringify(shard);
    // Compact JSON has no newlines or leading spaces
    expect(serialized).not.toMatch(/\n/);
    expect(serialized).not.toMatch(/^ {2}/m);
  });
});

// ---------------------------------------------------------------------------
// Behavior 6: parent_reference_code fallback
//
// A contract export produced outside the original cataloguing backend often
// sets parent_reference_code but leaves parent_id null. The shard is still
// keyed by the parent's numeric id, resolved through the reference_code → id
// map, so the Miller-column tree expands instead of silently rendering empty.
// ---------------------------------------------------------------------------

describe('deriveChildren — parent_reference_code fallback', () => {
  it('links a child by parent_reference_code when parent_id is null', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null, reference_code: 'co-ahr-t001' }),
      makeDesc({
        id: 2,
        parent_id: null,
        parent_reference_code: 'co-ahr-t001',
        reference_code: 'co-ahr-t001-s01',
      }),
    ];
    const { shards, warnings } = deriveChildren(descs);
    expect(warnings).toHaveLength(0);
    // Shard is keyed by the parent's numeric id (1), not its reference_code.
    expect(shards.has(1)).toBe(true);
    expect(shards.get(1).results.map(r => r.id)).toEqual([2]);
  });

  it('prefers parent_id when both parent_id and parent_reference_code are set', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null, reference_code: 'co-ahr-t001' }),
      makeDesc({ id: 9, parent_id: null, reference_code: 'co-ahr-t009' }),
      makeDesc({
        id: 2,
        parent_id: 9,
        parent_reference_code: 'co-ahr-t001', // ignored in favour of parent_id=9
        reference_code: 'co-ahr-t009-s01',
      }),
    ];
    const { shards } = deriveChildren(descs);
    expect(shards.has(9)).toBe(true);
    expect(shards.has(1)).toBe(false);
  });

  it('warns and skips when parent_reference_code resolves to nothing', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null, reference_code: 'co-ahr-t001' }),
      makeDesc({
        id: 2,
        parent_id: null,
        parent_reference_code: 'co-ahr-does-not-exist',
        reference_code: 'co-ahr-orphan',
      }),
    ];
    const { shards, warnings } = deriveChildren(descs);
    expect(shards.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/parent_reference_code=co-ahr-does-not-exist/);
  });

  it('treats a record with neither parent field as a root (no shard, no warning)', () => {
    const descs = [
      makeDesc({ id: 1, parent_id: null, parent_reference_code: null, reference_code: 'co-ahr-t001' }),
    ];
    const { shards, warnings } = deriveChildren(descs);
    expect(shards.size).toBe(0);
    expect(warnings).toHaveLength(0);
  });
});

// Version: v1.3.0
