# Examples

Each example is a single runnable file. Build once, then run any of them:

```bash
npm install
npm run build
node examples/01-hello-agent/index.mjs
```

None of them need an API key or a network connection.

| Example | What it shows |
| --- | --- |
| [01-hello-agent](01-hello-agent) | The smallest possible agent: a manifest, one policy pack, one mediated action. |
| [02-approval-flow](02-approval-flow) | The same publication refused, held, and then approved by two named reviewers. |
| [03-multi-agent-disaster](03-multi-agent-disaster) | Three narrow agents composed into a pipeline with a shared bus. |
| [04-audit-verification](04-audit-verification) | Tampering with an audit ledger and watching verification catch it. |
