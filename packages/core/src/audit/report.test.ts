import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryLedger } from './ledger.js';
import { buildTransparencySummary, renderTransparencyMarkdown } from './report.js';

function populate(): MemoryLedger {
  const ledger = new MemoryLedger();
  ledger.append({ ts: '2026-09-05T00:00:00.000Z', runId: 'r1', actor: 'kernel', event: 'run.start' });
  ledger.append({
    ts: '2026-09-05T00:00:01.000Z',
    runId: 'r1',
    actor: 'agent-a',
    event: 'syscall',
    kind: 'model.complete',
    resource: 'model/summarize',
    decision: {
      effect: 'allow',
      riskScore: 3,
      usedDefault: false,
      reasons: [{ ruleId: 'allow-model', packId: 'baseline', effect: 'allow', description: 'ok', controls: ['C-1'] }],
    },
    redactions: [{ detector: 'email', field: 'payload.prompt', commitment: 'abc', count: 2 }],
    outcome: 'ok',
  });
  ledger.append({
    ts: '2026-09-05T00:00:02.000Z',
    runId: 'r1',
    actor: 'agent-a',
    event: 'syscall',
    kind: 'net.fetch',
    resource: 'net/example',
    decision: {
      effect: 'deny',
      riskScore: 70,
      usedDefault: false,
      reasons: [{ ruleId: 'deny-net', packId: 'baseline', effect: 'deny', description: 'no network', controls: ['C-2'] }],
    },
    outcome: 'skipped',
  });
  ledger.append({
    ts: '2026-09-05T00:00:03.000Z',
    runId: 'r1',
    actor: 'agent-a',
    event: 'approval.resolved',
    approval: { requestId: 'apr_1', status: 'approved', approvers: ['ana'], reasonCodes: ['accurate'] },
  });
  return ledger;
}

test('the summary counts actions, effects, approvals and redactions', () => {
  const summary = buildTransparencySummary(populate());
  assert.equal(summary.totals.syscalls, 2);
  assert.equal(summary.totals.byEffect.allow, 1);
  assert.equal(summary.totals.byEffect.deny, 1);
  assert.equal(summary.totals.redactions, 2);
  assert.equal(summary.totals.approvalsGranted, 1);
  assert.equal(summary.totals.runs, 1);
  assert.deepEqual(summary.agents, [{ agentId: 'agent-a', syscalls: 2, denied: 1, escalated: 0 }]);
});

test('the summary reports which rules fired and which controls they exercise', () => {
  const summary = buildTransparencySummary(populate());
  assert.deepEqual(summary.topRules.map((r) => r.ruleId).sort(), ['allow-model', 'deny-net']);
  assert.deepEqual(summary.controls.map((c) => c.control).sort(), ['C-1', 'C-2']);
});

test('the summary reports ledger integrity alongside the numbers', () => {
  const summary = buildTransparencySummary(populate());
  assert.ok(summary.integrity.ok);
  assert.equal(summary.integrity.length, 4);
});

test('a time window filters the records considered', () => {
  const summary = buildTransparencySummary(populate(), { since: new Date('2026-09-05T00:00:02.000Z') });
  assert.equal(summary.totals.syscalls, 1);
  assert.equal(summary.totals.byEffect.deny, 1);
});

test('the markdown rendering states integrity and the headline counts', () => {
  const markdown = renderTransparencyMarkdown(buildTransparencySummary(populate()));
  assert.match(markdown, /# CivicOS transparency report/);
  assert.match(markdown, /Status: INTACT/);
  assert.match(markdown, /\| Denied by policy \| 1 \|/);
  assert.match(markdown, /deny-net/);
});
