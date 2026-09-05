import type { Agent, AgentContext, AgentResult, SyscallReceipt } from '@civicos/core';
import { coarsenCoordinate } from '@civicos/core';
import { crisisVerificationManifest } from './manifests.js';
import type { NormalisedReport, VerifiedCluster } from './types.js';

/** Patterns that suggest a report names a specific person. */
const IDENTIFIER_PATTERNS: RegExp[] = [
  /\b(?:nurse|doctor|dr|mr|mrs|ms|coordinator|officer)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/,
  /\+\d[\d\s().-]{7,}/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

export class CrisisVerification implements Agent {
  readonly manifest = crisisVerificationManifest;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const receipts: SyscallReceipt[] = [];
    const inbox = (ctx.blackboard.get('msg:bus/intake') as Array<{ payload: { reports: NormalisedReport[] } }> | undefined) ?? [];
    const reports = inbox.flatMap((message) => message.payload?.reports ?? []);
    if (reports.length === 0) {
      await ctx.note('no reports arrived on bus/intake; nothing to verify');
      return { summary: 'No reports to verify.', output: { clusters: [] }, receipts };
    }

    const clusters = clusterReports(reports);

    const sent = await ctx.syscall({
      kind: 'message.send',
      resource: 'bus/verified',
      payload: { clusters },
    });
    receipts.push(sent.receipt);
    if (!sent.ok) throw new Error(`crisis-verification could not reach the bus: ${sent.error ?? 'refused'}`);

    const corroborated = clusters.filter((c) => c.corroboration >= 2).length;
    const withheld = clusters.filter((c) => c.identifiesIndividuals).length;
    await ctx.note('verification complete', {
      clusters: clusters.length,
      corroborated,
      identifying: withheld,
    });

    return {
      summary: `Formed ${clusters.length} cluster(s); ${corroborated} corroborated by two or more channels; ${withheld} flagged as identifying individuals.`,
      output: { clusters },
      receipts,
    };
  }
}

/**
 * Clusters by subject and approximate place, then counts *distinct source
 * channels*. Ten social-media posts repeating one rumour still count once,
 * which is the whole point: corroboration has to mean independence or it means
 * nothing.
 */
export function clusterReports(reports: NormalisedReport[]): VerifiedCluster[] {
  const groups = new Map<string, NormalisedReport[]>();
  for (const report of reports) {
    const place =
      report.lat !== null && report.lon !== null
        ? `${coarsenCoordinate(report.lat, 2)},${coarsenCoordinate(report.lon, 2)}`
        : report.location.toLowerCase().trim();
    const key = `${report.category}@${place}`;
    const existing = groups.get(key);
    if (existing) existing.push(report);
    else groups.set(key, [report]);
  }

  return [...groups.entries()]
    .map(([key, members]) => {
      const ordered = [...members].sort((a, b) => a.ts.localeCompare(b.ts));
      const sources = [...new Set(ordered.map((r) => r.source))].sort();
      const withCoords = ordered.filter((r) => r.lat !== null && r.lon !== null);
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      return {
        key,
        location: first.location,
        category: first.category,
        corroboration: sources.length,
        reportIds: ordered.map((r) => r.id),
        sources,
        lat: withCoords.length > 0 ? coarsenCoordinate(average(withCoords.map((r) => r.lat as number)), 2) : null,
        lon: withCoords.length > 0 ? coarsenCoordinate(average(withCoords.map((r) => r.lon as number)), 2) : null,
        identifiesIndividuals: ordered.some((r) => IDENTIFIER_PATTERNS.some((p) => p.test(r.text))),
        rumourRisk: ordered.every((r) => r.hedged || r.sourceWeight < 0.5),
        narrative: ordered.map((r) => r.text).join(' '),
        firstSeen: first.ts,
        lastSeen: last.ts,
      } satisfies VerifiedCluster;
    })
    .sort((a, b) => b.corroboration - a.corroboration || a.key.localeCompare(b.key));
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
