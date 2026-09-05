# Writing an agent

An agent is a manifest and a `run` function. The manifest is the part that
matters most: it is the artefact a reviewer, a data protection officer or a
funder will actually read.

## The manifest

```ts
import type { AgentManifest } from '@civicos/core';

export const manifest: AgentManifest = {
  id: 'meeting-minutes',
  name: 'Meeting Minutes Drafter',
  version: '0.1.0',

  // Plain language. Published verbatim in transparency reports, so write it for
  // the person affected by the agent, not for the person deploying it.
  purpose:
    'Drafts minutes from a recorded transcript of a community board meeting so that ' +
    'volunteers do not have to, and routes the draft to the chair before circulation.',

  riskTier: 'limited',              // minimal | limited | high
  owner: 'Kalliroi Community Trust',
  contact: 'digital@example.org',

  // Narrow. Each grant is a promise about what this agent can never do.
  capabilities: [
    { resource: 'corpus/transcripts/**', actions: ['data.read'] },
    { resource: 'model/**',              actions: ['model.complete'] },
    { resource: 'workspace/minutes/**',  actions: ['data.write'] },
    { resource: 'public/minutes/**',     actions: ['publish'] },
  ],

  policies: ['baseline', 'ngo-document-handling'],
  dataCategories: ['personal_data'],
  humanOversight: { required: true, roles: ['chair'] },

  // Read as an admission of what the agent gets wrong. Published with the report.
  limitations: [
    'Attribution of statements to speakers depends entirely on the transcript.',
    'Decisions are extracted by keyword and will miss anything phrased unusually.',
  ],
};
```

`validateManifest()` rejects a manifest that has no stated purpose, no owner, no
policy pack, or that declares the high risk tier without human oversight. It
warns on a wildcard capability. `civicos agents show <id>` prints all of it.

### Choosing a risk tier

Aligned with the EU AI Act's structure, and it has teeth: `high` triggers extra
rules in the shipped packs — full traceability on every model call, and a
two-person rule on publication.

- `minimal` — no effect on people. A formatter, a linter.
- `limited` — informs a human who decides. Most agents.
- `high` — its output is acted on. Anything that reaches the public, allocates
  resources, or affects access to a service.

When unsure, pick the higher one. The cost of over-declaring is more oversight.

## The run function

```ts
import type { Agent, AgentContext, AgentResult, SyscallReceipt } from '@civicos/core';

export class MeetingMinutes implements Agent {
  readonly manifest = manifest;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const receipts: SyscallReceipt[] = [];

    const read = await ctx.syscall<{ text: string }>({
      kind: 'data.read',
      resource: 'corpus/transcripts/2026-09-04.txt',   // logical name: policy matches on this
      payload: { path: 'transcripts/2026-09-04.txt' }, // physical path: the handler uses this
    });
    receipts.push(read.receipt);

    // A refusal is a value, not an exception. Handle it and carry on.
    if (!read.ok) {
      await ctx.note('transcript unavailable', { error: read.error ?? null });
      return { summary: 'No transcript to work from.', output: { minutes: null }, receipts };
    }

    const draft = await ctx.complete(
      { task: 'summarize', prompt: read.value!.text, options: { sentences: 12 } },
      'model/summarize',
    );

    const published = await ctx.syscall({
      kind: 'publish',
      resource: 'public/minutes/2026-09-04.md',
      payload: {
        path: 'minutes/2026-09-04.md',
        text: draft,
        sources: ['transcripts/2026-09-04.txt'],   // the `cite` obligation needs this
      },
    });
    receipts.push(published.receipt);

    return {
      summary: published.ok ? 'Minutes published.' : `Held: ${published.error}`,
      output: { minutes: draft, published: published.ok },
      receipts,
    };
  }
}
```

### Resource names

The `resource` is a **logical** name that policy matches on. `payload.path` is
the **physical** path a handler resolves. Keeping them separate means policy can
talk about `corpus/**` and `public/briefs/**` without knowing where anything
lives on disk, and a handler can confine paths without parsing policy globs.

Conventions used by the shipped packs:

| Namespace | Meaning |
| --- | --- |
| `corpus/**` | Source documents the agent may read |
| `model/**` | Model calls, by task: `model/summarize`, `model/classify` |
| `workspace/**` | Working files, not visible outside |
| `public/**` | Anything that leaves the system. Always needs approval |
| `bus/**` | Messages to another agent in the same run |

## Six habits worth copying from the reference agents

**Report facts; let policy judge them.** `ngo-doc-summarizer` sets
`mentionsVulnerableGroups: true` on the payload. It does not decide what that
means. The policy rule
`escalate-briefs-mentioning-vulnerable-groups` does, and an organisation can
change that judgement without touching the agent.

**Do the right thing anyway.** `crisis-brief` withholds clusters that identify
individuals *itself*, even though a policy rule would refuse to publish them. A
control you rely on daily is a control you never test.

**Treat refusals as normal.** Every syscall returns a result. Denials, expired
approvals and handler failures are values. An agent that throws on refusal is an
agent that cannot report why it did less than expected.

**Keep the draft.** Write the working copy to `workspace/**` before attempting
`publish`. A refusal should leave a human something to review, not a dead end.

**Narrow beats wide.** Three agents that each hold one capability are safer than
one holding all three, because no single failure spans the whole path.

**State your limitations.** They are published with every transparency report.
An agent whose `limitations` array is empty is claiming something implausible.

## Registering and running

```ts
import { bootstrap } from '@civicos/core';

const d = bootstrap({ root: process.cwd() });   // loads ./policies, opens ./.civicos
d.supervisor.register(new MeetingMinutes());

const report = await d.supervisor.runAgent('meeting-minutes', input);
```

For several agents, describe the workflow as a plan rather than as code:

```ts
await d.supervisor.run({
  id: 'board-pack',
  description: 'Draft minutes, then compile the board pack.',
  onFailure: 'halt',
  tasks: [
    { id: 'minutes', agent: 'meeting-minutes', input: transcript },
    { id: 'pack', agent: 'board-pack-builder', dependsOn: ['minutes'],
      input: (results) => results.get('minutes')?.output },
  ],
});
```

## Testing

Use `bootstrap({ ephemeral: true })` with a `ScriptedGateway` and a `fixedClock`.
Assert on the **ledger**, not just the return value — the ledger is what an
auditor will read:

```ts
const modelCalls = d.ledger.records().filter((r) => r.kind === 'model.complete');
const detectors = modelCalls.flatMap((r) => (r.redactions ?? []).map((f) => f.detector));
assert.ok(detectors.includes('email'));
```

`packages/agents/src/agents.test.ts` is a working example of the whole pattern.
