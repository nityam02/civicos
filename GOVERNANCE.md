# Governance

CivicOS is infrastructure that other people's accountability rests on. That puts
a particular obligation on how it is governed: the rules for changing it should
be at least as legible as the rules it enforces.

This document describes how the project is run today, honestly, at version 0.1.0.

## Current state

The project is new and currently has a single maintainer. Saying so is more
useful than describing a committee that does not exist.

The immediate goal is to change that: to bring in maintainers from the domains
the policy packs cover — humanitarian information management, data protection,
civil-society technology — because the packs need that judgement more than the
code needs more contributors.

## Roles

**Contributor** — anyone who opens an issue or a pull request. No formality.

**Maintainer** — commit access; reviews and merges. Appointed by existing
maintainers after a sustained record of good judgement in the project, which is
not the same as a high volume of commits.

**Domain reviewer** — someone with practical experience in a field a policy pack
covers, who signs off on that pack's content. A domain reviewer does not need to
write code and does not need commit access. Their review is recorded in the pull
request.

## Decisions

**Ordinary changes** — one maintainer approval, CI green.

**Changes to what an agent may do** — anything touching capability checks, policy
precedence, obligation enforcement, approval semantics or the audit chain needs
an explicit statement in the pull request describing the change in permissions,
and review by a maintainer who did not write it. Once there is more than one
maintainer, this becomes a hard requirement rather than a convention.

**Policy pack content** — needs a domain reviewer. A maintainer approving a
humanitarian rule on technical grounds alone is not sufficient.

**Architectural decisions** — recorded as an [ADR](docs/adr). Superseded records
are marked, not deleted.

## The invariants

Six properties define what this project is. Changing any of them requires an ADR
that explains what replaces the guarantee.

1. Fail closed, everywhere.
2. Every mediated action is logged, whatever the outcome.
3. Capabilities are checked before policy and cannot be widened by it.
4. Zero runtime dependencies in the kernel.
5. Obligations are executed by the kernel, never by the agent.
6. Redaction happens before the model, the reviewer and any output.

## Releases

Semantic versioning. Pre-1.0, minor versions may break interfaces; the
[CHANGELOG](CHANGELOG.md) says what and why.

A release is cut when there is something worth releasing, not on a calendar.
Every release states the head-hash format version, because a change there is a
change to what verification means for existing ledgers.

## Conflicts of interest

Anyone reviewing a policy pack for a domain in which they have a commercial
interest should say so in the pull request. This is not a bar to reviewing; it is
a fact the record should contain.

## Forking

Apache 2.0. Fork it. If you fork because the governance here is not working,
please say so in an issue first — that is useful information.

## Contact

Issues and discussions on GitHub. Security reports via
[SECURITY.md](SECURITY.md).
