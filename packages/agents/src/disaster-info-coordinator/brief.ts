import type { Agent, AgentContext, AgentResult, SyscallReceipt } from '@civicos/core';
import { crisisBriefManifest } from './manifests.js';
import type { VerifiedCluster } from './types.js';

export class CrisisBrief implements Agent {
  readonly manifest = crisisBriefManifest;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const receipts: SyscallReceipt[] = [];
    const inbox = (ctx.blackboard.get('msg:bus/verified') as Array<{ payload: { clusters: VerifiedCluster[] } }> | undefined) ?? [];
    const clusters = inbox.flatMap((message) => message.payload?.clusters ?? []);
    if (clusters.length === 0) {
      await ctx.note('no verified clusters arrived on bus/verified');
      return { summary: 'Nothing to report.', output: { published: false }, receipts };
    }

    // The agent withholds identifying clusters itself. The policy rule that
    // refuses to publish them is the backstop, not the first line of defence -
    // a control you rely on daily is a control you never test.
    const withheld = clusters.filter((c) => c.identifiesIndividuals);
    const publishable = clusters.filter((c) => !c.identifiesIndividuals);
    const unverified = publishable.filter((c) => c.corroboration < 2);
    const corroboration = publishable.length === 0
      ? 0
      : Math.min(...publishable.map((c) => c.corroboration));

    const sitrep = renderSitrep(publishable, withheld.length, ctx.runId);

    const draft = await ctx.syscall<{ path: string }>({
      kind: 'data.write',
      resource: 'workspace/sitreps/current.md',
      payload: { path: 'sitreps/current.md', text: sitrep },
    });
    receipts.push(draft.receipt);

    const sources = publishable.flatMap((c) => c.reportIds);
    const published = await ctx.syscall<{ published: string }>({
      kind: 'publish',
      resource: `public/sitreps/${ctx.runId}.md`,
      payload: {
        path: `sitreps/${ctx.runId}.md`,
        text: sitrep,
        sources,
        corroboration,
        identifiesIndividuals: false,
        category: 'situation_report',
      },
    });
    receipts.push(published.receipt);

    return {
      summary: published.ok
        ? `Situation report published covering ${publishable.length} cluster(s); ${withheld.length} withheld.`
        : `Situation report held: ${published.error ?? 'not approved'}.`,
      output: {
        published: published.ok,
        publicationError: published.ok ? null : (published.error ?? null),
        clusters: publishable.length,
        withheld: withheld.length,
        unverified: unverified.length,
        minimumCorroboration: corroboration,
        sitrep,
        draftPath: draft.value?.path ?? null,
      },
      receipts,
    };
  }
}

export function renderSitrep(clusters: VerifiedCluster[], withheld: number, runId: string): string {
  const lines: string[] = [];
  lines.push('# Situation report');
  lines.push('');
  lines.push(`Run: \`${runId}\``);
  lines.push(`Clusters reported: ${clusters.length}`);
  if (withheld > 0) {
    lines.push(`Clusters withheld because they identify individuals: ${withheld}`);
  }
  lines.push('');
  lines.push('## Confirmed by two or more independent channels');
  lines.push('');
  const confirmed = clusters.filter((c) => c.corroboration >= 2);
  if (confirmed.length === 0) lines.push('_None._');
  for (const cluster of confirmed) lines.push(...renderCluster(cluster));
  lines.push('');
  lines.push('## Single-source, not yet corroborated');
  lines.push('');
  const single = clusters.filter((c) => c.corroboration < 2);
  if (single.length === 0) lines.push('_None._');
  for (const cluster of single) lines.push(...renderCluster(cluster));
  lines.push('');
  lines.push('## How to read this report');
  lines.push('');
  lines.push('- Corroboration counts distinct reporting channels, not the number of messages.');
  lines.push('- Coordinates are rounded to two decimal places, roughly one kilometre.');
  lines.push('- Items marked as rumour risk rest entirely on hedged or low-weight sources.');
  lines.push('');
  return lines.join('\n');
}

function renderCluster(cluster: VerifiedCluster): string[] {
  const place = cluster.lat !== null && cluster.lon !== null
    ? `${cluster.location} (${cluster.lat}, ${cluster.lon})`
    : cluster.location;
  return [
    `### ${cluster.category} - ${place}`,
    '',
    `- Corroboration: ${cluster.corroboration} channel(s) - ${cluster.sources.join(', ')}`,
    `- Reports: ${cluster.reportIds.join(', ')}`,
    `- Window: ${cluster.firstSeen} to ${cluster.lastSeen}`,
    ...(cluster.rumourRisk ? ['- Rumour risk: every source is hedged or low weight'] : []),
    '',
    cluster.narrative,
    '',
  ];
}
