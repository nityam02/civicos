import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalStore, FileApprovalStore, AutoDenyGateway, QueueGateway, ScriptedGateway } from './approvals.js';
import { fixedClock } from '../util/clock.js';

const input = {
  runId: 'run_1',
  agentId: 'agent-a',
  syscallId: 'sys_1',
  kind: 'publish' as const,
  resource: 'public/x.md',
  summary: 'agent-a requests publish on public/x.md',
  preview: 'redacted preview',
  requiredRole: 'editor',
  quorum: 2,
  expiresInMs: 60_000,
  reasonCodes: ['accurate', 'harm_risk'],
};

test('a quorum of two needs two distinct approvers', () => {
  const store = new ApprovalStore();
  const request = store.create(input);
  const afterOne = store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'accurate' });
  assert.equal(afterOne.status, 'pending');
  const afterTwo = store.vote(request.id, { approver: 'ben', role: 'editor', vote: 'approve', reasonCode: 'accurate' });
  assert.equal(afterTwo.status, 'approved');
});

test('one refusal is decisive even when the quorum is not met', () => {
  const store = new ApprovalStore();
  const request = store.create(input);
  const result = store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'deny', reasonCode: 'harm_risk' });
  assert.equal(result.status, 'denied');
});

test('the same person cannot supply the whole quorum', () => {
  const store = new ApprovalStore();
  const request = store.create(input);
  store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'accurate' });
  assert.throws(
    () => store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'accurate' }),
    /has already voted/,
  );
});

test('the wrong role and an unlisted reason code are both rejected', () => {
  const store = new ApprovalStore();
  const request = store.create(input);
  assert.throws(
    () => store.vote(request.id, { approver: 'ana', role: 'intern', vote: 'approve', reasonCode: 'accurate' }),
    /role "editor" is required/,
  );
  assert.throws(
    () => store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'looks_fine' }),
    /is not permitted here/,
  );
});

test('silence is not consent: an unanswered request expires', () => {
  const clock = fixedClock('2026-09-05T00:00:00.000Z', 30_000);
  const store = new ApprovalStore(clock);
  const request = store.create({ ...input, expiresInMs: 10_000 });
  const expired = store.expireDue();
  assert.equal(expired.length, 1);
  assert.equal(store.get(request.id)?.status, 'expired');
  assert.throws(
    () => store.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'accurate' }),
    /already expired/,
  );
});

test('the file store keeps the queue across processes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'civicos-approvals-'));
  const path = join(dir, 'approvals.json');
  const first = new FileApprovalStore(path);
  const request = first.create(input);
  first.vote(request.id, { approver: 'ana', role: 'editor', vote: 'approve', reasonCode: 'accurate' });

  const reopened = new FileApprovalStore(path);
  const restored = reopened.get(request.id);
  assert.equal(restored?.votes.length, 1);
  assert.equal(restored?.status, 'pending');
  reopened.vote(request.id, { approver: 'ben', role: 'editor', vote: 'approve', reasonCode: 'accurate' });
  assert.equal(reopened.get(request.id)?.status, 'approved');
});

test('the unattended gateway refuses rather than allowing', async () => {
  const store = new ApprovalStore();
  const outcome = await new AutoDenyGateway().request(input, store);
  assert.equal(outcome.status, 'denied');
  assert.equal(outcome.request.votes[0]?.approver, 'system:auto-deny');
});

test('the queue gateway leaves the request for a human and returns pending', async () => {
  const store = new ApprovalStore();
  const outcome = await new QueueGateway().request(input, store);
  assert.equal(outcome.status, 'pending');
  assert.equal(store.list({ status: 'pending' }).length, 1);
});

test('the scripted gateway satisfies a quorum and records who decided', async () => {
  const store = new ApprovalStore();
  const outcome = await new ScriptedGateway([{ vote: 'approve', approver: 'demo:approver' }]).request(input, store);
  assert.equal(outcome.status, 'approved');
  assert.equal(outcome.request.votes.length, 2);
  assert.ok(outcome.request.votes.every((v) => v.approver.startsWith('demo:approver')));
});

test('a scripted gateway with no matching step refuses', async () => {
  const store = new ApprovalStore();
  const gateway = new ScriptedGateway([{ match: () => false, vote: 'approve', approver: 'nobody' }]);
  assert.equal((await gateway.request(input, store)).status, 'denied');
});
