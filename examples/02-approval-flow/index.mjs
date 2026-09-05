/**
 * Human oversight, three ways: refused, held, approved.
 *
 * The same publication is attempted under three different approval gateways.
 * The agent and the policy are identical each time; only who is available to
 * answer changes.
 *
 *   node examples/02-approval-flow/index.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bootstrap,
  AutoDenyGateway,
  QueueGateway,
  ScriptedGateway,
  createLogger,
} from '@civicos/core';
import { referenceAgents } from '@civicos/agents';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function deployment(gateway) {
  const d = bootstrap({
    root,
    policyDir: join(root, 'policies'),
    stateDir: mkdtempSync(join(tmpdir(), 'civicos-example-')),
    ephemeral: true,
    gateway,
    logger: createLogger({ level: 'error' }),
  });
  for (const agent of referenceAgents()) d.supervisor.register(agent);
  return d;
}

async function attempt(label, gateway) {
  const d = deployment(gateway);
  const report = await d.supervisor.runAgent('ngo-doc-summarizer', 'data/samples/ngo-report.txt');
  const output = report.outcomes[0].result.output;
  const pending = d.approvals.list({ status: 'pending' });
  const resolved = d.ledger.records().filter((r) => r.event === 'approval.resolved');

  console.log(`\n${label}`);
  console.log('  published: ', output.published);
  if (!output.published) console.log('  reason:    ', output.publicationError);
  console.log('  queued:    ', pending.length, 'awaiting a human');
  for (const record of resolved) {
    console.log(
      '  decision:  ',
      record.approval.status,
      'by',
      record.approval.approvers.join(', ') || '(nobody)',
      `[${record.approval.reasonCodes.join(', ')}]`,
    );
  }
  console.log('  draft kept at', output.draftPath, '- a refusal is reviewable, not a dead end');
}

console.log('The brief mentions children and safeguarding, so the NGO pack raises the quorum to two.');

await attempt('unattended run (AutoDenyGateway) - fails closed', new AutoDenyGateway());
await attempt('queued for review (QueueGateway) - work continues, publication does not', new QueueGateway());
await attempt(
  'two reviewers sign off (ScriptedGateway) - published',
  new ScriptedGateway([{ vote: 'approve', approver: 'ana', reasonCode: 'accurate' }]),
);
console.log('');
