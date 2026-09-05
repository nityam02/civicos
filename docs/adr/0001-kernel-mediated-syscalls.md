# 0001 — Agents act only through kernel-mediated syscalls

**Status**: Accepted · 2026-09

## Context

The usual agent framework hands an agent a set of tools: a function that reads a
file, a function that posts to an API, a model client. Governance is then bolted
on as a wrapper around each tool, or as a prompt instruction, or as a review step
somewhere downstream.

Both approaches leak. A wrapper is only as good as the discipline of whoever adds
the next tool. A prompt instruction is a request, not a control. A downstream
review step sees the output but not what the agent read to produce it.

## Decision

Agents hold no references to the outside world. Not a file handle, not an HTTP
client, not a model SDK, not a reference to another agent. The only operation
available is `ctx.syscall(...)`, which the kernel mediates.

Adding a new capability to the system means adding a syscall kind and a handler —
which means it automatically passes through capability checks, policy, obligations
and the audit log, because there is no other path.

## Consequences

**Good.** One chokepoint, so one place to enforce anything. An agent cannot
accidentally bypass a control, because there is nothing to bypass to. The audit
log is complete by construction rather than by diligence. Testing an agent means
asserting on the ledger, which is also what an auditor reads.

**Costs.** More ceremony than calling `fs.readFile`. Every capability must be
modelled as a syscall kind, which is a design decision each time. Agent code is
more verbose: refusals come back as values that have to be handled.

**Rejected alternative.** Wrapping tools individually. It puts the burden on
whoever adds the next tool, and that person is usually in a hurry.
