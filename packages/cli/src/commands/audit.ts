import { writeFileSync } from 'node:fs';
import { buildTransparencySummary, renderTransparencyMarkdown } from '@civicos/core';
import type { ParsedArgs } from '../args.js';
import { flagBool, flagNumber, flagOptional } from '../args.js';
import { openDeployment, paint, table } from './shared.js';

export async function auditCommand(args: ParsedArgs): Promise<number> {
  const deployment = await openDeployment({ ...args.flags, quiet: true });
  const sub = args.positional[1] ?? 'verify';

  if (sub === 'verify') {
    const result = deployment.ledger.verify();
    if (result.ok) {
      process.stdout.write(
        `${paint('green', 'ledger intact')}  ${result.length} record(s)\nhead ${result.headHash}\n`,
      );
      return 0;
    }
    process.stdout.write(
      `${paint('red', 'ledger BROKEN')} at record ${result.brokenAt}\nreason: ${result.reason}\n`,
    );
    return 1;
  }

  if (sub === 'tail') {
    const count = flagNumber(args.flags, 'n', 20);
    const records = deployment.ledger.records().slice(-count);
    if (flagBool(args.flags, 'json')) {
      process.stdout.write(`${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
      return 0;
    }
    process.stdout.write(
      table(
        records.map((r) => [
          String(r.seq),
          r.ts.slice(11, 19),
          r.actor,
          r.event,
          r.kind ?? '',
          r.decision?.effect ?? r.outcome ?? '',
          r.resource ?? '',
        ]),
        ['seq', 'time', 'actor', 'event', 'kind', 'effect', 'resource'],
      ),
    );
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'export') {
    const out = flagOptional(args.flags, 'out');
    const payload = `${deployment.ledger.records().map((r) => JSON.stringify(r)).join('\n')}\n`;
    if (out) {
      writeFileSync(out, payload, 'utf8');
      process.stdout.write(`wrote ${deployment.ledger.length} record(s) to ${out}\n`);
    } else {
      process.stdout.write(payload);
    }
    return 0;
  }

  process.stderr.write('usage: civicos audit <verify|tail|export>\n');
  return 2;
}

export async function reportCommand(args: ParsedArgs): Promise<number> {
  const deployment = await openDeployment({ ...args.flags, quiet: true });
  const summary = buildTransparencySummary(deployment.ledger);
  if (flagBool(args.flags, 'json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  const markdown = renderTransparencyMarkdown(summary);
  const out = flagOptional(args.flags, 'out');
  if (out) {
    writeFileSync(out, markdown, 'utf8');
    process.stdout.write(`wrote transparency report to ${out}\n`);
    return 0;
  }
  process.stdout.write(`${markdown}\n`);
  return 0;
}
