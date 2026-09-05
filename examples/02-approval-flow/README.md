# 02 - Approval flow

```bash
node examples/02-approval-flow/index.mjs
```

One agent, one policy, three different answers to the question "who is available
to review this?".

- **`AutoDenyGateway`** is the default for unattended runs. No reviewer, no
  publication. CivicOS fails closed; an escalation is never silently downgraded
  to an allow because nobody was around.
- **`QueueGateway`** leaves the request in a queue and lets the run finish. The
  draft is still written to the workspace, so refusing to publish is a decision a
  human can review rather than a dead end.
- **`ScriptedGateway`** stands in for reviewers in demos and tests. Note that
  the ledger records exactly who decided and on what reason code - and the
  scripted reviewer is called `demo:approver` for ever, so a demo approval can
  never be mistaken for a real one.

The brief mentions safeguarding and children, so
`escalate-briefs-mentioning-vulnerable-groups` in the NGO pack raises the quorum
to two. Neither the agent nor the reviewer chose that; the policy did.
