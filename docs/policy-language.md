# The CivicOS policy language

Policy packs are YAML files in `policies/`. They are meant to be read and argued
with by people who do not write TypeScript, so the language is small on purpose.

Validate a directory at any time:

```bash
civicos policy lint
civicos policy list
```

## Pack structure

```yaml
id: baseline                    # lowercase kebab-case, referenced from agent manifests
version: 1.0.0
title: CivicOS Baseline Safety Policy
description: >
  What this pack is for, in prose.

authority:                      # what this pack implements. Shown in transparency reports.
  - framework: EU Artificial Intelligence Act (Regulation 2024/1689)
    reference: "Article 14"
    requirement: High-risk systems are designed so natural persons can effectively oversee them.

defaults:
  effect: deny                  # what happens when no rule matches
  risk: 15

rules:
  - id: allow-corpus-read
    description: Agents may read documents inside the corpus namespace they were given.
    when:
      kind: data.read
      resource: { glob: "corpus/**" }
    effect: allow
    risk: 2
    controls: [CIVICOS-DATA-01]
```

A pack that fails to parse or that fails linting **refuses to load**. There is no
partial-load mode: a policy file the system half-understood is worse than none.

## Which packs apply

Only the packs named in an agent's `policies` array are in force for that agent.
A pack written for humanitarian work does not silently govern an unrelated agent,
and the manifest stays an accurate statement of what binds it.

## Effects

| Effect | Meaning |
| --- | --- |
| `allow` | Permitted, subject to obligations |
| `deny` | Refused. Obligations are discarded — nothing runs, so nothing is owed |
| `require_approval` | A human with the named role must sign off first |
| `transform` | Never decides the outcome; contributes obligations to whichever effect wins |

Every matching rule is collected and the **strongest** effect wins:

```
deny  >  require_approval  >  allow
```

This is the most important property of the language. Because precedence is fixed
and not positional, rule order cannot change the outcome; appending a rule can
only ever make the system stricter. A reviewer reading the pack top to bottom
reaches the same conclusion the engine does.

## Conditions

`when` is data, not a program. There is no `eval`, no user-supplied function,
every operator terminates, and an operator applied to the wrong type is `false`
rather than an exception — a malformed rule can never crash the kernel mid-run
and fail open.

### Fields

Dotted paths into the evaluation subject:

| Path | Example |
| --- | --- |
| `kind` | `publish` |
| `resource` | `public/sitreps/today.md` |
| `payload.*` | `payload.corroboration`, `payload.text`, `payload.sources` |
| `meta.*` | anything the agent attached |
| `agent.riskTier` | `minimal` / `limited` / `high` |
| `agent.dataCategories` | `['personal_data', 'location']` |
| `agent.humanOversightRequired` | `true` / `false` |
| `context.dryRun` | `true` during `--dry-run` |
| `context.usage` | budget counters so far this run |

### Shorthands

```yaml
when:
  kind: publish                       # equality
  resource: [a/b, c/d]                # membership
```

### Operators

```yaml
when:
  resource:        { glob: "public/**" }       # or a list of globs
  payload.text:    { regex: "^classified" }    # case-insensitive, length-capped
  payload.count:   { gt: 5 }                   # gt gte lt lte
  payload.status:  { in: [draft, review] }     # in, nin
  payload.tags:    { contains: urgent }        # string or array membership
  payload.title:   { icontains: "sitrep" }
  payload.sources: { exists: true }            # exists: false matches absent/null
  payload.body:    { length_gt: 20000 }        # length_gt, length_lt
  payload.state:   { ne: archived }            # eq, ne
```

An operator the engine does not implement evaluates to **false**, and
`civicos policy lint` reports it as an error. An unreviewed rule must never be
the thing that allows an action.

### Composition

```yaml
when:
  all:
    - kind: publish
    - any:
        - payload.corroboration: { lt: 2 }
        - payload.identifiesIndividuals: true
    - not:
        resource: { glob: "public/drafts/**" }
```

## Obligations

Duties attached to a decision and executed by the kernel, not the agent.

```yaml
obligations:
  - type: redact
    fields: [payload.prompt, payload.text]
    detectors: [email, phone, payment_card, national_id, credential, ipv4, geo]

  - type: coarsen_geo
    fields: [payload.text]
    precision: 2                # decimal places; 2 dp is roughly 1.1 km

  - type: label
    text: "AI-generated content, reviewed by a human editor."

  - type: cite
    fields: [payload.sources]   # the action is refused if this is empty

  - type: rate_limit
    max: 20
    windowMs: 3600000

  - type: log
    level: full                 # recorded on the audit record

  - type: retain
    days: 365                   # declared and reported; enforcement is on the roadmap
```

**Enforcement status, stated plainly.** `redact`, `coarsen_geo` and `label`
rewrite the payload. `cite` and `rate_limit` block the action when unsatisfied.
`log` and `retain` are recorded on the audit record and aggregated in
transparency reports, but the kernel does not yet enforce a retention schedule.
Do not read a `retain` obligation as a deletion guarantee.

### Detectors

| Detector | Notes |
| --- | --- |
| `email` | Standard addresses |
| `phone` | International and national; validated to 9–15 digits so dates survive |
| `ipv4` | Octet-validated |
| `payment_card` | Luhn-checked, so random digit runs are not destroyed |
| `national_id` | Long identifier runs — deliberately broad, expect false positives |
| `geo` | Decimal coordinate pairs |
| `credential` | API keys, bearer tokens, private key headers |

Redaction is pseudonymising: the same value always becomes the same token,
`[REDACTED:email#5f2a1c8b]`, derived from a salted hash. A reviewer can still see
that one person appears in two documents without seeing who. The audit record
stores the commitment and a count, never the value.

These are patterns, not guarantees. See [threat-model.md](threat-model.md).

## Approval blocks

Required whenever `effect: require_approval`.

```yaml
approval:
  role: editor                  # only this role may decide
  quorum: 2                     # distinct approvers needed
  expiresInMs: 3600000          # after this, the request expires and the action is refused
  reasonCodes: [accurate, inaccurate, privacy_risk, harm_risk, out_of_scope]
```

When several rules demand approval, the requirements merge to the most demanding:
the highest quorum, the shortest expiry, the union of reason codes.

## Risk and controls

`risk` (0–100) accumulates across matched rules into a decision risk score, used
for triage and reporting — never for enforcement. Enforcement is the effect.

`controls` cites the external identifiers a rule implements
(`EU-AI-ACT-ART-14`, `NIST-AI-RMF-MANAGE-2.2`, `GDPR-ART-5-1-C`). The
transparency report aggregates them, which turns "we take oversight seriously"
into "control `EU-AI-ACT-ART-14` was exercised 47 times last month".

## The YAML subset

CivicOS ships its own strict parser rather than depending on a general YAML
library, because policy files sit inside the trust boundary.

**Supported**: nested block maps and sequences, `#` comments, single- and
double-quoted and plain scalars, integers, floats, `true`/`false`, `null`/`~`,
flow sequences `[a, b]`, flow maps `{a: 1}`, block scalars `|` `|-` `>` `>-`.

**Rejected, loudly**: tabs for indentation, anchors and aliases, tags, multiple
documents, merge keys, duplicate keys, and the ambiguous booleans `yes`/`no`/
`on`/`off` — which must be written `true`/`false` or quoted as strings.

## Testing a rule

```bash
civicos policy explain \
  --agent crisis-brief \
  --kind publish \
  --resource public/sitreps/today.md \
  --payload '{"text":"Flooding.","sources":["r-001"],"corroboration":1}'
```

Prints the effect, the risk score, every rule that matched with its control
identifiers, the merged approval requirement, and the obligations that would
apply — without running anything.
