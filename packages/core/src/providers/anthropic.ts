import type { ModelProvider, ModelRequest, ModelResponse } from '../types.js';

/**
 * Optional adapter for Claude, via the official Anthropic SDK.
 *
 * CivicOS never depends on this at run time: `@anthropic-ai/sdk` is an optional
 * peer dependency, imported lazily, so the kernel's trust boundary stays
 * dependency-free and the whole system still runs offline on
 * {@link DeterministicModel}. Install the SDK only if you want to route
 * `model.complete` syscalls to a hosted model.
 *
 *   npm install @anthropic-ai/sdk
 *   export ANTHROPIC_API_KEY=...
 *   CIVICOS_MODEL_PROVIDER=anthropic civicos run ngo-doc-summarizer --input report.txt
 *
 * Note what does *not* change when you switch providers: capability checks,
 * policy evaluation, redaction, approvals and the audit ledger all sit above
 * this class. A hosted model sees only text the kernel has already minimised.
 */
export interface AnthropicModelOptions {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  /** Adaptive thinking is on by default; set false for short, cheap calls. */
  thinking?: boolean;
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicMessage {
  content: AnthropicTextBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicClientLike {
  messages: { create(params: Record<string, unknown>): Promise<AnthropicMessage> };
}

export class AnthropicModel implements ModelProvider {
  readonly id = 'anthropic';
  readonly model: string;
  readonly deterministic = false;

  private client: AnthropicClientLike | null = null;
  private readonly options: Required<Omit<AnthropicModelOptions, 'apiKey'>> & { apiKey?: string };

  constructor(options: AnthropicModelOptions = {}) {
    this.model = options.model ?? process.env.CIVICOS_MODEL_ID ?? 'claude-opus-5';
    this.options = {
      model: this.model,
      maxTokens: options.maxTokens ?? 4096,
      thinking: options.thinking ?? true,
    };
    if (options.apiKey) this.options.apiKey = options.apiKey;
  }

  private async getClient(): Promise<AnthropicClientLike> {
    if (this.client) return this.client;
    // The specifier is held in a variable on purpose: the SDK is optional, so
    // this module must type-check and build in a tree where it is not installed.
    const specifier = '@anthropic-ai/sdk';
    let module: { default: new (config?: Record<string, unknown>) => AnthropicClientLike };
    try {
      module = (await import(specifier)) as unknown as typeof module;
    } catch {
      throw new Error(
        'The Anthropic provider needs the optional peer dependency "@anthropic-ai/sdk". ' +
          'Install it with `npm install @anthropic-ai/sdk`, or keep using the built-in ' +
          'deterministic provider, which needs no network access.',
      );
    }
    const Anthropic = module.default;
    this.client = this.options.apiKey ? new Anthropic({ apiKey: this.options.apiKey }) : new Anthropic();
    return this.client;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const client = await this.getClient();
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.options.maxTokens,
      messages: [{ role: 'user', content: request.prompt }],
    };
    if (request.system) params.system = request.system;
    if (this.options.thinking) params.thinking = { type: 'adaptive' };

    const message = await client.messages.create(params);
    const text = message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
      .trim();

    const usage: ModelResponse['usage'] = {
      inputChars: request.prompt.length,
      outputChars: text.length,
    };
    if (message.usage?.input_tokens !== undefined) usage.inputTokens = message.usage.input_tokens;
    if (message.usage?.output_tokens !== undefined) usage.outputTokens = message.usage.output_tokens;

    return { text, provider: this.id, model: this.model, deterministic: false, usage };
  }
}

/**
 * Chooses a provider from the environment. Defaults to the offline
 * deterministic provider, so a fresh clone runs with no configuration at all.
 */
export async function providerFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<ModelProvider> {
  const { DeterministicModel } = await import('./deterministic.js');
  if ((env.CIVICOS_MODEL_PROVIDER ?? 'deterministic').toLowerCase() === 'anthropic') {
    const options: AnthropicModelOptions = {};
    if (env.CIVICOS_MODEL_ID) options.model = env.CIVICOS_MODEL_ID;
    return new AnthropicModel(options);
  }
  return new DeterministicModel();
}
