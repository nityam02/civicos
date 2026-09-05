# 01 - Hello agent

The smallest deployment that is still a CivicOS deployment: one policy pack, one
manifest, one agent, an in-memory ledger.

```bash
node examples/01-hello-agent/index.mjs
```

Three things to notice.

The agent asks to publish and is refused. It holds no `publish` capability, so
the kernel stops the request before policy is consulted - and the refusal comes
back as a value, not an exception, so the agent can carry on and report it.

The email address in the input never reaches the model. The `redact` obligation
on the `allow-summarise` rule rewrites the payload on the way through the
kernel; the last line of the example asserts it is absent from the whole ledger.

The ledger verifies. Two mediated actions, hash-chained, checkable.
