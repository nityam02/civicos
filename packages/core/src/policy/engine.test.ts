import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyEngine } from './engine.js';
import { parsePolicyPack } from './pack.js';
import type { AgentManifest, Syscall } from '../types.js';

const pack = (id: string, body: string) =>
  parsePolicyPack(`
id: ${id}
version: 1.0.0
title: ${id} test pack
description: Test pack.
authority:
  - framework: test
    reference: "n/a"
    requirement: n/a
defaults:
  effect: deny
  risk: 10
rules:${body.trim() === '' ? ' []' : `\n${body}`}
`);

const manifest: AgentManifest = {
  id: 'test-agent',
  name: 'Test',
  version: '1.0.0',
  purpose: 'An agent used only to exercise the policy engine in the test suite.',
  riskTier: 'limited',
  owner: 'tests',
  contact: 'tests@civicos.invalid',
  capabilities: [{ resource: '**', actions: ['publish', 'data.read', 'model.complete'] }],
  policies: ['alpha'],
  dataCategories: [],
  humanOversight: { required: true, roles: ['editor'] },
};

const syscall = (kind: Syscall['kind'], resource: string, payload: Record<string, unknown> = {}): Syscall => ({
  id: 'sys_1',
  ts: '2026-09-05T00:00:00.000Z',
  runId: 'run_1',
  agentId: 'test-agent',
  kind,
  resource,
  payload,
});

test('nothing is permitted unless a rule says so', () => {
  const engine = new PolicyEngine([pack('alpha', '')]);
  const decision = engine.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.equal(decision.effect, 'deny');
  assert.ok(decision.usedDefault);
  assert.equal(decision.reasons.at(-1)?.ruleId, 'default');
});

test('deny beats approval beats allow, whatever the rule order', () => {
  const body = `
  - id: allow-it
    description: allow the action
    when: { kind: publish }
    effect: allow
  - id: escalate-it
    description: escalate the action
    when: { kind: publish }
    effect: require_approval
    approval: { role: editor, quorum: 1, expiresInMs: 1000, reasonCodes: [ok] }
  - id: deny-it
    description: deny the action
    when: { kind: publish }
    effect: deny
`;
  const engine = new PolicyEngine([pack('alpha', body)]);
  assert.equal(engine.evaluate(syscall('publish', 'public/x.md'), manifest).effect, 'deny');

  const withoutDeny = new PolicyEngine([pack('alpha', body.split('  - id: deny-it')[0]!)]);
  const decision = withoutDeny.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.equal(decision.effect, 'require_approval');
  assert.equal(decision.approval?.role, 'editor');
});

test('a denial carries no obligations, because nothing runs', () => {
  const engine = new PolicyEngine([
    pack(
      'alpha',
      `
  - id: label-it
    description: attach a label
    when: { kind: publish }
    effect: transform
    obligations:
      - type: label
        text: "notice"
  - id: deny-it
    description: deny the action
    when: { kind: publish }
    effect: deny
`,
    ),
  ]);
  const decision = engine.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.equal(decision.effect, 'deny');
  assert.deepEqual(decision.obligations, []);
});

test('transform rules contribute obligations without deciding the outcome', () => {
  const engine = new PolicyEngine([
    pack(
      'alpha',
      `
  - id: allow-it
    description: allow the action
    when: { kind: publish }
    effect: allow
  - id: label-it
    description: attach a label
    when: { kind: publish }
    effect: transform
    obligations:
      - type: label
        text: "notice"
  - id: label-again
    description: attach the same label twice
    when: { kind: publish }
    effect: transform
    obligations:
      - type: label
        text: "notice"
`,
    ),
  ]);
  const decision = engine.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.equal(decision.effect, 'allow');
  assert.equal(decision.obligations.length, 1, 'identical obligations are de-duplicated');
});

test('only the packs the manifest declares are in force', () => {
  const alpha = pack('alpha', `
  - id: allow-it
    description: allow the action
    when: { kind: publish }
    effect: allow
`);
  const beta = pack('beta', `
  - id: deny-it
    description: deny everything
    when: { kind: publish }
    effect: deny
`);
  const engine = new PolicyEngine([alpha, beta]);
  assert.equal(engine.evaluate(syscall('publish', 'p/x'), manifest).effect, 'allow');
  const bound = { ...manifest, policies: ['alpha', 'beta'] };
  assert.equal(engine.evaluate(syscall('publish', 'p/x'), bound).effect, 'deny');
});

test('competing approval requirements merge to the most demanding', () => {
  const engine = new PolicyEngine([
    pack(
      'alpha',
      `
  - id: one-reviewer
    description: one reviewer
    when: { kind: publish }
    effect: require_approval
    approval: { role: editor, quorum: 1, expiresInMs: 7200000, reasonCodes: [a] }
  - id: two-reviewers
    description: two reviewers
    when: { kind: publish }
    effect: require_approval
    approval: { role: board, quorum: 2, expiresInMs: 1800000, reasonCodes: [b] }
`,
    ),
  ]);
  const decision = engine.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.equal(decision.approval?.quorum, 2);
  assert.equal(decision.approval?.role, 'board');
  assert.equal(decision.approval?.expiresInMs, 1_800_000, 'the shortest window wins');
  assert.deepEqual(decision.approval?.reasonCodes.sort(), ['a', 'b']);
});

test('every matched rule is reported, so a decision can be explained', () => {
  const engine = new PolicyEngine([
    pack(
      'alpha',
      `
  - id: allow-it
    description: allow the action
    when: { kind: publish }
    effect: allow
    controls: [TEST-1]
  - id: label-it
    description: attach a label
    when: { kind: publish }
    effect: transform
    controls: [TEST-2]
`,
    ),
  ]);
  const decision = engine.evaluate(syscall('publish', 'public/x.md'), manifest);
  assert.deepEqual(decision.reasons.map((r) => r.ruleId), ['allow-it', 'label-it']);
  assert.deepEqual(decision.reasons.flatMap((r) => r.controls), ['TEST-1', 'TEST-2']);
});

test('risk scores accumulate and stay within 0-100', () => {
  const engine = new PolicyEngine([
    pack(
      'alpha',
      `
  - id: risky
    description: a risky action
    when: { kind: publish }
    effect: allow
    risk: 80
  - id: riskier
    description: an even riskier action
    when: { kind: publish }
    effect: allow
    risk: 80
`,
    ),
  ]);
  assert.equal(engine.evaluate(syscall('publish', 'p/x'), manifest).riskScore, 100);
});
