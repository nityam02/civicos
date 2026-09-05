# Threat model

A safety project that only lists its strengths is not being safe, it is being
marketed. This is what CivicOS defends against, what it does not, and what would
have to change for it to.

## What is being protected

- People described in documents an agent reads — beneficiaries, casework
  subjects, staff, people who filed a crisis report.
- People who act on an agent's output — responders, editors, the public.
- The organisation deploying it, which is accountable for what it publishes.

## Trust boundary

**Inside** (trusted): the kernel, the policy engine, the ledger, the handlers,
the loaded policy packs, the Node runtime and its standard library.

**Outside** (untrusted): agent code, model output, input documents, crisis feeds,
anything on the network.

CivicOS has **zero runtime dependencies**. That is the main reason: the trusted
computing base is auditable by one person in an afternoon, and there is no
transitive supply chain inside the boundary. Policy files are parsed by a 300-line
YAML subset parser written for this purpose, not by a general library.

## Defended

| Threat | Defence |
| --- | --- |
| An agent reads a file it was never meant to see | Capabilities are checked before policy; file handlers confine every path to a root and reject traversal |
| An agent exfiltrates data over the network | `net.fetch` is denied by baseline policy; the handler has an allowlist with no "allow all" option |
| Personal data reaches a hosted model | `redact` obligations rewrite the payload inside the kernel, before the provider is called |
| Personal data reaches a reviewer's queue | The approval preview is built after redaction |
| An agent publishes without a human | `publish` on `public/**` requires approval; an unattended run fails closed |
| Approvals are rubber-stamped by one person | Quorum, distinct approvers, fixed reason-code vocabulary |
| An approval is left to rot and treated as consent | Expiry; `expired` is handled exactly like a refusal |
| Precise coordinates endanger people at a site | `coarsen_geo` reduces precision before publication and before the model |
| An unsourced claim is published | `cite` obligation refuses the action before it reaches a reviewer |
| A runaway loop exhausts budget or floods a channel | Per-run budgets; `rate_limit` obligations |
| An agent escalates by creating another agent | `agent.spawn` denied by baseline; only the supervisor composes agents |
| A policy file is edited to sneak something through | Rules are order-independent, so an appended rule can only tighten; the ledger records which rules decided each action |
| Someone quietly edits the audit log | Hash chain; any edit invalidates every subsequent hash and verification names the record |
| A malformed policy file fails open | Packs that do not parse or lint refuse to load; unknown operators evaluate false; no match means deny |

## Not defended

### A malicious or compromised operator

Whoever runs the deployment can edit the policy packs, replace the agents, or
delete the ledger. CivicOS is a control *for* an organisation, not a control
*against* it.

Partial mitigation: publish head hashes externally and often; keep policy packs
in version control with required review; ship ledger records to append-only
external storage. None of these are on by default.

### Prompt injection through document content

A document an agent reads can contain instructions aimed at the model. CivicOS
does not prevent the model from being manipulated. What it does is bound the
consequences: a manipulated agent still cannot exceed its capabilities, reach the
network, publish without a human, or act without leaving a record. **The
containment is structural rather than semantic.** Treat every model output as
untrusted input.

### Redaction misses

The detectors are regular expressions. They will miss identifiers in unusual
formats, transliterated names, indirect identifiers, and anything that identifies
a person by description rather than by string. They also produce false positives —
`national_id` is deliberately broad.

Redaction is a safety net that makes accidental disclosure much less likely. It
is not a boundary you can lean on. Do not point an agent at a corpus whose
disclosure would be catastrophic and rely on pattern matching to save you.

### Re-identification from coarsened data

Two decimal places is roughly 1.1 km. In a sparsely populated area, or combined
with other published details, that can still be enough. Coarsening reduces risk;
it does not eliminate it. Set `precision` for your context.

### Correct-but-harmful output

Policy governs *actions*, not truth. An agent can produce a well-sourced,
fully-approved, entirely wrong situation report. That is what the human reviewer
and the stated limitations are for.

### Automation bias in reviewers

Reviewers approve what a machine proposes, especially under time pressure.
Quorum and reason codes raise the cost of doing it thoughtlessly. Watch the
refusal rate in the transparency report: a reviewer who has never refused
anything is not providing oversight.

### Availability

CivicOS has no rate limiting on ledger writes, no protection against disk
exhaustion, and no authentication on the local console (it binds to 127.0.0.1 and
is read-only). It is not hardened as a multi-tenant service.

### Timing and metadata

The ledger records timestamps, resources and rule ids. Even with content
redacted, that metadata can be revealing — for instance, that an agent read a
particular case file at a particular time.

## Residual risks worth stating to a deployer

1. **The corpus is the exposure.** Capabilities bound *which* documents an agent
   can read; they say nothing about what is in them.
2. **Policy quality is the ceiling.** A pack that permits too much permits too
   much, and the engine will enforce that faithfully.
3. **Reviewers are the last line, and they are people.** Under-staff the queue
   and either work stops or approvals become reflexive.
4. **The deterministic provider is not a language model.** It selects sentences.
   It cannot judge, verify or reason, and it should not be presented as if it can.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
