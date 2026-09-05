# 0002 — Policy evaluation is order-independent

**Status**: Accepted · 2026-09

## Context

Firewall rules, IAM policies and most access-control languages are evaluated in
order: first match wins, or last match wins. This is easy to implement and hard
to review. A rule appended at the bottom can silently shadow a deny above it, and
the only way to know what a policy does is to simulate it.

CivicOS policy files are meant to be read and edited by people who are not
engineers — a data protection officer, a protection adviser, a board member. For
them, "it depends where in the file you put it" is a trap.

## Decision

Every rule in every pack in force is evaluated. All matches are collected. The
strongest effect wins, in a fixed precedence:

```
deny  >  require_approval  >  allow
```

`transform` never decides an outcome; it only contributes obligations. When no
rule matches, the pack default applies, which is `deny`.

## Consequences

**Good.** Appending a rule can only make the system stricter — it is impossible
to weaken the policy by adding to it. Reviewers reach the same conclusion the
engine does without simulating. Merging two packs is well-defined. The decision
carries every matched rule, which is the explanation.

**Costs.** You cannot write a specific exception to a general deny. Carving out an
exception means narrowing the deny rule itself, which is more work and more
visible in a diff. We think that is the right trade for this audience: an
exception that is hard to add quietly is a feature.

Evaluating every rule is O(rules) per syscall rather than short-circuiting. Packs
are tens of rules and evaluation is microseconds; if that ever matters, index by
`kind` first.

**Related.** Approval requirements from several rules merge to the most demanding:
highest quorum, shortest expiry, union of reason codes. Same principle.
