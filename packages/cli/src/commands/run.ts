import { resolve } from 'node:path';
import { disasterResponsePlan } from '@civicos/agents';
import type { RunReport } from '@civicos/core';
import type { ParsedArgs } from '../args.js';
import { flagBool, flagOptional } from '../args.js';
import { openDeployment, paint, registerReferenceAgents, table } from './shared.js';

const PLANS: Record<string, (input: string) => ReturnType<typeof disasterResponsePlan>> = {
  'disaster-info-coordinator': disasterResponsePlan,
};

export async function runCommand(args: ParsedArgs): Promise<number> {
  const target = args.positional[1];
  if (!target) {
    process.stderr.write('usage: civicos run <agent-or-plan> --input <path>\n');
    return 2;
  }

  const deployment = registerReferenceAgents(await openDeployment(args.flags));
  const input = flagOptional(args.flags, 'input');
  const asJson = flagBool(args.flags, 'json');

  let report: RunReport;
  const planFactory = PLANS[target];
  if (planFactory) {
    if (!input) {
      process.stderr.write(`plan "${target}" needs --input <path>\n`);
      return 2;
    }
    report = await deployment.supervisor.run(planFactory(relativise(deployment.paths.root, input)));
  } else if (deployment.supervisor.agent(target)) {
    report = await deployment.supervisor.runAgent(
      target,
      input ? relativise(deployment.paths.root, input) : undefined,
    );
  } else {
    process.stderr.write(
      `unknown agent or plan "${target}". Try: civicos agents list\n`,
    );
    return 2;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === 'failed' ? 1 : 0;
  }

  process.stdout.write('\n');
  process.stdout.write(paint('bold', `run ${report.runId}  (${report.planId})\n`));
  process.stdout.write(
    table(
      report.outcomes.map((outcome) => [
        outcome.taskId,
        outcome.agentId,
        statusLabel(outcome.status),
        outcome.result?.summary ?? outcome.error ?? '',
      ]),
      ['task', 'agent', 'status', 'result'],
    ),
  );
  process.stdout.write('\n\n');

  const pending = deployment.approvals.list({ status: 'pending', runId: report.runId });
  if (pending.length > 0) {
    process.stdout.write(
      paint('yellow', `${pending.length} action(s) are waiting for a human decision.\n`),
    );
    for (const request of pending) {
      process.stdout.write(`  ${request.id}  ${request.summary}\n`);
    }
    process.stdout.write(
      paint('dim', '  Review them with: civicos approvals list\n'),
    );
    process.stdout.write('\n');
  }

  process.stdout.write(
    paint('dim', `ledger: ${report.ledgerLength} records, head ${report.ledgerHead.slice(0, 16)}...\n`),
  );
  if (deployment.kernel.dryRun) {
    process.stdout.write(paint('yellow', 'dry run: policy was evaluated, nothing was executed.\n'));
  }
  process.stdout.write('\n');
  return report.status === 'failed' ? 1 : 0;
}

function statusLabel(status: string): string {
  if (status === 'ok') return paint('green', 'ok');
  if (status === 'error') return paint('red', 'error');
  return paint('dim', status);
}

/** Handler paths are relative to the deployment root; accept absolute input too. */
function relativise(root: string, input: string): string {
  const abs = resolve(input);
  return abs.startsWith(root) ? abs.slice(root.length + 1) : input;
}
