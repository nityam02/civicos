import { validateManifest } from '@civicos/core';
import { referenceAgents } from '@civicos/agents';
import type { ParsedArgs } from '../args.js';
import { flagBool } from '../args.js';
import { paint, table } from './shared.js';

export async function agentsCommand(args: ParsedArgs): Promise<number> {
  const sub = args.positional[1] ?? 'list';
  const agents = referenceAgents();

  if (sub === 'list') {
    if (flagBool(args.flags, 'json')) {
      process.stdout.write(`${JSON.stringify(agents.map((a) => a.manifest), null, 2)}\n`);
      return 0;
    }
    process.stdout.write(
      table(
        agents.map((a) => [
          a.manifest.id,
          a.manifest.riskTier,
          a.manifest.humanOversight.required ? 'required' : 'not required',
          a.manifest.policies.join(', '),
        ]),
        ['agent', 'risk tier', 'human oversight', 'policy packs'],
      ),
    );
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'show') {
    const id = args.positional[2];
    const agent = agents.find((a) => a.manifest.id === id);
    if (!agent) {
      process.stderr.write('usage: civicos agents show <agent-id>\n');
      return 2;
    }
    const m = agent.manifest;
    process.stdout.write(`\n${paint('bold', m.name)}  (${m.id} v${m.version})\n\n`);
    process.stdout.write(`${m.purpose}\n\n`);
    process.stdout.write(`risk tier:        ${m.riskTier}\n`);
    process.stdout.write(`owner:            ${m.owner} <${m.contact}>\n`);
    process.stdout.write(`policy packs:     ${m.policies.join(', ')}\n`);
    process.stdout.write(`data categories:  ${m.dataCategories.join(', ')}\n`);
    process.stdout.write(
      `human oversight:  ${m.humanOversight.required ? 'required' : 'not required'} (${m.humanOversight.roles.join(', ')})\n\n`,
    );
    process.stdout.write(`${paint('bold', 'capabilities')}\n`);
    for (const capability of m.capabilities) {
      process.stdout.write(`  ${capability.resource.padEnd(28)} ${capability.actions.join(', ')}\n`);
    }
    if (m.limitations && m.limitations.length > 0) {
      process.stdout.write(`\n${paint('bold', 'stated limitations')}\n`);
      for (const limitation of m.limitations) process.stdout.write(`  - ${limitation}\n`);
    }
    const issues = validateManifest(m);
    if (issues.length > 0) {
      process.stdout.write(`\n${paint('yellow', 'manifest notes')}\n`);
      for (const issue of issues) process.stdout.write(`  ${issue.level}: ${issue.message}\n`);
    }
    process.stdout.write('\n');
    return 0;
  }

  process.stderr.write('usage: civicos agents <list|show>\n');
  return 2;
}
