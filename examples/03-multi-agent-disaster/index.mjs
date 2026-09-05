/**
 * Three narrow agents, one pipeline.
 *
 *   node examples/03-multi-agent-disaster/index.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap, ScriptedGateway, createLogger, buildTransparencySummary } from '@civicos/core';
import { referenceAgents, disasterResponsePlan } from '@civicos/agents';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const d = bootstrap({
  root,
  policyDir: join(root, 'policies'),
  stateDir: mkdtempSync(join(tmpdir(), 'civicos-example-')),
  ephemeral: true,
  gateway: new ScriptedGateway([{ vote: 'approve', approver: 'duty-officer-1', reasonCode: 'accurate' }]),
  logger: createLogger({ level: 'error' }),
});
for (const agent of referenceAgents()) d.supervisor.register(agent);

const report = await d.supervisor.run(disasterResponsePlan('data/samples/incoming-reports.jsonl'));

console.log('\npipeline');
for (const outcome of report.outcomes) {
  console.log(`  ${outcome.taskId.padEnd(7)} ${outcome.status.padEnd(6)} ${outcome.result?.summary ?? outcome.error}`);
}

const brief = report.outcomes.at(-1).result.output;
console.log('\nwhat the policy did to the product');
console.log('  clusters published:  ', brief.clusters);
console.log('  clusters withheld:   ', brief.withheld, '(identify individuals)');
console.log('  weakest corroboration:', brief.minimumCorroboration, 'channel(s)');

const summary = buildTransparencySummary(d.ledger);
console.log('\naccountability');
console.log('  mediated actions:', summary.totals.syscalls);
console.log('  escalated:       ', summary.totals.byEffect.require_approval);
console.log('  redacted values: ', summary.totals.redactions);
console.log('  ledger intact:   ', summary.integrity.ok, `(${summary.integrity.length} records)`);
console.log('\nrules that fired');
for (const rule of summary.topRules.slice(0, 6)) {
  console.log(`  ${String(rule.hits).padStart(3)}x ${rule.packId}/${rule.ruleId} -> ${rule.effect}`);
}
console.log('');
