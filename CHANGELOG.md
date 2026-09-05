# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, minor versions may break interfaces.

## [Unreleased]

See the [roadmap](docs/roadmap.md).

## [0.1.0] — 2026-09-05

First public release. Runs end to end with no API key and no network.

### Kernel

- Capability-mediated syscalls across eight kinds: `model.complete`, `data.read`,
  `data.write`, `net.fetch`, `agent.spawn`, `message.send`, `tool.invoke`,
  `publish`.
- Seven gates per syscall: capability, budget, policy, obligations, obligation
  preconditions, human approval, execution — with an audit record written
  whatever the outcome.
- Per-run budgets over syscalls, model calls, model input, publications and
  wall-clock time.
- Dry-run mode that evaluates and logs everything and executes nothing.

### Policy

- Declarative packs in a strict YAML subset, parsed by a dependency-free parser.
- Order-independent evaluation: `deny > require_approval > allow`, deny by
  default, `transform` contributing obligations without deciding.
- Condition language with 15 total operators, `all`/`any`/`not` composition, and
  dotted paths into the syscall and the agent manifest. Unknown operators
  evaluate false and are rejected by the linter.
- Only the packs named in an agent's manifest are in force for it.
- Obligations: `redact`, `coarsen_geo`, `label`, `cite`, `rate_limit`, plus
  declarative `log` and `retain`.
- Four shipped packs: `baseline`, `eu-ai-act-high-risk`, `ngo-document-handling`,
  `humanitarian-response`, each citing its authority.

### Oversight

- Approval requests with quorum, fixed reason-code vocabularies and expiry;
  expired is treated exactly like refused.
- Four gateways: `AutoDenyGateway`, `QueueGateway`, `InteractiveGateway`,
  `ScriptedGateway`.
- File-backed approval queue that survives between CLI invocations.

### Audit

- Hash-chained append-only ledger over canonical JSON, in memory or on disk.
- Verification that detects edits, deletions, insertions and reordering, and
  names the first failing record.
- Transparency reports in markdown or JSON, aggregating effects, approvals,
  redactions, rules fired and external controls exercised.

### Orchestration

- `Supervisor` running dependency-ordered plans with an explicit concurrency
  limit and a shared, mediated blackboard.
- Stable topological sort with cycle detection.

### Agents

- `ngo-doc-summarizer` — minimisation at the boundary and reviewer sign-off.
- `disaster-info-coordinator` — three narrow agents with separation of duties,
  independent-channel corroboration, location coarsening and a two-person rule.

### Tooling

- `civicos` CLI: `doctor`, `agents`, `policy lint|list|explain`, `run`,
  `approvals`, `audit verify|tail|export`, `report`, `console`.
- Local read-only oversight console.
- Deterministic offline model provider; optional Claude adapter behind an
  optional peer dependency.

### Project

- 125 tests, no test framework and no network.
- Four runnable examples and a scripted end-to-end demo.
- Architecture, policy reference, agent guide, oversight guide, audit guide,
  compliance map, threat model, roadmap and five ADRs.

[Unreleased]: https://github.com/nityam02/civicos/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nityam02/civicos/releases/tag/v0.1.0
