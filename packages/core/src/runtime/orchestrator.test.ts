import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topoSort } from './orchestrator.js';
import type { Task } from './orchestrator.js';

const task = (id: string, dependsOn?: string[]): Task =>
  dependsOn ? { id, agent: id, dependsOn } : { id, agent: id };

test('dependencies come before dependents', () => {
  const order = topoSort([task('c', ['b']), task('a'), task('b', ['a'])]).map((t) => t.id);
  assert.ok(order.indexOf('a') < order.indexOf('b'));
  assert.ok(order.indexOf('b') < order.indexOf('c'));
});

test('independent tasks keep their declaration order, so runs repeat exactly', () => {
  const order = topoSort([task('x'), task('y'), task('z')]).map((t) => t.id);
  assert.deepEqual(order, ['x', 'y', 'z']);
});

test('a dependency cycle is reported with the path', () => {
  assert.throws(() => topoSort([task('a', ['b']), task('b', ['a'])]), /dependency cycle/);
});

test('a dependency on a task that does not exist is rejected', () => {
  assert.throws(() => topoSort([task('a', ['ghost'])]), /unknown task "ghost"/);
});

test('a diamond resolves to a valid order', () => {
  const order = topoSort([
    task('d', ['b', 'c']),
    task('b', ['a']),
    task('c', ['a']),
    task('a'),
  ]).map((t) => t.id);
  assert.equal(order[0], 'a');
  assert.equal(order.at(-1), 'd');
  assert.equal(order.length, 4);
});
