# 0003 — Zero runtime dependencies, including the YAML parser

**Status**: Accepted · 2026-09

## Context

The kernel decides what an agent may do. Everything inside that boundary is
security-relevant. A dependency tree of hundreds of transitive packages inside a
trust boundary is not auditable by the organisations this project is for, and a
supply-chain compromise of any one of them is a compromise of the policy engine.

The awkward case is YAML. Policy files should be human-readable, which points at
YAML, and the obvious move is to depend on a parser.

## Decision

Zero runtime dependencies. `@anthropic-ai/sdk` is an optional peer dependency,
imported lazily and only when someone opts into a hosted model — it is not
required to install, build, test or run anything.

Policy files are parsed by a 300-line strict subset parser written for this
purpose (`util/yaml.ts`), which supports block maps and sequences, comments,
quoted and plain scalars, flow collections and block scalars — and rejects tabs,
anchors, aliases, tags, multiple documents, merge keys, duplicate keys, and the
ambiguous booleans `yes`/`no`/`on`/`off`.

## Consequences

**Good.** The trusted computing base is one person's afternoon. No transitive
supply chain inside the boundary. `npm install` pulls TypeScript and `@types/node`
and nothing else. The parser rejects the YAML features that cause surprises in
security-relevant files rather than trying to support them correctly.

**Costs.** A parser is code we maintain and could get wrong, so it carries its own
test suite covering the whole supported subset and every rejection. Users
occasionally hit a YAML feature that a general parser would accept — that is
intentional, and the error says so.

**Rejected alternatives.** JSON policies: unreadable for the intended audience and
no comments. Depending on `yaml`: a well-maintained library, but it is a large
surface inside the boundary and its permissive coercions are exactly the wrong
behaviour in a file that decides what an agent may do.
