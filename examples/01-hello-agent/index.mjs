/**
 * The smallest useful CivicOS deployment.
 *
 * An agent that reads nothing, calls the model once, and writes one file - and
 * still cannot do anything the manifest and the policy pack did not permit.
 *
 *   node examples/01-hello-agent/index.mjs
 */
import {
  Kernel,
  PolicyEngine,
  parsePolicyPack,
  MemoryLedger,
  DeterministicModel,
  Supervisor,
  createLogger,
  modelHandler,
} from '@civicos/core';

const pack = parsePolicyPack(`
id: hello
version: 1.0.0
title: Hello policy
description: Permit summarising, refuse everything else.
authority:
  - framework: CivicOS example
    reference: "examples/01"
    requirement: Demonstrate deny-by-default.
defaults:
  effect: deny
rules:
  - id: allow-summarise
    description: The agent may summarise text, with email addresses removed first.
    when:
      kind: model.complete
      resource: { glob: "model/**" }
    effect: allow
    obligations:
      - type: redact
        fields: [payload.prompt]
        detectors: [email]
`);

const manifest = {
  id: 'hello-agent',
  name: 'Hello agent',
  version: '0.1.0',
  purpose: 'Summarises a short passage of text to demonstrate the CivicOS mediation path.',
  riskTier: 'minimal',
  owner: 'CivicOS examples',
  contact: 'examples@civicos.invalid',
  capabilities: [{ resource: 'model/**', actions: ['model.complete'] }],
  policies: ['hello'],
  dataCategories: [],
  humanOversight: { required: false, roles: [] },
};

const agent = {
  manifest,
  async run(ctx) {
    const summary = await ctx.complete(
      {
        task: 'summarize',
        prompt: String(ctx.input),
        options: { sentences: 2 },
      },
      'model/summarize',
    );

    // The agent has no `publish` capability, so this is refused by the kernel
    // before policy is even consulted. Nothing throws; the refusal is a value.
    const refused = await ctx.syscall({
      kind: 'publish',
      resource: 'public/anything.md',
      payload: { text: summary },
    });

    return {
      summary: 'Summarised one passage.',
      output: { summary, publishRefusedBecause: refused.error },
      receipts: [],
    };
  },
};

const ledger = new MemoryLedger();
const kernel = new Kernel({
  policy: new PolicyEngine([pack]),
  ledger,
  model: new DeterministicModel(),
  logger: createLogger({ level: 'warn' }),
});
kernel.registerHandler(modelHandler());

const supervisor = new Supervisor(kernel, createLogger({ level: 'warn' }));
supervisor.register(agent);

const report = await supervisor.runAgent(
  'hello-agent',
  `The Kalliroi Community Trust supported 412 households this quarter, an increase of 31 per cent.
   Waiting times for legal orientation rose to eleven days in May before falling back to six in June.
   The programmes coordinator can be reached at eleni.papadaki@kalliroi-trust.example.
   The team recommends a reserves policy review in September.`,
);

const output = report.outcomes[0].result.output;
console.log('\nsummary:\n ', output.summary.trim(), '\n');
console.log('publish refused:\n ', output.publishRefusedBecause, '\n');
console.log('ledger:', ledger.length, 'records, chain intact:', ledger.verify().ok);
console.log('the model never saw the email address:', !ledger.records().some((r) =>
  JSON.stringify(r).includes('eleni.papadaki'),
));
