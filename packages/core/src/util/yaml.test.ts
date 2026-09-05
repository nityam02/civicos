import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, parseYamlObject, YamlError } from './yaml.js';

test('parses nested maps and sequences', () => {
  const doc = parseYamlObject(`
id: baseline
version: 1.0.0
defaults:
  effect: deny
  risk: 15
rules:
  - id: allow-read
    effect: allow
    when:
      kind: data.read
  - id: deny-net
    effect: deny
`);
  assert.equal(doc.id, 'baseline');
  assert.deepEqual(doc.defaults, { effect: 'deny', risk: 15 });
  const rules = doc.rules as Array<Record<string, unknown>>;
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0]!.when, { kind: 'data.read' });
  assert.equal(rules[1]!.id, 'deny-net');
});

test('supports sequences indented at the parent key level', () => {
  const doc = parseYamlObject(`
controls:
- EU-AI-ACT-ART-14
- UNESCO-OVERSIGHT
`);
  assert.deepEqual(doc.controls, ['EU-AI-ACT-ART-14', 'UNESCO-OVERSIGHT']);
});

test('parses flow sequences and flow maps', () => {
  const doc = parseYamlObject(`
fields: [payload.text, payload.prompt]
resource: { glob: "public/**" }
nested: { any: [a, b], deep: { x: 1 } }
`);
  assert.deepEqual(doc.fields, ['payload.text', 'payload.prompt']);
  assert.deepEqual(doc.resource, { glob: 'public/**' });
  assert.deepEqual(doc.nested, { any: ['a', 'b'], deep: { x: 1 } });
});

test('parses literal and folded block scalars', () => {
  const doc = parseYamlObject(`
literal: |
  line one
  line two
folded: >
  folded line one
  folded line two
after: tail
`);
  assert.equal(doc.literal, 'line one\nline two\n');
  assert.equal(doc.folded, 'folded line one folded line two\n');
  assert.equal(doc.after, 'tail');
});

test('strips comments but keeps hashes inside values', () => {
  const doc = parseYamlObject(`
a: value # trailing comment
# whole line comment
b: "text # not a comment"
c: EU-AI-ACT#14
`);
  assert.equal(doc.a, 'value');
  assert.equal(doc.b, 'text # not a comment');
  assert.equal(doc.c, 'EU-AI-ACT#14');
});

test('coerces scalars conservatively', () => {
  const doc = parseYamlObject(`
int: 42
neg: -7
float: 3.5
yes: true
no: false
nothing: null
tilde: ~
text: 1.2.3
quoted: "42"
`);
  assert.equal(doc.int, 42);
  assert.equal(doc.neg, -7);
  assert.equal(doc.float, 3.5);
  assert.equal(doc.yes, true);
  assert.equal(doc.no, false);
  assert.equal(doc.nothing, null);
  assert.equal(doc.tilde, null);
  assert.equal(doc.text, '1.2.3');
  assert.equal(doc.quoted, '42');
});

test('rejects ambiguous boolean spellings rather than guessing', () => {
  assert.throws(() => parseYaml('enabled: yes'), YamlError);
  assert.throws(() => parseYaml('enabled: off'), YamlError);
  assert.equal((parseYamlObject('enabled: "yes"')).enabled, 'yes');
});

test('rejects tabs, duplicate keys, anchors and trailing garbage', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), /tabs are not allowed/);
  assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key/);
  assert.throws(() => parseYaml('a: &anchor value'), /anchors, aliases and tags/);
  assert.throws(() => parseYaml('a: 1\n  b: 2'), YamlError);
});

test('requires a mapping at the top level of a policy document', () => {
  assert.throws(() => parseYamlObject('- one\n- two'), /expected a mapping/);
});

test('round-trips a realistic rule with obligations', () => {
  const doc = parseYamlObject(`
rules:
  - id: require-approval-before-publication
    description: Anything visible outside the system is signed off first.
    when:
      kind: publish
      resource: { glob: "public/**" }
    effect: require_approval
    approval:
      role: editor
      quorum: 2
      expiresInMs: 3600000
      reasonCodes: [accurate, harm_risk]
    obligations:
      - type: label
        text: "Reviewed by a human."
      - type: cite
        fields: [payload.sources]
`);
  const rule = (doc.rules as Array<Record<string, unknown>>)[0]!;
  assert.equal(rule.effect, 'require_approval');
  assert.deepEqual(rule.approval, {
    role: 'editor',
    quorum: 2,
    expiresInMs: 3600000,
    reasonCodes: ['accurate', 'harm_risk'],
  });
  assert.deepEqual(rule.obligations, [
    { type: 'label', text: 'Reviewed by a human.' },
    { type: 'cite', fields: ['payload.sources'] },
  ]);
});
