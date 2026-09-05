import type { Agent, AgentContext, AgentResult, SyscallReceipt } from '@civicos/core';
import { crisisIntakeManifest } from './manifests.js';
import type { NormalisedReport, RawReport } from './types.js';

/** Channel weights. Field teams are not automatically right; they are accountable. */
const SOURCE_WEIGHTS: Record<string, number> = {
  field_team: 1,
  community_hotline: 0.8,
  volunteer_network: 0.75,
  social_media: 0.35,
};

const CATEGORY_LABELS: Record<string, string[]> = {
  shelter: ['shelter', 'school', 'blankets', 'evacuated', 'displaced', 'families', 'clothing'],
  medical: ['clinic', 'patients', 'dialysis', 'medication', 'nurse', 'injured', 'hospital'],
  infrastructure: ['bridge', 'road', 'power', 'generator', 'cracks', 'impassable', 'closed'],
  water_sanitation: ['water', 'contaminated', 'supply', 'drinking', 'sanitation', 'flooding'],
  food: ['food', 'formula', 'parcels', 'meals', 'hungry'],
  rumour: ['heard', 'someone said', 'unconfirmed', 'people are saying', 'panicking'],
};

/** Language that signals the reporter is not asserting a fact. */
const HEDGES = ['heard', 'someone said', 'not confirmed', 'unconfirmed', 'looks like', 'maybe', 'rumour'];

export class CrisisIntake implements Agent {
  readonly manifest = crisisIntakeManifest;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const path = typeof ctx.input === 'string' ? ctx.input : (ctx.input as { path?: string })?.path;
    if (!path) throw new Error('crisis-intake expects a path to a JSONL feed');
    const receipts: SyscallReceipt[] = [];

    const read = await ctx.syscall<{ text: string }>({
      kind: 'data.read',
      resource: `corpus/${path.split('/').pop()}`,
      payload: { path },
    });
    receipts.push(read.receipt);
    if (!read.ok || !read.value) {
      throw new Error(`crisis-intake could not read the feed: ${read.error ?? 'unknown error'}`);
    }

    const { reports, malformed } = parseFeed(read.value.text);
    const normalised: NormalisedReport[] = [];

    for (const report of reports) {
      const classification = await ctx.syscall<{ text: string }>({
        kind: 'model.complete',
        resource: 'model/classify',
        payload: {
          task: 'classify',
          prompt: report.text,
          options: { labels: CATEGORY_LABELS, fallback: 'uncategorised' },
        },
      });
      receipts.push(classification.receipt);
      const lower = report.text.toLowerCase();
      normalised.push({
        ...report,
        category: classification.value?.text ?? 'uncategorised',
        sourceWeight: SOURCE_WEIGHTS[report.source] ?? 0.3,
        hedged: HEDGES.some((h) => lower.includes(h)),
      });
    }

    const sent = await ctx.syscall({
      kind: 'message.send',
      resource: 'bus/intake',
      payload: { reports: normalised, malformed },
    });
    receipts.push(sent.receipt);
    if (!sent.ok) throw new Error(`crisis-intake could not reach the bus: ${sent.error ?? 'refused'}`);

    if (malformed > 0) {
      await ctx.note(`${malformed} feed line(s) were malformed and skipped`, { malformed });
    }

    return {
      summary: `Normalised ${normalised.length} report(s) from ${path}${malformed ? `, skipped ${malformed} malformed line(s)` : ''}.`,
      output: { reports: normalised, malformed },
      receipts,
    };
  }
}

export function parseFeed(text: string): { reports: RawReport[]; malformed: number } {
  const reports: RawReport[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as Partial<RawReport>;
      if (typeof parsed.id !== 'string' || typeof parsed.text !== 'string') {
        malformed += 1;
        continue;
      }
      reports.push({
        id: parsed.id,
        ts: typeof parsed.ts === 'string' ? parsed.ts : new Date(0).toISOString(),
        source: typeof parsed.source === 'string' ? parsed.source : 'unknown',
        location: typeof parsed.location === 'string' ? parsed.location : 'unknown',
        lat: typeof parsed.lat === 'number' ? parsed.lat : null,
        lon: typeof parsed.lon === 'number' ? parsed.lon : null,
        text: parsed.text,
      });
    } catch {
      malformed += 1;
    }
  }
  return { reports, malformed };
}
