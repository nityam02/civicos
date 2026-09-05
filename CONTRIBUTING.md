# Contributing to CivicOS

Thank you for looking. This project needs several kinds of help, and only some of
them are code.

## What is most useful right now

**Policy packs from people who have done the work.** The `humanitarian-response`
pack was written by reading standards, not by running an information management
cell in a crisis. If you have, your judgement is worth more to this project than
another feature. Same for legal aid, public health outreach, municipal services,
community media and refugee casework. See
[Contributing a policy pack](#contributing-a-policy-pack).

**Reviewing what is already here.** Does `deny-publication-identifying-individuals`
actually match how a protection adviser thinks about that risk? Is a two-decimal
coordinate really safe enough in a rural area? Open an issue and argue with it.

**Adversarial reading.** Find a way an agent could do something its manifest
forbids. Find a document format the redaction detectors miss. Open a
[security report](SECURITY.md) if it is exploitable, an issue if it is a gap.

**Code.** See the [roadmap](docs/roadmap.md) for items marked **help wanted**.

## Getting set up

```bash
git clone https://github.com/nityam02/civicos.git
cd civicos
npm install
npm run build
npm test          # 125 tests, no API key, no network
npm run demo
```

Requires Node 20.11 or newer. Nothing else — the project has no runtime
dependencies and only TypeScript and `@types/node` as dev dependencies.

## Repository layout

```
packages/core      the kernel, policy engine, ledger, approvals, orchestrator
packages/agents    reference agents
packages/cli       the civicos command line and oversight console
policies           the shipped policy packs
docs               architecture, policy reference, threat model, ADRs
examples           four runnable examples
data/samples       synthetic sample data
```

## The rules that are not negotiable

These are the invariants the project exists to hold. A change that breaks one of
them needs an ADR, not a pull request comment.

1. **Fail closed.** No policy match means deny. No reviewer means refuse. An
   unknown operator evaluates false. An expired approval is a refusal.
2. **Every mediated action is logged**, whatever the outcome.
3. **Capabilities are checked before policy** and cannot be widened by it.
4. **Zero runtime dependencies** in `packages/core`. If you think you need one,
   open an issue first and expect to be talked out of it.
5. **Obligations are executed by the kernel**, never by the agent.
6. **Redaction happens before** the model, the reviewer and any output.

## Style

Match the code that is already there.

- TypeScript, strict, ES modules, `.js` extensions on relative imports.
- Comments explain *why*, not *what*. If a comment restates the line below it,
  delete it. If a design decision would look arbitrary to a stranger, explain it
  where it is made — or write an ADR.
- Prefer clarity to cleverness. This code is read by people deciding whether to
  trust it.
- Errors say what happened, in what context, and what to do next.
- No emoji in source or output.

## Tests

Every behavioural change needs a test. We use `node:test` — no framework.

Good tests here assert on the **ledger**, not just on return values, because the
ledger is what an auditor reads:

```ts
const detectors = ledger.records()
  .filter((r) => r.kind === 'model.complete')
  .flatMap((r) => (r.redactions ?? []).map((f) => f.detector));
assert.ok(detectors.includes('email'));
```

Test names should read as claims about the system, not as labels:
`'silence is not consent: an unanswered request expires'`, not `'test expiry'`.

```bash
npm test
node --test --test-reporter=spec "packages/core/dist/**/*.test.js"
```

## Contributing a policy pack

A pack is a YAML file in `policies/`. To be merged it needs:

1. **An `authority` block** citing the standard, regulation or professional
   guidance each part of it implements. A rule with no source is an opinion.
2. **A `description` on every rule**, in plain language, saying what it protects
   and why.
3. **`controls`** on every rule that is not a plain `allow`, so the transparency
   report can count them.
4. **`defaults.effect: deny`**. A pack that fails open will be flagged by the
   linter and should not be merged.
5. **Tests** — add cases to `packages/core/src/policy/engine.test.ts` or an
   agent test that show the rules firing.
6. **A note in the pull request** about who reviewed it from the relevant domain.
   "I read the Sphere Handbook" is honest and useful. So is "I ran an IM cell for
   three years and this is wrong."

```bash
civicos policy lint
civicos policy explain --agent <id> --kind publish --resource public/x --payload '{...}'
```

## Contributing an agent

Reference agents are teaching material. They should be short, obviously correct,
and show one idea well. Read [docs/writing-agents.md](docs/writing-agents.md)
first. A new agent needs a manifest with a real `purpose` and honest
`limitations`, synthetic sample data, tests, and a paragraph in the README.

## Pull requests

- One change per pull request.
- Say what problem you are solving and how you know it works.
- `npm test` and `npm run build` must pass. CI runs on Node 20 and 22, and also
  runs the examples and the demo.
- If the change alters what an agent is permitted to do, say so explicitly in
  the description. Those get read closely.

## Reporting problems

- **Security**: [SECURITY.md](SECURITY.md). Do not open a public issue.
- **A way to bypass a control**: security report.
- **Anything else**: open an issue. Bug reports with a failing test are the
  fastest to fix.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are licensed under [Apache 2.0](LICENSE), the project's licence.
