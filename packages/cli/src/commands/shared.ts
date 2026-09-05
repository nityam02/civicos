import { join, resolve } from 'node:path';
import {
  bootstrap,
  AutoDenyGateway,
  QueueGateway,
  ScriptedGateway,
  createLogger,
  providerFromEnv,
} from '@civicos/core';
import type { ApprovalGateway, Deployment, LogLevel } from '@civicos/core';
import { referenceAgents } from '@civicos/agents';
import { InteractiveGateway } from '../interactive.js';
import { flagBool, flagOptional, flagString } from '../args.js';
import type { ParsedArgs } from '../args.js';

const ESC = String.fromCharCode(27);

const COLOURS = {
  reset: ESC + '[0m',
  dim: ESC + '[2m',
  bold: ESC + '[1m',
  red: ESC + '[31m',
  green: ESC + '[32m',
  yellow: ESC + '[33m',
  blue: ESC + '[34m',
  cyan: ESC + '[36m',
} as const;

const useColour = process.stdout.isTTY && process.env.NO_COLOR === undefined;

export function paint(colour: keyof typeof COLOURS, text: string): string {
  return useColour ? `${COLOURS[colour]}${text}${COLOURS.reset}` : text;
}

export function gatewayFor(flags: ParsedArgs['flags']): ApprovalGateway {
  const mode = flagString(flags, 'approvals', 'queue');
  switch (mode) {
    case 'interactive':
      return new InteractiveGateway();
    case 'auto-deny':
      return new AutoDenyGateway();
    case 'demo-approve':
      // Explicitly named so nobody enables it by accident, and every resulting
      // audit record carries the reviewer id "demo:approver" for ever.
      return new ScriptedGateway([
        { vote: 'approve', approver: 'demo:approver', note: 'Scripted demo approval - not a human review.' },
      ]);
    case 'queue':
    default:
      return new QueueGateway();
  }
}

export async function openDeployment(flags: ParsedArgs['flags']): Promise<Deployment> {
  const root = resolve(flagString(flags, 'root', process.cwd()));
  const level = (flagOptional(flags, 'log') ?? (flagBool(flags, 'quiet') ? 'error' : 'info')) as LogLevel;
  const stateDir = flagOptional(flags, 'state');
  return bootstrap({
    root,
    policyDir: resolve(flagString(flags, 'policies', join(root, 'policies'))),
    ...(stateDir ? { stateDir: resolve(stateDir) } : {}),
    ephemeral: flagBool(flags, 'ephemeral'),
    model: await providerFromEnv(),
    gateway: gatewayFor(flags),
    dryRun: flagBool(flags, 'dry-run'),
    logLevel: level,
    logger: createLogger({ prefix: paint('dim', '[civicos]'), level }),
  });
}

export function registerReferenceAgents(deployment: Deployment): Deployment {
  for (const agent of referenceAgents()) {
    try {
      deployment.supervisor.register(agent);
    } catch (error) {
      deployment.logger.warn(
        `skipping agent "${agent.manifest.id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return deployment;
}

export function table(rows: string[][], headers: string[]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)));
  const line = (row: string[]) => row.map((cell, i) => (cell ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
  return [
    paint('bold', line(headers)),
    paint('dim', widths.map((w) => '-'.repeat(w)).join('  ')),
    ...rows.map(line),
  ].join('\n');
}
