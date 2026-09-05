import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetMeter } from './budget.js';
import type { Syscall } from '../types.js';

const call = (kind: Syscall['kind'], payload: Record<string, unknown> = {}): Syscall => ({
  id: 's', ts: '2026-09-05T00:00:00.000Z', runId: 'r', agentId: 'a', kind, resource: 'x', payload,
});

test('the syscall ceiling stops a runaway loop', () => {
  const meter = new BudgetMeter({ maxSyscalls: 2 });
  meter.record(call('data.read'));
  meter.record(call('data.read'));
  const verdict = meter.check(call('data.read'));
  assert.ok(!verdict.ok);
  assert.equal(verdict.limit, 'maxSyscalls');
});

test('model calls and model input are metered separately', () => {
  const meter = new BudgetMeter({ maxModelCalls: 1, maxModelInputChars: 100 });
  meter.record(call('model.complete', { prompt: 'x'.repeat(50) }));
  assert.equal(meter.check(call('model.complete', { prompt: 'y' })).limit, 'maxModelCalls');

  const wide = new BudgetMeter({ maxModelInputChars: 60 });
  wide.record(call('model.complete', { prompt: 'x'.repeat(50) }));
  assert.equal(wide.check(call('model.complete', { prompt: 'y'.repeat(20) })).limit, 'maxModelInputChars');
});

test('publications have their own ceiling', () => {
  const meter = new BudgetMeter({ maxPublishes: 1 });
  meter.record(call('publish'));
  assert.equal(meter.check(call('publish')).limit, 'maxPublishes');
  assert.ok(meter.check(call('data.read')).ok, 'other kinds are unaffected');
});

test('usage is reported for the run report', () => {
  const meter = new BudgetMeter({});
  meter.record(call('model.complete', { prompt: 'abc', system: 'de' }));
  meter.record(call('publish'));
  const usage = meter.snapshot();
  assert.equal(usage.syscalls, 2);
  assert.equal(usage.modelCalls, 1);
  assert.equal(usage.modelInputChars, 5);
  assert.equal(usage.publishes, 1);
});

test('an empty budget permits everything', () => {
  const meter = new BudgetMeter();
  for (let i = 0; i < 50; i++) meter.record(call('data.read'));
  assert.ok(meter.check(call('data.read')).ok);
});
