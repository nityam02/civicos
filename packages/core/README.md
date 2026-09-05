# @civicos/core

The CivicOS kernel: capability-mediated syscalls, a declarative policy engine,
obligation enforcement, human approval workflows, a hash-chained audit ledger and
multi-agent orchestration.

**Zero runtime dependencies.** The kernel decides what an agent may do, so the
trusted computing base is kept small enough for one person to read.

```ts
import { bootstrap } from '@civicos/core';

const d = bootstrap({ root: process.cwd() });   // loads ./policies, opens ./.civicos
d.supervisor.register(myAgent);

const report = await d.supervisor.runAgent('my-agent', input);
console.log(d.ledger.verify());
```

Documentation lives in the [repository root](https://github.com/nityam02/civicos):
[architecture](https://github.com/nityam02/civicos/blob/main/docs/architecture.md),
[policy language](https://github.com/nityam02/civicos/blob/main/docs/policy-language.md),
[writing agents](https://github.com/nityam02/civicos/blob/main/docs/writing-agents.md).

Apache 2.0.
