import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { ApprovalGateway, ApprovalOutcome, ApprovalStore, CreateApprovalInput } from '@civicos/core';

/**
 * Asks a human at the terminal. This is the gateway that makes "human
 * oversight" concrete rather than architectural: the run stops, a person reads
 * the redacted preview, and nothing continues until they answer.
 */
export class InteractiveGateway implements ApprovalGateway {
  id = 'interactive';

  constructor(private readonly reviewer = process.env.USER ?? 'reviewer') {}

  async request(input: CreateApprovalInput, store: ApprovalStore): Promise<ApprovalOutcome> {
    const request = store.create(input);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write('\n');
      stdout.write('  ┌─ CivicOS approval required ─────────────────────────────────\n');
      stdout.write(`  │ ${request.summary}\n`);
      stdout.write(`  │ role required: ${request.requiredRole}   approvals needed: ${request.quorum}\n`);
      stdout.write(`  │ expires: ${request.expiresAt}\n`);
      stdout.write('  ├─ redacted preview ──────────────────────────────────────────\n');
      for (const line of request.preview.split('\n').slice(0, 24)) {
        stdout.write(`  │ ${line}\n`);
      }
      stdout.write('  └─────────────────────────────────────────────────────────────\n');

      let granted = 0;
      while (granted < request.quorum) {
        const who = await rl.question(`  approver ${granted + 1}/${request.quorum} name [${this.reviewer}]: `);
        const answer = (await rl.question(`  approve? (y/N): `)).trim().toLowerCase();
        const codes = request.reasonCodes.length > 0 ? request.reasonCodes.join(', ') : 'reviewed';
        const reasonCode = (await rl.question(`  reason code (${codes}): `)).trim() || (request.reasonCodes[0] ?? 'reviewed');
        const vote = answer === 'y' || answer === 'yes' ? 'approve' : 'deny';
        const updated = store.vote(request.id, {
          approver: who.trim() || this.reviewer,
          role: request.requiredRole,
          vote,
          reasonCode,
        });
        if (updated.status === 'denied') {
          stdout.write('  refused. The action will not run.\n\n');
          return { status: 'denied', request: updated };
        }
        granted += 1;
        if (updated.status === 'approved') {
          stdout.write('  approved.\n\n');
          return { status: 'approved', request: updated };
        }
      }
      return { status: store.get(request.id)?.status ?? 'pending', request };
    } finally {
      rl.close();
    }
  }
}
