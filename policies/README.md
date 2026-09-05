# Policy packs

The rules that govern what agents in this deployment may do. They are data, not
code: a data protection officer, a protection adviser or a board member can read,
diff and argue with them without reading TypeScript.

| Pack | Applies to | What it does |
| --- | --- | --- |
| [`00-baseline.yaml`](00-baseline.yaml) | Every agent | Deny by default. Minimise personal data before the model. No outbound network. Human approval before anything is published. |
| [`10-eu-ai-act-high-risk.yaml`](10-eu-ai-act-high-risk.yaml) | Agents declaring `riskTier: high` | Two-person rule on publication, full traceability on model calls, Article 50 transparency notice. |
| [`20-ngo-document-handling.yaml`](20-ngo-document-handling.yaml) | Agents reading civil-society records | Purpose limitation to a named corpus, identifier stripping, escalation for briefs touching vulnerable groups. |
| [`30-humanitarian-response.yaml`](30-humanitarian-response.yaml) | Agents handling crisis reports | Location coarsening, corroboration thresholds, refusal to publish products identifying individuals or giving clinical advice. |

Only the packs named in an agent's manifest are in force for that agent.

```bash
civicos policy lint      # validate every pack
civicos policy list      # every rule, effect and control
civicos policy explain --agent crisis-brief --kind publish --resource public/sitreps/x.md
```

Full reference: [docs/policy-language.md](../docs/policy-language.md).
Contributing a pack: [CONTRIBUTING.md](../CONTRIBUTING.md#contributing-a-policy-pack).

## Reading a rule

```yaml
- id: escalate-single-source-reports
  description: A coordination product resting on fewer than two independent reports needs a duty officer.
  when:
    all:
      - kind: publish
      - payload.corroboration: { lt: 2 }
  effect: require_approval
  risk: 60
  controls: [SPHERE-CHS-4, CIVICOS-VERIFY-01]
  approval:
    role: duty-officer
    quorum: 1
    expiresInMs: 1800000
    reasonCodes: [corroborated, single_source_acceptable, reject, needs_field_check]
```

`description` is what a reviewer reads. `controls` is what the transparency
report counts. `reasonCodes` is what makes the eventual human decision analysable
rather than a click.
