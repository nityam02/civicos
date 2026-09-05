# Audit and transparency

## The ledger

Every mediated action writes exactly one record, whatever the outcome: allowed,
denied by policy, refused for want of a capability, over budget, escalated,
expired, or failed in the handler. Runs, approvals and agent notes get records
too.

Each record commits to the hash of the record before it:

```json
{
  "seq": 6,
  "ts": "2026-09-05T11:41:22.712Z",
  "runId": "run_c1facec110624222aa19",
  "actor": "ngo-doc-summarizer",
  "event": "syscall",
  "kind": "publish",
  "resource": "public/briefs/ngo-report-txt.md",
  "decision": {
    "effect": "require_approval",
    "riskScore": 47,
    "usedDefault": false,
    "reasons": [
      { "ruleId": "require-approval-before-publication", "packId": "baseline",
        "effect": "require_approval",
        "description": "Anything that becomes visible outside the system is signed off by a named human first.",
        "controls": ["EU-AI-ACT-ART-14", "UNESCO-AI-ETHICS-OVERSIGHT"] }
    ]
  },
  "obligations": [{ "type": "label", "text": "Prepared by an AI agent…" }],
  "redactions": [{ "detector": "email", "field": "payload.prompt", "commitment": "5f2a1c8b…", "count": 1 }],
  "approval": { "requestId": "apr_…", "status": "approved", "approvers": ["ana"], "reasonCodes": ["accurate"] },
  "outcome": "ok",
  "prevHash": "…",
  "hash": "…"
}
```

The hash is SHA-256 over the **canonical JSON** of the record without its own
hash. Canonical means sorted keys and no incidental whitespace, so two
structurally equal records hash identically on any machine — which is what makes
independent verification possible at all.

Note what is *not* in the record: the redacted values. `redactions` stores a
salted commitment and a count. That is enough to prove later that a specific
value was removed, if someone presents it, and reveals nothing on its own.

## Verifying

```bash
civicos audit verify
# ledger intact  29 record(s)
# head 0af355d5ce31484a8f3859890599ccd8422e64dcc47143500027d4918942caad
```

Verification walks the chain and checks three things per record: the sequence
number is contiguous, `prevHash` matches the previous record's hash, and the
record's own content still hashes to its stored hash. Any edit, deletion,
insertion or reordering breaks it, and the report names the first record that
failed.

```ts
import { verifyChain } from '@civicos/core';
const result = verifyChain(JSON.parse(...));
// { ok: false, brokenAt: 6, reason: 'content hash mismatch: this record was modified after it was written' }
```

## What a hash chain does and does not give you

It does **not** stop the operator of the system from rewriting their own log.
They hold the file. Anyone with write access can delete the ledger and start a
new one, and no amount of hashing prevents that.

What it gives you is **detectability**. Publish the head hash — in a monthly
report, a git commit, an email to a funder, a board minute — and from that moment
the log up to that point is fixed. Anyone holding a copy can prove it matches.
Rewriting history stops being a quiet edit and becomes a visible contradiction.

That is why the head hash is the first thing in every transparency report.

For a stronger guarantee, ship records to append-only external storage or a
transparency log as they are written. The `AuditLedger` base class is designed
for exactly that: implement `records()` and `persist()`, and the chain logic is
inherited.

## Transparency reports

```bash
civicos report                  # markdown to stdout
civicos report --out report.md
civicos report --json           # for a dashboard
```

The report answers the questions an outsider actually asks:

- **Is the record intact?** Status and head hash, first.
- **What did the agents do?** Actions, split by allow / deny / escalate.
- **How often was it stopped?** Denials and escalations per agent.
- **Did humans really decide?** Approvals granted, refused, and expired
  unanswered. The expired count is the honest one: it is where oversight is
  understaffed.
- **How much personal data was removed before use?**
- **Which rules actually fired?** Including which never did.
- **Which external controls were exercised?** `EU-AI-ACT-ART-14` — 47 times.

That last one is the point. It turns "we take human oversight seriously" into a
number attached to a named article, in a document backed by a verifiable log.

## The console

```bash
civicos console          # http://127.0.0.1:7777
```

A local, read-only dashboard over the ledger, the approval queue and the rules in
force. Single self-contained page, no third-party script, no telemetry, bound to
localhost.

Read-only on purpose. An oversight console that can also act erodes the
separation between the thing being watched and the thing doing the watching.

## Reproducing a run

With a fixed clock, the deterministic provider and concurrency 1, a run produces
a byte-identical ledger. Two people can run the same inputs on different machines
and compare head hashes.

```ts
const d = bootstrap({
  ephemeral: true,
  clock: fixedClock('2026-09-05T00:00:00.000Z', 500),
});
```

## Retention

The `retain` obligation is currently **declarative**: it is recorded on the audit
record and reported, but the kernel does not enforce a schedule or delete
anything. Do not read it as a deletion guarantee. Enforced retention and
lawful-basis tagging are on the [roadmap](roadmap.md).
