import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadPolicyDirectory, lintPolicyPack, validateManifest, CIVICOS_VERSION } from '@civicos/core';
import { referenceAgents } from '@civicos/agents';
import type { ParsedArgs } from '../args.js';
import { flagString } from '../args.js';
import { paint } from './shared.js';

/** A readiness check that answers "is this deployment coherent?" in one screen. */
export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const root = resolve(flagString(args.flags, 'root', process.cwd()));
  const checks: Array<{ ok: boolean; label: string; detail: string }> = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    ok: nodeMajor >= 20,
    label: 'node runtime',
    detail: `v${process.versions.node}${nodeMajor >= 20 ? '' : ' (CivicOS needs Node 20.11 or newer)'}`,
  });

  const policyDir = resolve(flagString(args.flags, 'policies', join(root, 'policies')));
  if (!existsSync(policyDir)) {
    checks.push({ ok: false, label: 'policy directory', detail: `${policyDir} does not exist` });
  } else {
    try {
      const packs = loadPolicyDirectory(policyDir);
      const errors = packs.flatMap((p) => lintPolicyPack(p).filter((i) => i.level === 'error'));
      checks.push({
        ok: packs.length > 0 && errors.length === 0,
        label: 'policy packs',
        detail: `${packs.length} loaded (${packs.map((p) => p.id).join(', ')})${errors.length ? `, ${errors.length} error(s)` : ''}`,
      });
    } catch (error) {
      checks.push({ ok: false, label: 'policy packs', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const agents = referenceAgents();
  const manifestErrors = agents.flatMap((a) =>
    validateManifest(a.manifest).filter((i) => i.level === 'error').map((i) => `${a.manifest.id}: ${i.message}`),
  );
  checks.push({
    ok: manifestErrors.length === 0,
    label: 'agent manifests',
    detail: manifestErrors.length === 0 ? `${agents.length} valid` : manifestErrors.join('; '),
  });

  const provider = (process.env.CIVICOS_MODEL_PROVIDER ?? 'deterministic').toLowerCase();
  checks.push({
    ok: provider !== 'anthropic' || Boolean(process.env.ANTHROPIC_API_KEY),
    label: 'model provider',
    detail:
      provider === 'anthropic'
        ? `anthropic (${process.env.ANTHROPIC_API_KEY ? 'api key present' : 'ANTHROPIC_API_KEY is not set'})`
        : 'deterministic - runs offline, no key required',
  });

  checks.push({
    ok: true,
    label: 'state directory',
    detail: join(root, '.civicos'),
  });

  process.stdout.write(`\nCivicOS ${CIVICOS_VERSION}\n\n`);
  for (const check of checks) {
    const mark = check.ok ? paint('green', 'ok  ') : paint('red', 'fail');
    process.stdout.write(`  ${mark}  ${check.label.padEnd(18)} ${check.detail}\n`);
  }
  process.stdout.write('\n');
  return checks.every((c) => c.ok) ? 0 : 1;
}
