import type { Agent, AgentContext, AgentResult, SyscallReceipt } from '@civicos/core';
import { ngoDocSummarizerManifest } from './manifest.js';

export interface DocumentRef {
  /** Logical name inside the corpus namespace, used by policy. */
  id: string;
  /** Physical path, relative to the deployment root. */
  path: string;
}

export interface NgoSummarizerInput {
  documents: DocumentRef[];
  /** Title of the brief. Defaults to the first document's id. */
  title?: string;
  /** Sentences to keep per document. */
  sentencesPerDocument?: number;
}

interface DocumentSummary {
  id: string;
  path: string;
  bytes: number;
  category: string;
  summary: string;
  mentionsVulnerableGroups: boolean;
  redactionsApplied: number;
}

const CATEGORY_LABELS: Record<string, string[]> = {
  programme_report: ['programme', 'programmes', 'beneficiaries', 'sessions', 'delivery', 'quarter'],
  financial: ['reserves', 'grant', 'funding', 'budget', 'expenditure', 'finance', 'unrestricted'],
  safeguarding: ['safeguarding', 'protection', 'referral', 'incident', 'concern', 'child'],
  governance: ['board', 'trustees', 'policy', 'governance', 'minutes', 'resolution'],
  operational: ['volunteer', 'staffing', 'training', 'retention', 'rota', 'recruitment'],
};

/**
 * Terms that make a document more sensitive to publish. The agent does not act
 * on this itself - it reports the fact on the payload, and the policy engine
 * decides what that means. Keeping the judgement in policy is the point: an
 * organisation can widen or narrow this without touching the agent.
 */
const VULNERABILITY_TERMS = [
  'child', 'children', 'minor', 'unaccompanied', 'asylum', 'refugee', 'survivor',
  'trafficking', 'disability', 'safeguarding', 'domestic abuse', 'elderly',
];

export class NgoDocSummarizer implements Agent {
  readonly manifest = ngoDocSummarizerManifest;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const input = normaliseInput(ctx.input);
    const receipts: SyscallReceipt[] = [];
    const summaries: DocumentSummary[] = [];
    const failures: string[] = [];

    for (const document of input.documents) {
      const read = await ctx.syscall<{ text: string; bytes: number; path: string }>({
        kind: 'data.read',
        resource: `corpus/${document.id}`,
        payload: { path: document.path },
      });
      receipts.push(read.receipt);
      if (!read.ok || !read.value) {
        failures.push(`${document.id}: ${read.error ?? 'unreadable'}`);
        await ctx.note(`could not read ${document.id}`, { error: read.error ?? null });
        continue;
      }

      const text = read.value.text;

      // Two model calls per document. Both go through the kernel, so both are
      // redacted, budgeted and logged - the agent cannot bypass that path.
      const summaryCall = await ctx.syscall<{ text: string }>({
        kind: 'model.complete',
        resource: 'model/summarize',
        payload: {
          task: 'summarize',
          system: 'Summarise the document for an editor at a civil-society organisation.',
          prompt: text,
          options: { sentences: input.sentencesPerDocument ?? 6 },
        },
      });
      receipts.push(summaryCall.receipt);
      if (!summaryCall.ok || !summaryCall.value) {
        failures.push(`${document.id}: summarisation refused (${summaryCall.error ?? 'unknown'})`);
        continue;
      }

      const categoryCall = await ctx.syscall<{ text: string }>({
        kind: 'model.complete',
        resource: 'model/classify',
        payload: {
          task: 'classify',
          prompt: text,
          options: { labels: CATEGORY_LABELS, fallback: 'uncategorised' },
        },
      });
      receipts.push(categoryCall.receipt);

      const lower = text.toLowerCase();
      summaries.push({
        id: document.id,
        path: document.path,
        bytes: read.value.bytes,
        category: categoryCall.value?.text ?? 'uncategorised',
        summary: summaryCall.value.text,
        mentionsVulnerableGroups: VULNERABILITY_TERMS.some((t) => lower.includes(t)),
        redactionsApplied: (summaryCall.decision.obligations ?? []).filter((o) => o.type === 'redact').length,
      });
    }

    const title = input.title ?? summaries[0]?.id ?? 'brief';
    const brief = renderBrief(title, summaries, failures);
    const mentionsVulnerableGroups = summaries.some((s) => s.mentionsVulnerableGroups);
    const sources = summaries.map((s) => `${s.id} (${s.path})`);

    // The draft is written to the workspace unconditionally: an editor can read
    // it even if publication is refused, which is what makes a refusal
    // reviewable rather than a dead end.
    const draft = await ctx.syscall<{ path: string }>({
      kind: 'data.write',
      resource: `workspace/briefs/${slug(title)}.md`,
      payload: { path: `briefs/${slug(title)}.md`, text: brief },
    });
    receipts.push(draft.receipt);

    const published = await ctx.syscall<{ published: string }>({
      kind: 'publish',
      resource: `public/briefs/${slug(title)}.md`,
      payload: {
        path: `briefs/${slug(title)}.md`,
        text: brief,
        sources,
        mentionsVulnerableGroups,
      },
    });
    receipts.push(published.receipt);

    const status = published.ok
      ? `published to ${published.value?.published ?? 'public/briefs'}`
      : `held for review: ${published.error ?? 'not approved'}`;

    return {
      summary: `Summarised ${summaries.length}/${input.documents.length} document(s); ${status}.`,
      output: {
        title,
        brief,
        documents: summaries,
        sources,
        mentionsVulnerableGroups,
        published: published.ok,
        publicationError: published.ok ? null : (published.error ?? null),
        draftPath: draft.value?.path ?? null,
        failures,
      },
      receipts,
    };
  }
}

export function renderBrief(
  title: string,
  summaries: DocumentSummary[],
  failures: string[],
): string {
  const lines: string[] = [];
  lines.push(`# Brief: ${title}`);
  lines.push('');
  lines.push(`Documents reviewed: ${summaries.length}`);
  lines.push('');
  if (summaries.length === 0) {
    lines.push('_No document could be read. Nothing in this brief is derived from source material._');
    lines.push('');
  }
  for (const summary of summaries) {
    lines.push(`## ${summary.id}`);
    lines.push('');
    lines.push(`- Category: ${summary.category}`);
    lines.push(`- Source: \`${summary.path}\` (${summary.bytes} bytes)`);
    if (summary.mentionsVulnerableGroups) {
      lines.push('- Flagged: references groups requiring protection consideration');
    }
    lines.push('');
    lines.push(summary.summary);
    lines.push('');
  }
  if (failures.length > 0) {
    lines.push('## Documents that could not be summarised');
    lines.push('');
    for (const failure of failures) lines.push(`- ${failure}`);
    lines.push('');
  }
  lines.push('## Sources');
  lines.push('');
  for (const summary of summaries) lines.push(`- \`${summary.path}\``);
  lines.push('');
  return lines.join('\n');
}

function normaliseInput(raw: unknown): NgoSummarizerInput {
  if (typeof raw === 'string') {
    return { documents: [{ id: basename(raw), path: raw }] };
  }
  if (Array.isArray(raw)) {
    return { documents: raw.map((p) => ({ id: basename(String(p)), path: String(p) })) };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as NgoSummarizerInput).documents)) {
    return raw as NgoSummarizerInput;
  }
  throw new Error(
    'ngo-doc-summarizer expects a path, an array of paths, or { documents: [{ id, path }] }',
  );
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
}

export { ngoDocSummarizerManifest };
