/**
 * What a tamper-evident ledger actually buys you.
 *
 * We write a run to disk, verify it, then edit one record the way an operator
 * under pressure might - and watch verification catch it.
 *
 *   node examples/04-audit-verification/index.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap, FileLedger, ScriptedGateway, createLogger } from '@civicos/core';
import { referenceAgents } from '@civicos/agents';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const stateDir = mkdtempSync(join(tmpdir(), 'civicos-audit-'));
const ledgerPath = join(stateDir, 'audit.jsonl');

const d = bootstrap({
  root,
  policyDir: join(root, 'policies'),
  stateDir,
  gateway: new ScriptedGateway([{ vote: 'approve', approver: 'ana', reasonCode: 'accurate' }]),
  logger: createLogger({ level: 'error' }),
});
for (const agent of referenceAgents()) d.supervisor.register(agent);
await d.supervisor.runAgent('ngo-doc-summarizer', 'data/samples/ngo-report.txt');

const before = new FileLedger(ledgerPath).verify();
console.log('\nafter the run');
console.log('  records:', before.length);
console.log('  intact: ', before.ok);
console.log('  head:   ', before.headHash);
console.log('\n  Publish that head hash - in a report, a git commit, a newspaper - and');
console.log('  anyone holding a copy of the log can prove it has not been rewritten.');

// Someone decides a denial looks bad and quietly rewrites it.
const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
const target = lines.findIndex((line) => JSON.parse(line).event === 'approval.resolved');
const record = JSON.parse(lines[target]);
record.approval.approvers = ['the-boss'];
lines[target] = JSON.stringify(record);
writeFileSync(ledgerPath, `${lines.join('\n')}\n`, 'utf8');

const after = new FileLedger(ledgerPath).verify();
console.log('\nafter someone edits record', target, 'to change who approved it');
console.log('  intact: ', after.ok);
console.log('  broke at record:', after.brokenAt);
console.log('  reason: ', after.reason);
console.log('\n  Note what this does and does not give you. It does not stop an operator');
console.log('  with write access from editing the file. It makes the edit impossible to');
console.log('  hide from anyone who saw the earlier head hash.\n');
