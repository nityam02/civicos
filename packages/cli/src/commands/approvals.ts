import type { ParsedArgs } from '../args.js';
import { flagOptional, flagString } from '../args.js';
import { openDeployment, paint, table } from './shared.js';

export async function approvalsCommand(args: ParsedArgs): Promise<number> {
  const deployment = await openDeployment(args.flags);
  const sub = args.positional[1] ?? 'list';
  deployment.approvals.expireDue();

  if (sub === 'list') {
    const status = flagOptional(args.flags, 'status');
    const requests = deployment.approvals.list(status ? { status: status as 'pending' } : {});
    if (requests.length === 0) {
      process.stdout.write('no approval requests\n');
      return 0;
    }
    process.stdout.write(
      table(
        requests.map((r) => [r.id, r.status, r.requiredRole, `${r.votes.length}/${r.quorum}`, r.summary]),
        ['id', 'status', 'role', 'votes', 'request'],
      ),
    );
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'show') {
    const id = args.positional[2];
    const request = id ? deployment.approvals.get(id) : undefined;
    if (!request) {
      process.stderr.write('usage: civicos approvals show <id>\n');
      return 2;
    }
    process.stdout.write(`\n${paint('bold', request.summary)}\n`);
    process.stdout.write(`id:        ${request.id}\n`);
    process.stdout.write(`status:    ${request.status}\n`);
    process.stdout.write(`run:       ${request.runId}\n`);
    process.stdout.write(`agent:     ${request.agentId}\n`);
    process.stdout.write(`role:      ${request.requiredRole} (quorum ${request.quorum})\n`);
    process.stdout.write(`expires:   ${request.expiresAt}\n`);
    process.stdout.write(`codes:     ${request.reasonCodes.join(', ')}\n`);
    process.stdout.write(`\n${paint('bold', 'redacted preview')}\n${request.preview}\n\n`);
    for (const vote of request.votes) {
      process.stdout.write(`  ${vote.ts}  ${vote.approver} (${vote.role}) ${vote.vote} - ${vote.reasonCode}\n`);
    }
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'approve' || sub === 'deny') {
    const id = args.positional[2];
    if (!id) {
      process.stderr.write(`usage: civicos approvals ${sub} <id> --as <name> --role <role> --reason <code>\n`);
      return 2;
    }
    const request = deployment.approvals.get(id);
    if (!request) {
      process.stderr.write(`no approval request with id "${id}"\n`);
      return 2;
    }
    try {
      const updated = deployment.approvals.vote(id, {
        approver: flagString(args.flags, 'as', process.env.USER ?? 'reviewer'),
        role: flagString(args.flags, 'role', request.requiredRole),
        vote: sub === 'approve' ? 'approve' : 'deny',
        reasonCode: flagString(args.flags, 'reason', request.reasonCodes[0] ?? 'reviewed'),
        ...(flagOptional(args.flags, 'note') ? { note: flagString(args.flags, 'note', '') } : {}),
      });
      process.stdout.write(`${updated.id} is now ${updated.status} (${updated.votes.length}/${updated.quorum} votes)\n`);
      if (updated.status === 'approved') {
        process.stdout.write(
          paint(
            'dim',
            'The action itself is not replayed automatically. Re-run the agent to carry it out with the approval on record.\n',
          ),
        );
      }
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  process.stderr.write('usage: civicos approvals <list|show|approve|deny>\n');
  return 2;
}
