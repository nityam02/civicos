# 0005 — Tamper-evident, not tamper-proof

**Status**: Accepted · 2026-09

## Context

"Immutable audit log" is a phrase that gets used loosely. A file on a disk owned
by the operator is not immutable, whatever is written in it. The honest options
are: a hash chain (detect tampering), append-only external storage (raise the
cost), or a distributed transparency log (witness it).

The first is available to every deployment. The others need infrastructure the
target organisations may not have.

## Decision

Hash-chain records locally: SHA-256 over canonical JSON, each record committing
to the previous hash. Publish the head hash prominently — it is the first thing
in every transparency report — and say plainly, in the README, the docs and the
threat model, that this is *tamper-evident and not tamper-proof*.

`AuditLedger` is an abstract base with `records()` and `persist()`, so an external
or append-only backend inherits the chain logic unchanged.

## Consequences

**Good.** Works with no infrastructure. Publishing a head hash fixes history from
that moment: anyone holding a copy can prove it matches, and rewriting the past
becomes a visible contradiction rather than a quiet edit. Canonical JSON makes
independent verification possible on any machine.

**Costs.** No protection against an operator who deletes the ledger and starts
again, or who never publishes a head hash. Verification is O(n) over the whole
chain. Redacted values are unrecoverable by design — the record keeps a salted
commitment, which proves what was removed if presented but cannot reconstruct it.

**What would change this.** An external transparency log is on the roadmap. When
it lands, this record gets superseded rather than edited.
