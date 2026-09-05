import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJSON, sha256, hashValue, commitment, newId } from './canonical.js';

test('canonical form is independent of key insertion order', () => {
  assert.equal(canonicalJSON({ b: 1, a: 2 }), canonicalJSON({ a: 2, b: 1 }));
  assert.equal(hashValue({ x: { z: 1, y: 2 } }), hashValue({ x: { y: 2, z: 1 } }));
});

test('canonical form preserves array order', () => {
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});

test('undefined properties are dropped, null is preserved', () => {
  assert.equal(canonicalJSON({ a: undefined, b: null }), '{"b":null}');
});

test('non-finite numbers are stringified rather than becoming null', () => {
  assert.equal(canonicalJSON({ a: Number.POSITIVE_INFINITY }), '{"a":"Infinity"}');
});

test('sha256 is stable and 64 hex characters', () => {
  const digest = sha256('civicos');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, sha256('civicos'));
});

test('commitments are stable, short and hide the value', () => {
  const a = commitment('eleni.papadaki@example.org');
  assert.equal(a, commitment('eleni.papadaki@example.org'));
  assert.notEqual(a, commitment('someone.else@example.org'));
  assert.equal(a.length, 16);
  assert.ok(!a.includes('eleni'));
});

test('ids are prefixed and unique', () => {
  const first = newId('run');
  assert.match(first, /^run_[0-9a-f]{20}$/);
  assert.notEqual(first, newId('run'));
});
