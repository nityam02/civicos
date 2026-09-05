# @civicos/agents

Reference agents for [CivicOS](https://github.com/nityam02/civicos). They are
written to be read rather than reused blindly: each one demonstrates a different
part of the kernel contract.

**`ngo-doc-summarizer`** — reads documents a civil-society organisation already
holds and drafts a sourced brief. Shows minimisation at the boundary and
single-reviewer sign-off.

**`disaster-info-coordinator`** — three narrow agents rather than one wide one.
Intake can read the feed but not publish; verification can reason but not read or
publish; the brief agent can publish but only sees what verification sent. Shows
separation of duties, independent-channel corroboration, location coarsening, and
a two-person rule on a high-risk publication.

Both run offline with the deterministic provider. See
[writing agents](https://github.com/nityam02/civicos/blob/main/docs/writing-agents.md).

Apache 2.0.
