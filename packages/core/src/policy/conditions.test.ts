import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCondition, getPath, unknownOperators } from './conditions.js';

const subject = {
  kind: 'publish',
  resource: 'public/briefs/q3.md',
  payload: { text: 'hello world', corroboration: 1, sources: ['r-1'], flagged: true },
  agent: { riskTier: 'high', dataCategories: ['personal_data'] },
};

test('reads dotted paths, arrays and missing branches', () => {
  assert.equal(getPath(subject, 'payload.corroboration'), 1);
  assert.equal(getPath(subject, 'payload.sources.0'), 'r-1');
  assert.equal(getPath(subject, 'payload.missing.deep'), undefined);
  assert.equal(getPath(subject, ''), subject);
});

test('a bare scalar means equality and an array means membership', () => {
  assert.ok(evaluateCondition({ kind: 'publish' }, subject));
  assert.ok(!evaluateCondition({ kind: 'data.read' }, subject));
  assert.ok(evaluateCondition({ kind: ['publish', 'data.write'] }, subject));
});

test('every field in a condition must match', () => {
  assert.ok(evaluateCondition({ kind: 'publish', 'agent.riskTier': 'high' }, subject));
  assert.ok(!evaluateCondition({ kind: 'publish', 'agent.riskTier': 'limited' }, subject));
});

test('comparison operators are type-safe and total', () => {
  assert.ok(evaluateCondition({ 'payload.corroboration': { lt: 2 } }, subject));
  assert.ok(!evaluateCondition({ 'payload.corroboration': { gte: 2 } }, subject));
  assert.ok(!evaluateCondition({ 'payload.text': { gt: 2 } }, subject), 'a string is not > a number');
});

test('glob, regex, contains and exists behave as documented', () => {
  assert.ok(evaluateCondition({ resource: { glob: 'public/**' } }, subject));
  assert.ok(evaluateCondition({ resource: { glob: ['private/**', 'public/**'] } }, subject));
  assert.ok(evaluateCondition({ 'payload.text': { regex: '^hello' } }, subject));
  assert.ok(evaluateCondition({ 'agent.dataCategories': { contains: 'personal_data' } }, subject));
  assert.ok(evaluateCondition({ 'payload.sources': { exists: true } }, subject));
  assert.ok(evaluateCondition({ 'payload.absent': { exists: false } }, subject));
});

test('all, any and not compose', () => {
  assert.ok(evaluateCondition({ all: [{ kind: 'publish' }, { 'payload.flagged': true }] }, subject));
  assert.ok(evaluateCondition({ any: [{ kind: 'data.read' }, { kind: 'publish' }] }, subject));
  assert.ok(evaluateCondition({ not: { kind: 'data.read' } }, subject));
  assert.ok(!evaluateCondition({ all: [{ kind: 'publish' }, { kind: 'data.read' }] }, subject));
});

test('an unknown operator never passes, so an unreviewed rule cannot allow', () => {
  assert.ok(!evaluateCondition({ resource: { startsWith: 'public' } }, subject));
  assert.deepEqual([...unknownOperators({ resource: { startsWith: 'public' } })], ['startsWith']);
  assert.deepEqual([...unknownOperators({ all: [{ x: { glob: 'a' } }] })], []);
});

test('a malformed regex is false rather than an exception', () => {
  assert.doesNotThrow(() => evaluateCondition({ 'payload.text': { regex: '([' } }, subject));
  assert.ok(!evaluateCondition({ 'payload.text': { regex: '([' } }, subject));
});

test('an absent condition matches everything', () => {
  assert.ok(evaluateCondition(undefined, subject));
});
