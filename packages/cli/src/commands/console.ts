import { createServer } from 'node:http';
import { buildTransparencySummary } from '@civicos/core';
import type { ParsedArgs } from '../args.js';
import { flagNumber } from '../args.js';
import { openDeployment, paint } from './shared.js';
import { renderConsoleHtml } from '../console-page.js';

/**
 * A read-only local dashboard over the audit ledger and the approval queue.
 *
 * Deliberately read-only and deliberately local: an oversight console that can
 * also act is another way to lose the separation between the thing being
 * watched and the thing doing the watching.
 */
export async function consoleCommand(args: ParsedArgs): Promise<number> {
  const deployment = await openDeployment({ ...args.flags, quiet: true });
  const port = flagNumber(args.flags, 'port', 7777);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname === '/api/state') {
      const state = {
        summary: buildTransparencySummary(deployment.ledger),
        records: deployment.ledger.records().slice(-500),
        approvals: deployment.approvals.list(),
        packs: deployment.policy.allRules().map(({ pack, rule }) => ({
          pack: pack.id,
          rule: rule.id,
          effect: rule.effect,
          description: rule.description,
          controls: rule.controls ?? [],
        })),
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(state));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    });
    res.end(renderConsoleHtml());
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  process.stdout.write(
    `\n${paint('bold', 'CivicOS console')}  http://127.0.0.1:${port}\n` +
      paint('dim', `  ledger: ${deployment.ledger.length} records\n  press ctrl-c to stop\n\n`),
  );
  await new Promise(() => {
    /* serve until interrupted */
  });
  return 0;
}
