import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from './kernel.js';
import { ApprovalStore, AutoDenyGateway, QueueGateway, ScriptedGateway } from './approvals.js';
import { MemoryLedger } from '../audit/ledger.js';
import { PolicyEngine } from '../policy/engine.js';
import { parsePolicyPack } from '../policy/pack.js';
import { DeterministicModel } from '../providers/deterministic.js';
import { createMemoryLogger } from '../util/logger.js';
import { fixedClock } from '../util/clock.js';
import type { AgentManifest, SyscallHandler } from '../types.js';
import type { ApprovalGateway } from './approvals.js';

const PACK = `
id: test
version: 1.0.0
title: Kernel test pack
description: Rules used by the kernel integration tests.
authority:
  - framework: test
    reference: "n/a"
    requirement: n/a
defaults:
  effect: deny
  risk: 10
rules:
  - id: allow-model
    description: allow model calls with redaction
    when:
      kind: model.complete
    effect: allow
    obligations:
      - type: redact
        fields: [payload.prompt]
        detectors: [email]
  - id: allow-write
    description: allow workspace writes
    when:
      kind: data.write
      resource: { glob: "workspace/**" }
    effect: allow
  - id: escalate-publish
    description: publication needs a human
    when:
      kind: publish
    effect: require_approval
    approval:
      role: editor
      quorum: 1
      expiresInMs: 60000
      reasonCodes: [accurate, harm_risk]
    obligations:
      - type: cite
        fields: [payload.sources]
      - type: label
        text: "Reviewed by a human."
  - id: deny-network
    description: no outbound network
    when:
      kind: net.fetch
    effect: deny
  - id: rate-limit-writes
    description: cap repeated writes to one resource
    when:
      kind: data.write
    effect: transform
    obligations:
      - type: rate_limit
        max: 3
        windowMs: 60000
`;

const manifest: AgentManifest = {
  id: 'test-agent',
  name: 'Test agent',
  version: '1.0.0',
  purpose: 'Exercises every gate in the kernel so the tests cover the real mediation path.',
  riskTier: 'limited',
  owner: 'tests',
  contact: 'tests@civicos.invalid',
  capabilities: [
    { resource: 'model/**', actions: ['model.complete'] },
    { resource: 'workspace/**', actions: ['data.write'] },
    { resource: 'public/**', actions: ['publish'] },
    { resource: 'net/**', actions: ['net.fetch'] },
  ],
  policies: ['test'],
  dataCategories: ['personal_data'],
  humanOversight: { required: true, roles: ['editor'] },
};

interface Harness {
  kernel: Kernel;
  ledger: MemoryLedger;
  approvals: ApprovalStore;
  executed: Array<{ kind: string; payload: Record<string, unknown> }>;
}

function harness(options: { gateway?: ApprovalGateway; dryRun?: boolean } = {}): Harness {
  const ledger = new MemoryLedger();
  const clock = fixedClock('2026-09-05T00:00:00.000Z', 1000);
  const approvals = new ApprovalStore(clock);
  const executed: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const recorder = (kind: SyscallHandler['kind']): SyscallHandler => ({
    kind,
    resource: '**',
    async execute(syscall) {
      executed.push({ kind, payload: syscall.payload });
      return { ok: true, payload: syscall.payload };
    },
  });

  const kernel = new Kernel({
    policy: new PolicyEngine([parsePolicyPack(PACK)]),
    ledger,
    approvals,
    model: new DeterministicModel(),
    gateway: options.gateway ?? new QueueGateway(),
    clock,
    logger: createMemoryLogger(),
    dryRun: options.dryRun ?? false,
  });
  kernel.registerHandler(recorder('model.complete'));
  kernel.registerHandler(recorder('data.write'));
  kernel.registerHandler(recorder('publish'));
  kernel.registerHandler(recorder('net.fetch'));
  kernel.registerAgent(manifest);
  return { kernel, ledger, approvals, executed };
}

test('an agent cannot act outside its declared capabilities', async () => {
  const h = harness();
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'data.read',
    resource: 'corpus/anything',
    payload: {},
  });
  assert.ok(!result.ok);
  assert.match(result.error!, /holds no capability for data.read/);
  assert.equal(h.executed.length, 0);
  assert.equal(h.ledger.records().at(-1)?.event, 'capability.denied');
});

test('policy can refuse an action the capability permits', async () => {
  const h = harness();
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'net.fetch',
    resource: 'net/example',
    payload: { url: 'https://example.org' },
  });
  assert.ok(!result.ok);
  assert.equal(result.decision.effect, 'deny');
  assert.match(result.error!, /deny-network/);
  assert.equal(h.executed.length, 0);
});

test('obligations rewrite the payload before the handler ever sees it', async () => {
  const h = harness();
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'model.complete',
    resource: 'model/summarize',
    payload: { prompt: 'contact eleni@example.org about the report', task: 'summarize' },
  });
  assert.ok(result.ok);
  const seen = h.executed[0]!.payload.prompt as string;
  assert.ok(!seen.includes('eleni@example.org'));
  assert.match(seen, /\[REDACTED:email#/);
  assert.equal(h.ledger.records().at(-1)?.redactions?.[0]?.detector, 'email');
});

test('publication is held when no reviewer answers, and nothing is executed', async () => {
  const h = harness();
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'publish',
    resource: 'public/brief.md',
    payload: { text: 'body', sources: ['doc-1'] },
  });
  assert.ok(!result.ok);
  assert.equal(result.decision.effect, 'require_approval');
  assert.match(result.error!, /approval pending/);
  assert.equal(h.executed.length, 0);
  assert.equal(h.approvals.list({ status: 'pending' }).length, 1);
});

test('an unattended run refuses rather than allowing', async () => {
  const h = harness({ gateway: new AutoDenyGateway() });
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'publish',
    resource: 'public/brief.md',
    payload: { text: 'body', sources: ['doc-1'] },
  });
  assert.ok(!result.ok);
  assert.match(result.error!, /approval denied/);
});

test('an approved publication runs, is labelled, and records who approved it', async () => {
  const h = harness({ gateway: new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]) });
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'publish',
    resource: 'public/brief.md',
    payload: { text: 'body', sources: ['doc-1'] },
  });
  assert.ok(result.ok);
  assert.equal(h.executed.length, 1);
  assert.match(h.executed[0]!.payload.text as string, /^> Reviewed by a human\./);

  const records = h.ledger.records();
  assert.ok(records.some((r) => r.event === 'approval.requested'));
  const resolved = records.find((r) => r.event === 'approval.resolved');
  assert.equal(resolved?.approval?.status, 'approved');
  assert.deepEqual(resolved?.approval?.approvers, ['ana']);
});

test('an unsourced publication is stopped before it reaches a reviewer', async () => {
  const h = harness({ gateway: new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]) });
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1',
    kind: 'publish',
    resource: 'public/brief.md',
    payload: { text: 'body', sources: [] },
  });
  assert.ok(!result.ok);
  assert.match(result.error!, /obligation "cite" is not satisfied/);
  assert.equal(h.approvals.list().length, 0, 'no reviewer was troubled with an unsourced document');
  assert.equal(h.ledger.records().at(-1)?.event, 'obligation.unsatisfied');
});

test('a rate limit caps repeated actions on the same resource', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    const ok = await h.kernel.syscall('test-agent', {
      runId: 'r1', kind: 'data.write', resource: 'workspace/notes.md', payload: { text: 'x' },
    });
    assert.ok(ok.ok, `write ${i} should succeed`);
  }
  const blocked = await h.kernel.syscall('test-agent', {
    runId: 'r1', kind: 'data.write', resource: 'workspace/notes.md', payload: { text: 'x' },
  });
  assert.ok(!blocked.ok);
  assert.match(blocked.error!, /rate_limit/);
});

test('a budget ceiling stops the run and is recorded', async () => {
  const ledger = new MemoryLedger();
  const kernel = new Kernel({
    policy: new PolicyEngine([parsePolicyPack(PACK)]),
    ledger,
    model: new DeterministicModel(),
    gateway: new QueueGateway(),
    logger: createMemoryLogger(),
    budget: { maxSyscalls: 1 },
  });
  kernel.registerHandler({ kind: 'data.write', resource: '**', async execute() { return 'ok'; } });
  kernel.registerAgent(manifest);
  const first = await kernel.syscall('test-agent', { runId: 'r1', kind: 'data.write', resource: 'workspace/a', payload: { text: 'x' } });
  assert.ok(first.ok);
  const second = await kernel.syscall('test-agent', { runId: 'r1', kind: 'data.write', resource: 'workspace/b', payload: { text: 'x' } });
  assert.ok(!second.ok);
  assert.equal(ledger.records().at(-1)?.event, 'budget.exceeded');
});

test('a dry run evaluates and logs everything but executes nothing', async () => {
  const h = harness({ dryRun: true, gateway: new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]) });
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1', kind: 'data.write', resource: 'workspace/a.md', payload: { text: 'x' },
  });
  assert.ok(result.ok);
  assert.equal(result.simulated, true);
  assert.equal(h.executed.length, 0);
  assert.equal(h.ledger.records().at(-1)?.decision?.effect, 'allow');
});

test('a handler failure is recorded rather than thrown at the agent', async () => {
  const h = harness();
  h.kernel.registerHandler({
    kind: 'data.write',
    resource: 'workspace/explode',
    async execute() {
      throw new Error('disk on fire');
    },
  });
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1', kind: 'data.write', resource: 'workspace/explode', payload: { text: 'x' },
  });
  assert.ok(!result.ok);
  assert.match(result.error!, /disk on fire/);
  assert.equal(h.ledger.records().at(-1)?.outcome, 'error');
});

test('every mediated action leaves a verifiable receipt in the ledger', async () => {
  const h = harness();
  const result = await h.kernel.syscall('test-agent', {
    runId: 'r1', kind: 'data.write', resource: 'workspace/a.md', payload: { text: 'x' },
  });
  const record = h.ledger.records()[result.receipt.ledgerSeq]!;
  assert.equal(record.hash, result.receipt.recordHash);
  assert.equal(record.syscallId, result.receipt.syscallId);
  assert.ok(h.ledger.verify().ok);
});

test('registering an agent whose policy pack is missing fails loudly', () => {
  const kernel = new Kernel({
    policy: new PolicyEngine([]),
    ledger: new MemoryLedger(),
    model: new DeterministicModel(),
    logger: createMemoryLogger(),
  });
  assert.throws(() => kernel.registerAgent(manifest), /requires policy pack "test"/);
});
