# 04 - Audit verification

```bash
node examples/04-audit-verification/index.mjs
```

Runs the summariser against a real file-backed ledger, verifies the chain, then
edits one record to change who approved the publication - and verification names
the record that moved.

Be precise about the guarantee. A hash chain does not stop the operator of the
system from editing their own log; they hold the file. What it does is make any
edit *detectable* by anyone who holds an earlier head hash. That is why the head
hash appears at the top of every transparency report: publishing it turns a
private log into a public commitment.

See [`docs/threat-model.md`](../../docs/threat-model.md) for what this design
does not defend against.
