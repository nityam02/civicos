# Architecture

## The one idea

An agent in CivicOS holds no references to anything outside itself. No file
handle, no HTTP client, no model SDK, no reference to another agent. The only
thing it can do is ask the kernel.

```ts
const result = await ctx.syscall({
  kind: 'publish',
  resource: 'public/briefs/q3.md',
  payload: { text: brief, sources: ['doc-1'] },
});
```

Everything CivicOS provides is a consequence of that being the only path. One
chokepoint means one place to enforce a rule, one place to minimise data, one
place to ask a human, and one place to write the log — and no second path around
any of them.

## The seven gates

Every syscall passes through the same sequence in `packages/core/src/runtime/kernel.ts`.

### 1. Capability

The agent's manifest lists `{ resource, actions }` grants. The kernel matches the
syscall's kind and resource against them, most specific glob first. No match, no
action — and this check runs *before* policy is consulted, so no policy edit can
grant an agent something its manifest never claimed.

Capabilities and policy are two layers on purpose. Policy is the negotiable one:
it changes with jurisdiction, context, and the day's risk appetite. Capabilities
are the fixed one. A mistake in either is not sufficient on its own.

### 2. Budget

Per-run ceilings on syscalls, model calls, model input characters, publications
and wall-clock time. An agent that loops is not just expensive; it is an
availability risk for whoever depends on it. Exceeding a budget is recorded as
`budget.exceeded`, not thrown.

### 3. Policy

Declarative rules, evaluated against a **subject** built from the syscall:

```
kind, resource, runId, agentId
payload.*         everything the agent passed
meta.*
agent.riskTier, agent.dataCategories, agent.policies, agent.humanOversightRequired
context.dryRun, context.usage, context.capability
```

Only the packs named in the agent's manifest are in force for it. Every matching
rule is collected; the strongest effect wins:

```
deny  >  require_approval  >  allow          (transform never decides; it only adds obligations)
```

Order-independent by construction, so appending a rule can only tighten the
system. No match at all means the pack default, which is `deny`.

The decision carries every matched rule with its description and control
identifiers. That list *is* the explanation — `civicos policy explain` prints it,
the audit record stores it, and the transparency report aggregates it.

### 4. Obligations

Duties attached to the decision, executed by the kernel rather than the agent, so
an agent cannot decline one.

| Obligation | Effect |
| --- | --- |
| `redact` | Replaces detected values in named payload fields with stable pseudonyms |
| `coarsen_geo` | Reduces coordinate precision (default 2 dp, roughly 1.1 km) |
| `label` | Writes a provenance banner into the content itself |
| `cite` | See gate 5 |
| `rate_limit` | See gate 5 |
| `log`, `retain` | Recorded on the audit record and surfaced in transparency reports; retention is not yet enforced by the kernel — see [roadmap](roadmap.md) |

Minimisation always runs before labelling, whatever order the rules were written
in, so a provenance banner is never scanned as if it were content.

### 5. Obligation preconditions

`cite` requires a non-empty source list on the payload; without it the action
stops here. `rate_limit` caps repetitions of the same action on the same resource
in a sliding window.

These run *before* the approval gate deliberately. An unsourced document should
never reach a reviewer's queue at all — a queue full of things that were never
publishable is how oversight becomes a rubber stamp.

### 6. Human approval

If the effect is `require_approval`, the kernel builds a request containing the
already-redacted preview and hands it to the configured **gateway**. See
[human-oversight.md](human-oversight.md). Anything other than `approved` —
denied, expired, still pending — means the action does not run.

### 7. Execution

A registered **handler** performs the action. Handlers are the only code that
touches the outside world, so they re-check their own invariants even though the
kernel already applied capabilities and policy — defence in depth. The file
handlers confine every path to a root directory and reject anything that escapes
it; the network handler refuses any host not on an explicit allowlist and has no
"allow all" option.

Whatever happens — success, refusal, handler failure — one audit record is
appended and a receipt is returned to the agent.

## Components

```
packages/core/src/
  types.ts              the whole vocabulary, in one file
  bootstrap.ts          wires an opinionated default deployment
  policy/
    conditions.ts       the condition language; no eval, total operators
    pack.ts             parse and lint policy packs
    engine.ts           order-independent evaluation
  runtime/
    kernel.ts           the seven gates
    capabilities.ts     manifest grants and validation
    budget.ts           per-run ceilings
    redact.ts           detectors, pseudonymisation, geo coarsening
    approvals.ts        quorum, reason codes, expiry, gateways
    orchestrator.ts     supervisor, plans, dependency graph
  audit/
    ledger.ts           hash chain, memory and file backends
    report.ts           transparency summaries
  providers/
    deterministic.ts    offline extractive summariser and classifier
    anthropic.ts        optional Claude adapter, lazily imported
  handlers/             file, model, publish, message, network
  util/
    yaml.ts             strict YAML subset parser (no dependency)
    canonical.ts        canonical JSON, hashing, commitments
    glob.ts             linear-time resource globs

packages/agents/src/    the reference agents
packages/cli/src/       the civicos command line and oversight console
policies/               the shipped policy packs
```

## Orchestration

`Supervisor` runs a **plan**: a set of tasks with dependencies, executed in a
stable topological order with an explicit concurrency limit. Agents cannot call
each other, discover each other, or pass each other capabilities. The only
channel between them is a shared blackboard written through `message.send`
syscalls, which means inter-agent communication is mediated and logged like
everything else.

At concurrency 1 with a fixed clock and the deterministic provider, a run
produces a byte-identical audit ledger. Reproducibility is an audit property, not
a convenience.

## Reproducibility

Four things make a run replayable:

- **Canonical JSON** — sorted keys, so structurally equal values hash identically
  on any machine.
- **Stable topological sort** — ties break on declaration order.
- **Injectable clock** — `fixedClock()` removes wall-clock time from the record.
- **Deterministic provider** — identical input, identical output.

## Extending it

Every part is replaceable. `bootstrap()` is one opinionated wiring, not the only
one.

- **A new syscall kind** — add it to `SyscallKind`, register a handler, write the
  policy rules that govern it.
- **A new obligation** — add the type, implement it in `redact.ts` (payload
  rewriting) or `kernel.ts` (precondition), document it.
- **A new gateway** — implement `ApprovalGateway` to route approvals into Slack,
  a ticketing system, or a duty roster.
- **A new ledger backend** — extend `AuditLedger` with `records()` and
  `persist()`; the chain logic is inherited.
- **A new model provider** — implement `ModelProvider`. Everything above it is
  unchanged.
