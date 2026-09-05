# Human oversight

The EU AI Act requires that high-risk systems be built so a natural person can
effectively oversee them. The UNESCO Recommendation requires meaningful human
control. Both are easy to satisfy on paper — put a person in the loop — and easy
to hollow out in practice: one tired reviewer, an approve button, no record of
what they were shown or why they said yes.

CivicOS makes three specific things structural.

## 1. A quorum

`quorum: 2` means two *distinct* approvers. The store refuses a second vote from
the same person, so one reviewer cannot supply a whole quorum. When several rules
demand approval, the highest quorum wins.

The shipped `eu-ai-act-high-risk` pack applies a two-person rule to every
publication by an agent that declares the high risk tier.

## 2. A reason code from a fixed vocabulary

Every vote carries a code from the list the rule declares:

```yaml
reasonCodes: [accurate, inaccurate, privacy_risk, harm_risk, out_of_scope]
```

A vote with a code that is not on the list is rejected. This is what turns
oversight into something measurable: the transparency report can say that seven
publications were refused for `privacy_risk` last month, which is a fact an
organisation can act on. "A human reviewed it" is not.

## 3. An expiry

Every request has a deadline. When it passes, the status becomes `expired`, and
the kernel treats `expired` exactly like a refusal.

Silence is never consent. A queue that quietly drains into "approved" because
nobody looked is worse than no queue at all, because it produces an audit trail
that says a human agreed.

## What the reviewer sees

The approval request is built **after** the redaction obligations have run, so
the preview a reviewer reads has already had personal data removed. Oversight
should not require handing a reviewer more data than the model was allowed to
see.

The request carries the agent, the run, the action, the resource, the required
role, the quorum, the expiry, the permitted reason codes, and the redacted
preview.

## Gateways

Who is available to answer is a deployment decision, not an agent one. The same
agent and the same policy behave differently under different gateways.

| Gateway | Behaviour | Use |
| --- | --- | --- |
| `AutoDenyGateway` | Refuses immediately, recording `system:auto-deny` | Unattended runs, CI. The safe default |
| `QueueGateway` | Leaves the request pending; the run continues without the action | A staffed review queue |
| `InteractiveGateway` | Stops the run, prints the redacted preview, asks at the terminal | Live operation, demos |
| `ScriptedGateway` | Replays a fixed script | Tests and examples only |

```bash
civicos run ngo-doc-summarizer --input report.txt --approvals interactive
```

`ScriptedGateway` records its reviewer as `demo:approver` permanently, so a
scripted approval can never be mistaken for a real one when reading a ledger back.

Writing your own is one method — route approvals into Slack, a ticketing system,
or a duty roster:

```ts
class SlackGateway implements ApprovalGateway {
  id = 'slack';
  async request(input: CreateApprovalInput, store: ApprovalStore) {
    const request = store.create(input);
    await postToSlack(request);            // includes the redacted preview
    return { status: 'pending' as const, request };
  }
}
```

## Working the queue

```bash
civicos approvals list
civicos approvals show apr_8f2c1a...
civicos approvals approve apr_8f2c1a... --as ana --role editor --reason accurate
civicos approvals deny    apr_8f2c1a... --as ben --role editor --reason privacy_risk --note "names a caseworker"
```

Approving a request does **not** replay the action. The run that raised it has
finished; the approval is now on record, and the work is re-run deliberately.
That is a design choice: an action that fires later, unattended, on the strength
of an approval given for a context that has since changed is a different and
worse system.

## What is recorded

Two ledger records per escalation — `approval.requested` and
`approval.resolved` — plus the outcome on the syscall record itself. Between them
they carry the request id, the final status, every approver by name, and every
reason code. All of it is hash-chained with everything else.

## What this does not solve

Automation bias is real: reviewers approve what a machine proposes, especially
under time pressure. A quorum and a reason code make it harder to do
thoughtlessly; they do not make it impossible.

Mitigations that belong in deployment practice rather than in a kernel: rotate
reviewers, sample and re-review approved items, and watch the ratio of refusals
to approvals in the transparency report. A reviewer who has never refused
anything is not providing oversight.
