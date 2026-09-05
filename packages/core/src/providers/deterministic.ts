import type { ModelProvider, ModelRequest, ModelResponse } from '../types.js';

/**
 * A model provider that requires no API key, no network and no GPU.
 *
 * This exists for three reasons that all matter to a public-interest project.
 * It makes the whole system runnable and auditable by anyone who can install
 * Node, including in an offline field deployment. It makes tests exercise the
 * real kernel path instead of a stub. And it makes runs reproducible: identical
 * input yields identical output, so an audit ledger can be replayed and
 * compared byte for byte.
 *
 * It is not a language model. It is a small, honest, classical NLP pipeline -
 * extractive summarisation by term frequency, keyword scoring for
 * classification - and it says so in its own output metadata.
 */
const STOPWORDS = new Set(
  ('a an the and or but if while of to in on at by for with about against between into through during '
    + 'before after above below from up down out off over under again further then once here there all any '
    + 'both each few more most other some such no nor not only own same so than too very can will just this '
    + 'that these those is are was were be been being have has had do does did as it its it\'s their they we '
    + 'you your our i he she his her them us who whom which what when where why how').split(' '),
);

export interface DeterministicModelOptions {
  /** Default number of sentences an extractive summary keeps. */
  sentences?: number;
  model?: string;
}

export class DeterministicModel implements ModelProvider {
  readonly id = 'deterministic';
  readonly model: string;
  readonly deterministic = true;
  private readonly sentences: number;

  constructor(options: DeterministicModelOptions = {}) {
    this.sentences = options.sentences ?? 5;
    this.model = options.model ?? 'civicos-extractive-v1';
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const text = this.render(request);
    return {
      text,
      provider: this.id,
      model: this.model,
      deterministic: true,
      usage: { inputChars: request.prompt.length, outputChars: text.length },
    };
  }

  private render(request: ModelRequest): string {
    switch (request.task) {
      case 'classify':
        return classify(request);
      case 'extract':
        return extract(request);
      case 'draft':
        return draft(request);
      case 'summarize':
      default:
        return summarize(request, this.sentences);
    }
  }
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Extractive summary: score each sentence by the summed frequency of the terms
 * it contains, normalised by length, then return the highest scoring sentences
 * in their original order so the summary still reads as prose.
 */
export function summarize(request: ModelRequest, defaultSentences: number): string {
  const limit = Number(request.options?.sentences ?? defaultSentences);
  const sentences = splitSentences(request.prompt);
  if (sentences.length === 0) return '';
  if (sentences.length <= limit) return sentences.join(' ');

  const frequencies = new Map<string, number>();
  for (const token of tokenise(request.prompt)) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  const maxFrequency = Math.max(1, ...frequencies.values());

  const scored = sentences.map((sentence, index) => {
    const tokens = tokenise(sentence);
    if (tokens.length === 0) return { index, sentence, score: 0 };
    const sum = tokens.reduce((acc, t) => acc + (frequencies.get(t) ?? 0) / maxFrequency, 0);
    // Slight positional prior: the opening of a document usually states its subject.
    const positional = index === 0 ? 0.35 : index < 3 ? 0.15 : 0;
    return { index, sentence, score: sum / Math.sqrt(tokens.length) + positional };
  });

  return scored
    .slice()
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence)
    .join(' ');
}

/**
 * Keyword classification. `options.labels` maps a label to its trigger terms;
 * the label whose terms occur most often wins, and ties resolve alphabetically
 * so the result never depends on object key order.
 */
export function classify(request: ModelRequest): string {
  const labels = (request.options?.labels ?? {}) as Record<string, string[]>;
  const tokens = new Set(tokenise(request.prompt));
  const haystack = request.prompt.toLowerCase();
  const scores = Object.entries(labels)
    .map(([label, terms]) => {
      const score = terms.reduce((acc, term) => {
        const needle = term.toLowerCase();
        if (needle.includes(' ')) return acc + (haystack.includes(needle) ? 2 : 0);
        return acc + (tokens.has(needle) ? 1 : 0);
      }, 0);
      return { label, score };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const best = scores[0];
  if (!best || best.score === 0) return String(request.options?.fallback ?? 'unclassified');
  return best.label;
}

/** Returns the sentences that mention any requested term, in document order. */
export function extract(request: ModelRequest): string {
  const terms = ((request.options?.terms ?? []) as string[]).map((t) => t.toLowerCase());
  const sentences = splitSentences(request.prompt);
  const hits = sentences.filter((s) => terms.some((t) => s.toLowerCase().includes(t)));
  return hits.map((s) => `- ${s}`).join('\n');
}

/** Fills a section template. Deterministic composition, never invention. */
export function draft(request: ModelRequest): string {
  const sections = (request.options?.sections ?? []) as Array<{ heading: string; body: string }>;
  if (sections.length === 0) return summarize(request, 5);
  return sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}`).join('\n\n');
}
