# Roadmap

Version 0.1.0 works end to end: kernel, policy engine, ledger, approvals,
orchestrator, CLI, console, two reference agents, 125 tests. Interfaces will
change before 1.0.

Items marked **help wanted** are good places to start, and several need
operational judgement more than they need code.

## Next

**Enforced retention.** `retain` is declarative today. Make it a real schedule:
records past their retention window are provably removed and the removal is
itself recorded. *Needs a design that keeps the chain verifiable after deletion —
probably hash-only tombstones.*

**External transparency log.** Ship ledger records to append-only external storage
as they are written, so head hashes are witnessed rather than self-asserted.
**help wanted**

**Policy test framework.** Let a pack ship its own assertions —
`given this syscall, expect this effect` — so a policy change is covered by tests
the same way code is. **help wanted**

**Policy coverage report.** Which rules never fired? A rule that has never matched
is either dead or protecting against something that has not happened yet, and the
distinction matters.

**More approval gateways.** Slack, Matrix, email, and a small web queue for
organisations with no engineer on duty. **help wanted**

## Under consideration

**Signed receipts.** Sign each record so a receipt can be verified by a third
party without access to the whole ledger.

**Policy simulation against history.** Replay a stored ledger against a modified
policy pack and report what would have changed. This is the tool that makes
policy edits safe to make.

**A Python SDK.** Not a rewrite — a client so Python agents can run against the
same kernel over a local socket. **help wanted**

**Structured redaction beyond regex.** Optional pluggable detectors, including
locally-run NER, without adding a runtime dependency to the core. **help wanted**

**Federated deployments.** Several organisations, one shared policy pack,
separate ledgers, comparable transparency reports.

## Policy packs wanted

This is where the project most needs people who are not programmers. Each pack
should cite its authority and be reviewed by someone who has done the work.

- Municipal and local-government service delivery
- Public health outreach and community health workers
- Legal aid and access to justice
- Independent and community media
- Education and school administration
- Election information integrity
- Refugee and migration casework
- Environmental monitoring and climate adaptation

**help wanted** on every one of these. See
[CONTRIBUTING.md](../CONTRIBUTING.md#contributing-a-policy-pack).

## Explicitly out of scope

- Training or fine-tuning models.
- Being a general agent framework. CivicOS is a governance layer; if you want
  maximum flexibility, other projects serve that better.
- Certifying compliance. See [compliance-map.md](compliance-map.md).
- A hosted service. This is infrastructure organisations run themselves.
