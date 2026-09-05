# 0004 — Ship a deterministic offline model provider

**Status**: Accepted · 2026-09

## Context

If CivicOS needs an API key to run, then: it cannot be evaluated without one, the
test suite either mocks the model (and stops testing the real path) or costs
money and flakes, runs are not reproducible, and it cannot be deployed in a field
environment with intermittent connectivity — which is precisely a humanitarian
setting.

## Decision

Ship `DeterministicModel` as the default provider: a classical extractive
summariser (term-frequency sentence scoring with a positional prior) and a
keyword classifier. No network, no key, no GPU. Identical input always produces
identical output, and the provider reports `deterministic: true` in its own
metadata.

`AnthropicModel` is available for hosted models and is imported lazily.

## Consequences

**Good.** `git clone && npm install && npm test` works, offline, free. The tests
exercise the real kernel path — real policy, real redaction, real approvals —
rather than a stub. Runs are reproducible, so ledgers can be compared byte for
byte. The demo works on a plane.

**Costs.** The output is genuinely worse than a language model's; extractive
summaries read like extractive summaries. There is a risk someone mistakes it for
a language model, which is why it is called `deterministic`, why it reports
`deterministic: true`, and why this is written down here.

**Non-obvious benefit.** Building against a deliberately weak provider first
forced the safety architecture to carry its own weight. None of the guarantees
in this system depend on the model being good.
