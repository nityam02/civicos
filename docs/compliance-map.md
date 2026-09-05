# Compliance map

**This is not legal advice, and CivicOS does not make a deployment compliant.**
Compliance is a property of an organisation — its purposes, its governance, its
documentation, its accountability — not of a library. What CivicOS provides is
the technical layer several frameworks assume exists, plus the evidence that it
ran.

Read the last section, on what CivicOS does *not* give you, before citing any of
this to anyone.

## EU Artificial Intelligence Act (Regulation 2024/1689)

| Requirement | What CivicOS provides | Where |
| --- | --- | --- |
| **Art. 12** — automatic recording of events over the system's lifetime | Hash-chained append-only ledger; one record per mediated action, whatever the outcome | `audit/ledger.ts`, `record-keeping-for-high-risk-agents` |
| **Art. 13** — transparency and provision of information to deployers | Machine-readable manifests with stated purpose, risk tier, data categories and limitations; `civicos agents show` | `capabilities.ts`, agent manifests |
| **Art. 14** — effective human oversight, including the ability to intervene | Approval gateways with quorum, reason codes and expiry; fail-closed on silence; two-person rule for high-risk publication | `approvals.ts`, `require-approval-before-publication`, `two-person-rule-for-high-risk-publication` |
| **Art. 15** — accuracy, robustness, cybersecurity | Deny-by-default capabilities, path confinement, network allowlist, budget ceilings, total policy operators | `kernel.ts`, `handlers/index.ts`, `budget.ts` |
| **Art. 26** — deployer obligations, including monitoring and log retention | Transparency reports, ledger export, per-agent activity breakdown | `audit/report.ts` |
| **Art. 50** — transparency about AI-generated content | `label` obligation writes a notice into the content itself | `transparency-notice-on-generated-content` |

## UNESCO Recommendation on the Ethics of Artificial Intelligence (2021)

Adopted by all 194 member states; the first global standard on AI ethics.

| Principle | What CivicOS provides |
| --- | --- |
| Human oversight and determination | Approval workflows; accountability always attaches to a named person; agents have no legal personality and cannot spawn agents |
| Transparency and explainability | Every decision carries the full list of matched rules with descriptions and control ids; `civicos policy explain` answers hypotheticals before anything runs |
| Responsibility and accountability | Manifests name an owner and a contact; every action is attributed to an agent and, where escalated, to a named human |
| Right to privacy and data protection | Redaction before model, reviewer and publication; pseudonymising commitments; geographic coarsening |
| Safety and security | Deny-by-default, no outbound network without an allowlist, path confinement, per-run budgets |
| Proportionality and do no harm | Risk tiers drive stricter controls; policy packs refuse categories of output outright |
| Multi-stakeholder governance | Policy is data a non-engineer can read, diff and change without touching code |

## NIST AI Risk Management Framework 1.0

| Function | What CivicOS provides |
| --- | --- |
| **GOVERN** | Policy packs as versioned, reviewable artefacts; manifests assigning ownership; roles that gate approval |
| **MAP** | Declared risk tier, data categories, capabilities and stated limitations per agent |
| **MEASURE** | Transparency reports: denial rates, escalation rates, expired approvals, redaction counts, control coverage |
| **MANAGE** | Budgets, rate limits, dry-run mode, fail-closed defaults, tamper-evident incident evidence |

## GDPR (Regulation (EU) 2016/679)

| Article | What CivicOS provides |
| --- | --- |
| Art. 5(1)(b) — purpose limitation | Capabilities confine an agent to a declared corpus; reading outside it is refused |
| Art. 5(1)(c) — data minimisation | `redact` and `coarsen_geo` obligations run before the model, the reviewer and any output |
| Art. 5(2) — accountability | The ledger is the evidence |
| Art. 25 — data protection by design and by default | Minimisation is a kernel obligation, not an agent's good intention |
| Art. 30 — records of processing | Per-action records with data categories, purposes and outcomes |

CivicOS does not establish a lawful basis, handle data subject rights, or manage
international transfers.

## Humanitarian standards

| Standard | What CivicOS provides |
| --- | --- |
| **OCHA humanitarian principles** — do no harm | Coordinate coarsening; refusal to publish products identifying individuals |
| **Sphere / Core Humanitarian Standard, Commitment 4** — timely, accurate information | Corroboration thresholds counting *independent channels*; single-source products escalated to a duty officer |
| **ICRC Handbook on Data Protection in Humanitarian Action** | Minimisation at the boundary, purpose limitation via capabilities, location protection |

## Where the controls live

| Control id | Pack | Rule |
| --- | --- | --- |
| `EU-AI-ACT-ART-12` | baseline, eu-ai-act-high-risk | `record-keeping-for-high-risk-agents`, `full-traceability-of-model-calls` |
| `EU-AI-ACT-ART-14` | baseline, eu-ai-act-high-risk | `require-approval-before-publication`, `two-person-rule-for-high-risk-publication`, `deny-high-risk-without-declared-oversight` |
| `EU-AI-ACT-ART-50` | eu-ai-act-high-risk | `transparency-notice-on-generated-content` |
| `GDPR-ART-5-1-C` | ngo-document-handling, humanitarian-response | `minimise-personal-data-before-model`, `minimise-identifiers-before-publication` |
| `GDPR-ART-5-1-B` | ngo-document-handling | `deny-read-outside-corpus` |
| `UNESCO-AI-ETHICS-OVERSIGHT` | baseline | `require-approval-before-publication` |
| `ICRC-DP-CH4` | humanitarian-response | `coarsen-locations-everywhere`, `deny-publication-identifying-individuals` |
| `SPHERE-CHS-4` | humanitarian-response | `escalate-single-source-reports`, `label-situation-reports` |
| `NIST-AI-RMF-MANAGE-2.2` | baseline | `deny-outbound-network` |
| `CIVICOS-DEFAULT-DENY` | kernel | applied when no rule matches |

`civicos report` counts how often each of these was exercised.

## What CivicOS does not give you

Stated plainly, because a compliance table that only lists wins is a liability.

- **No conformity assessment.** No technical documentation pack, no CE marking,
  no notified body, no declaration of conformity.
- **No risk management system.** Art. 9 requires a documented, iterative process
  across the lifecycle. CivicOS is one control within it.
- **No data governance for training.** It does not train anything.
- **No enforced retention or erasure.** `retain` is recorded and reported, not
  enforced. It is not a deletion guarantee.
- **No data subject rights machinery.** No access, rectification or erasure
  workflow.
- **No guarantee that redaction catches everything.** Pattern detectors miss
  unusual formats and produce false positives. They are a safety net, not a
  boundary. See [threat-model.md](threat-model.md).
- **No opinion on whether your system is high-risk.** You classify it; CivicOS
  applies the controls you declare.
- **No defence against a malicious operator.** Whoever runs the deployment can
  change the policy packs. The ledger makes that visible to anyone holding an
  earlier head hash; it does not prevent it.
