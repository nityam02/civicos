import { resolve, join } from 'node:path';
import { loadPolicyDirectory, lintPolicyPack, PolicyEngine } from '@civicos/core';
import type { AgentManifest, SyscallKind } from '@civicos/core';
import { referenceAgents } from '@civicos/agents';
import type { ParsedArgs } from '../args.js';
import { flagOptional, flagString } from '../args.js';
import { paint, table } from './shared.js';

export async function policyCommand(args: ParsedArgs): Promise<number> {
  const sub = args.positional[1] ?? 'lint';
  const dir = resolve(flagString(args.flags, 'policies', join(process.cwd(), 'policies')));

  if (sub === 'lint') return lint(dir);
  if (sub === 'list') return list(dir);
  if (sub === 'explain') return explain(dir, args);
  process.stderr.write('usage: civicos policy <lint|list|explain>\n');
  return 2;
}

function lint(dir: string): number {
  const packs = loadPolicyDirectory(dir);
  let errors = 0;
  let warnings = 0;
  for (const pack of packs) {
    const issues = lintPolicyPack(pack);
    const errorCount = issues.filter((i) => i.level === 'error').length;
    const warnCount = issues.length - errorCount;
    errors += errorCount;
    warnings += warnCount;
    const status = errorCount > 0 ? paint('red', 'FAIL') : warnCount > 0 ? paint('yellow', 'WARN') : paint('green', ' OK ');
    process.stdout.write(`${status}  ${pack.id.padEnd(24)} ${pack.rules.length} rules  ${pack.source ?? ''}\n`);
    for (const issue of issues) {
      process.stdout.write(`      ${issue.level}: ${issue.message}\n`);
    }
  }
  process.stdout.write(
    `\n${packs.length} pack(s), ${errors} error(s), ${warnings} warning(s)\n`,
  );
  return errors > 0 ? 1 : 0;
}

function list(dir: string): number {
  const packs = loadPolicyDirectory(dir);
  for (const pack of packs) {
    process.stdout.write(`\n${paint('bold', pack.id)}  v${pack.version}  -  ${pack.title}\n`);
    for (const authority of pack.authority) {
      process.stdout.write(paint('dim', `  authority: ${authority.framework} ${authority.reference}\n`));
    }
    process.stdout.write(
      table(
        pack.rules.map((r) => [r.id, r.effect, String(r.risk ?? ''), (r.controls ?? []).join(', ')]),
        ['rule', 'effect', 'risk', 'controls'],
      ),
    );
    process.stdout.write('\n');
  }
  return 0;
}

/**
 * Answers "what would happen if?" without running anything. This is the tool a
 * policy officer uses: change a rule, ask the question again, see the answer
 * change.
 */
function explain(dir: string, args: ParsedArgs): number {
  const agentId = flagOptional(args.flags, 'agent');
  const kind = flagOptional(args.flags, 'kind') as SyscallKind | undefined;
  const resource = flagOptional(args.flags, 'resource');
  if (!agentId || !kind || !resource) {
    process.stderr.write(
      'usage: civicos policy explain --agent <id> --kind <syscall-kind> --resource <resource> [--payload \'{"...":"..."}\']\n',
    );
    return 2;
  }

  const manifest = findManifest(agentId);
  if (!manifest) {
    process.stderr.write(`unknown agent "${agentId}"\n`);
    return 2;
  }

  let payload: Record<string, unknown> = {};
  const raw = flagOptional(args.flags, 'payload');
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      process.stderr.write(`--payload is not valid JSON: ${String(error)}\n`);
      return 2;
    }
  }

  const engine = new PolicyEngine(loadPolicyDirectory(dir));
  const decision = engine.evaluate(
    {
      id: 'explain',
      ts: new Date().toISOString(),
      runId: 'explain',
      agentId,
      kind,
      resource,
      payload,
    },
    manifest,
    { dryRun: true },
  );

  process.stdout.write('\n');
  process.stdout.write(`${paint('bold', 'effect')}      ${effectLabel(decision.effect)}\n`);
  process.stdout.write(`${paint('bold', 'risk score')}  ${decision.riskScore}\n`);
  process.stdout.write(`${paint('bold', 'packs')}       ${manifest.policies.join(', ')}\n`);
  if (decision.approval) {
    process.stdout.write(
      `${paint('bold', 'approval')}    role=${decision.approval.role} quorum=${decision.approval.quorum} expires=${decision.approval.expiresInMs}ms\n`,
    );
  }
  process.stdout.write('\n');
  process.stdout.write(paint('bold', 'why\n'));
  for (const reason of decision.reasons) {
    process.stdout.write(
      `  [${reason.effect}] ${reason.packId}/${reason.ruleId}\n      ${reason.description}\n`,
    );
    if (reason.controls.length > 0) {
      process.stdout.write(paint('dim', `      controls: ${reason.controls.join(', ')}\n`));
    }
  }
  if (decision.obligations.length > 0) {
    process.stdout.write(`\n${paint('bold', 'obligations')}\n`);
    for (const obligation of decision.obligations) {
      process.stdout.write(`  ${JSON.stringify(obligation)}\n`);
    }
  }
  process.stdout.write('\n');
  return 0;
}

function findManifest(agentId: string): AgentManifest | undefined {
  return referenceAgents().find((a) => a.manifest.id === agentId)?.manifest;
}

function effectLabel(effect: string): string {
  if (effect === 'allow') return paint('green', effect);
  if (effect === 'deny') return paint('red', effect);
  return paint('yellow', effect);
}
