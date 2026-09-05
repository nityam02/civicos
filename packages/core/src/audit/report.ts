import type { AuditRecord, Effect } from '../types.js';
import type { AuditLedger } from './ledger.js';

export interface TransparencySummary {
  generatedAt: string;
  window: { from: string | null; to: string | null };
  totals: {
    runs: number;
    syscalls: number;
    byEffect: Record<Effect, number>;
    byKind: Record<string, number>;
    approvalsRequested: number;
    approvalsGranted: number;
    approvalsDenied: number;
    approvalsExpired: number;
    redactions: number;
    errors: number;
  };
  agents: Array<{ agentId: string; syscalls: number; denied: number; escalated: number }>;
  /** Rules that actually fired, most-used first. Silent rules are as interesting as loud ones. */
  topRules: Array<{ ruleId: string; packId: string; hits: number; effect: Effect }>;
  controls: Array<{ control: string; hits: number }>;
  integrity: { ok: boolean; length: number; headHash: string; reason?: string };
}

const EMPTY_EFFECTS: Record<Effect, number> = { allow: 0, deny: 0, require_approval: 0, transform: 0 };

/**
 * Builds the public accountability artefact: what the agents did, how often
 * they were stopped, who approved what, and whether the log is intact.
 */
export function buildTransparencySummary(
  ledger: AuditLedger,
  options: { since?: Date; until?: Date } = {},
): TransparencySummary {
  const all = ledger.records();
  const records = all.filter((r) => {
    const ts = new Date(r.ts).getTime();
    if (options.since && ts < options.since.getTime()) return false;
    if (options.until && ts > options.until.getTime()) return false;
    return true;
  });

  const byEffect = { ...EMPTY_EFFECTS };
  const byKind: Record<string, number> = {};
  const agents = new Map<string, { syscalls: number; denied: number; escalated: number }>();
  const rules = new Map<string, { packId: string; hits: number; effect: Effect }>();
  const controls = new Map<string, number>();
  const runs = new Set<string>();
  let syscalls = 0;
  let redactions = 0;
  let errors = 0;
  let approvalsRequested = 0;
  let approvalsGranted = 0;
  let approvalsDenied = 0;
  let approvalsExpired = 0;

  for (const record of records) {
    runs.add(record.runId);
    if (record.event === 'syscall') {
      syscalls += 1;
      const effect = record.decision?.effect;
      if (effect) byEffect[effect] += 1;
      if (record.kind) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
      const agent = agents.get(record.actor) ?? { syscalls: 0, denied: 0, escalated: 0 };
      agent.syscalls += 1;
      if (effect === 'deny') agent.denied += 1;
      if (effect === 'require_approval') agent.escalated += 1;
      agents.set(record.actor, agent);
      for (const reason of record.decision?.reasons ?? []) {
        const entry = rules.get(reason.ruleId) ?? { packId: reason.packId, hits: 0, effect: reason.effect };
        entry.hits += 1;
        rules.set(reason.ruleId, entry);
        for (const control of reason.controls) controls.set(control, (controls.get(control) ?? 0) + 1);
      }
      redactions += (record.redactions ?? []).reduce((sum, r) => sum + r.count, 0);
      if (record.outcome === 'error') errors += 1;
    }
    if (record.event === 'approval.requested') approvalsRequested += 1;
    if (record.event === 'approval.resolved') {
      if (record.approval?.status === 'approved') approvalsGranted += 1;
      if (record.approval?.status === 'denied') approvalsDenied += 1;
      if (record.approval?.status === 'expired') approvalsExpired += 1;
    }
  }

  const integrityResult = ledger.verify();
  const integrity: TransparencySummary['integrity'] = {
    ok: integrityResult.ok,
    length: integrityResult.length,
    headHash: integrityResult.headHash,
  };
  if (integrityResult.reason) integrity.reason = integrityResult.reason;

  return {
    generatedAt: new Date().toISOString(),
    window: {
      from: records[0]?.ts ?? null,
      to: records[records.length - 1]?.ts ?? null,
    },
    totals: {
      runs: runs.size,
      syscalls,
      byEffect,
      byKind,
      approvalsRequested,
      approvalsGranted,
      approvalsDenied,
      approvalsExpired,
      redactions,
      errors,
    },
    agents: [...agents.entries()]
      .map(([agentId, value]) => ({ agentId, ...value }))
      .sort((a, b) => b.syscalls - a.syscalls),
    topRules: [...rules.entries()]
      .map(([ruleId, value]) => ({ ruleId, ...value }))
      .sort((a, b) => b.hits - a.hits),
    controls: [...controls.entries()]
      .map(([control, hits]) => ({ control, hits }))
      .sort((a, b) => b.hits - a.hits),
    integrity,
  };
}

export function renderTransparencyMarkdown(summary: TransparencySummary): string {
  const lines: string[] = [];
  const t = summary.totals;
  lines.push('# CivicOS transparency report');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Window: ${summary.window.from ?? 'n/a'} to ${summary.window.to ?? 'n/a'}`);
  lines.push('');
  lines.push('## Ledger integrity');
  lines.push('');
  lines.push(`- Status: ${summary.integrity.ok ? 'INTACT' : `BROKEN - ${summary.integrity.reason}`}`);
  lines.push(`- Records: ${summary.integrity.length}`);
  lines.push(`- Head hash: \`${summary.integrity.headHash}\``);
  lines.push('');
  lines.push('## Activity');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Runs | ${t.runs} |`);
  lines.push(`| Mediated actions | ${t.syscalls} |`);
  lines.push(`| Allowed | ${t.byEffect.allow} |`);
  lines.push(`| Denied by policy | ${t.byEffect.deny} |`);
  lines.push(`| Escalated to a human | ${t.byEffect.require_approval} |`);
  lines.push(`| Approvals granted | ${t.approvalsGranted} |`);
  lines.push(`| Approvals refused | ${t.approvalsDenied} |`);
  lines.push(`| Approvals expired unanswered | ${t.approvalsExpired} |`);
  lines.push(`| Values redacted before use | ${t.redactions} |`);
  lines.push(`| Errors | ${t.errors} |`);
  lines.push('');
  if (summary.agents.length > 0) {
    lines.push('## Agents');
    lines.push('');
    lines.push('| Agent | Actions | Denied | Escalated |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const agent of summary.agents) {
      lines.push(`| ${agent.agentId} | ${agent.syscalls} | ${agent.denied} | ${agent.escalated} |`);
    }
    lines.push('');
  }
  if (summary.topRules.length > 0) {
    lines.push('## Rules that fired');
    lines.push('');
    lines.push('| Rule | Pack | Effect | Hits |');
    lines.push('| --- | --- | --- | ---: |');
    for (const rule of summary.topRules) {
      lines.push(`| ${rule.ruleId} | ${rule.packId} | ${rule.effect} | ${rule.hits} |`);
    }
    lines.push('');
  }
  if (summary.controls.length > 0) {
    lines.push('## External controls exercised');
    lines.push('');
    for (const control of summary.controls) {
      lines.push(`- \`${control.control}\` - ${control.hits} time(s)`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
