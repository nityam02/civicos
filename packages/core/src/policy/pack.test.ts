import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicyPack, lintPolicyPack } from './pack.js';

const HEADER = `
id: sample
version: 1.0.0
title: Sample
description: Sample pack.
authority:
  - framework: test
    reference: "n/a"
    requirement: n/a
defaults:
  effect: deny
rules:
`;

test('a pack with an approval effect but no approval block is rejected', () => {
  assert.throws(
    () =>
      parsePolicyPack(`${HEADER}
  - id: escalate
    description: escalate this action for review
    when: { kind: publish }
    effect: require_approval
`),
    /declares no approval block/,
  );
});

test('unknown syscall kinds, effects, obligations and operators are rejected', () => {
  assert.throws(() => parsePolicyPack(`${HEADER}
  - id: bad-kind
    description: matches a kind that does not exist
    when: { kind: telepathy }
    effect: allow
`), /unknown syscall kind/);

  assert.throws(() => parsePolicyPack(`${HEADER}
  - id: bad-effect
    description: uses an effect that does not exist
    when: { kind: publish }
    effect: maybe
`), /invalid effect/);

  assert.throws(() => parsePolicyPack(`${HEADER}
  - id: bad-obligation
    description: attaches an obligation that does not exist
    when: { kind: publish }
    effect: allow
    obligations:
      - type: teleport
`), /unknown obligation/);

  assert.throws(() => parsePolicyPack(`${HEADER}
  - id: bad-operator
    description: uses an operator the engine does not implement
    when:
      resource: { startsWith: "public" }
    effect: allow
`), /unknown operator/);
});

test('duplicate rule ids are rejected', () => {
  assert.throws(() => parsePolicyPack(`${HEADER}
  - id: twice
    description: the first rule with this id
    when: { kind: publish }
    effect: allow
  - id: twice
    description: the second rule with this id
    when: { kind: publish }
    effect: allow
`), /duplicate rule id/);
});

test('a fail-open default is a warning, not silence', () => {
  const pack = parsePolicyPack(`
id: open
version: 1.0.0
title: Open
description: A pack that fails open.
authority:
  - framework: test
    reference: "n/a"
    requirement: n/a
defaults:
  effect: allow
rules:
  - id: noop
    description: does nothing in particular
    when: { kind: publish }
    effect: allow
`);
  const issues = lintPolicyPack(pack);
  assert.ok(issues.some((i) => i.level === 'warning' && i.message.includes('fails open')));
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
});
