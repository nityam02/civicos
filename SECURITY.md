# Security policy

## Reporting a vulnerability

Report privately, not in a public issue.

- Use GitHub's private vulnerability reporting: **Security → Report a
  vulnerability** on this repository.

Please include what you can: what the issue is, how to reproduce it, what an
attacker gets, and which version or commit you tested.

We will acknowledge within 5 working days, tell you our assessment and a rough
timeline within 10, and credit you in the release notes unless you would rather
we did not.

## What counts as a vulnerability

Anything that breaks an invariant the system claims to hold:

- An agent performing an action outside its declared capabilities.
- Bypassing policy evaluation, or making a `deny` fail open.
- Reading or writing outside the confined workspace root.
- Escaping the network allowlist.
- Forging, reordering or editing audit records without verification detecting it.
- Satisfying an approval quorum without distinct approvers, or acting on an
  expired or pending approval.
- Personal data reaching the model or the approval preview when a `redact`
  obligation applied to it.
- Crashing the kernel mid-syscall in a way that skips the audit record.
- A crafted policy file causing arbitrary code execution or unbounded
  computation in the parser.

## What does not

These are documented limitations, not bugs. See
[docs/threat-model.md](docs/threat-model.md).

- **A malicious operator.** Whoever runs the deployment can change the policy
  packs or delete the ledger. CivicOS is a control for an organisation, not
  against it.
- **Redaction misses.** The detectors are patterns and will miss unusual formats.
  A specific realistic pattern that is missed is a very welcome *issue*, and
  improving the detectors is a welcome pull request.
- **Prompt injection influencing model output.** CivicOS bounds the consequences
  rather than preventing the manipulation. If you find an injection that escapes
  the *capability* boundary, that is a vulnerability and we want to hear about it.
- **The console.** It binds to 127.0.0.1 and is read-only by design.

## Supported versions

Pre-1.0: only the latest release is supported. Fixes land on `main`.

## Disclosure

Coordinated. We will agree a date with you, aiming for 90 days or sooner if a fix
ships earlier. If a vulnerability is being exploited, we will move faster and say
so.
