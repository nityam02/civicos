import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryLedger, FileLedger, verifyChain, GENESIS } from './ledger.js';
import type { AuditRecord } from '../types.js';

function seed(ledger: MemoryLedger | FileLedger, count = 3) {
  for (let i = 0; i < count; i++) {
    ledger.append({
      ts: `2026-09-05T00:00:0${i}.000Z`,
      runId: 'run_1',
      actor: 'agent-a',
      event: 'syscall',
      kind: 'publish',
      resource: `public/${i}.md`,
      outcome: 'ok',
    });
  }
}

test('the first record chains to GENESIS and each record to the last', () => {
  const ledger = new MemoryLedger();
  seed(ledger);
  const records = ledger.records();
  assert.equal(records[0]!.prevHash, GENESIS);
  assert.equal(records[1]!.prevHash, records[0]!.hash);
  assert.equal(records[2]!.prevHash, records[1]!.hash);
  assert.equal(ledger.headHash, records[2]!.hash);
  assert.equal(ledger.length, 3);
});

test('an intact chain verifies', () => {
  const ledger = new MemoryLedger();
  seed(ledger, 5);
  const result = ledger.verify();
  assert.ok(result.ok);
  assert.equal(result.length, 5);
});

test('editing a record is detected', () => {
  const ledger = new MemoryLedger();
  seed(ledger);
  const tampered = ledger.records();
  tampered[1] = { ...tampered[1]!, resource: 'public/rewritten.md' };
  const result = verifyChain(tampered);
  assert.ok(!result.ok);
  assert.equal(result.brokenAt, 1);
  assert.match(result.reason!, /modified after it was written/);
});

test('removing a record is detected', () => {
  const ledger = new MemoryLedger();
  seed(ledger, 4);
  const records = ledger.records();
  const result = verifyChain([records[0]!, records[2]!, records[3]!]);
  assert.ok(!result.ok);
  assert.equal(result.brokenAt, 1);
});

test('reordering records is detected', () => {
  const ledger = new MemoryLedger();
  seed(ledger, 3);
  const [a, b, c] = ledger.records() as [AuditRecord, AuditRecord, AuditRecord];
  const result = verifyChain([a, c, b]);
  assert.ok(!result.ok);
});

test('the file ledger survives a restart and keeps chaining', () => {
  const dir = mkdtempSync(join(tmpdir(), 'civicos-ledger-'));
  const path = join(dir, 'audit.jsonl');
  const first = new FileLedger(path);
  seed(first, 2);
  const headAfterFirst = first.headHash;

  const reopened = new FileLedger(path);
  assert.equal(reopened.length, 2);
  assert.equal(reopened.headHash, headAfterFirst);
  seed(reopened, 1);
  assert.equal(reopened.length, 3);
  assert.ok(reopened.verify().ok);
  assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 3);
});

test('a hand-edited ledger file fails verification', () => {
  const dir = mkdtempSync(join(tmpdir(), 'civicos-ledger-'));
  const path = join(dir, 'audit.jsonl');
  const ledger = new FileLedger(path);
  seed(ledger, 3);

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const record = JSON.parse(lines[1]!) as AuditRecord;
  record.outcome = 'error';
  lines[1] = JSON.stringify(record);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');

  assert.ok(!new FileLedger(path).verify().ok);
});

test('records can be filtered by run', () => {
  const ledger = new MemoryLedger();
  seed(ledger, 2);
  ledger.append({ ts: '2026-09-05T00:01:00.000Z', runId: 'run_2', actor: 'agent-b', event: 'run.start' });
  assert.equal(ledger.byRun('run_1').length, 2);
  assert.equal(ledger.byRun('run_2').length, 1);
});
