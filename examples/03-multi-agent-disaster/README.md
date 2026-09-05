# 03 - Multi-agent disaster coordination

```bash
node examples/03-multi-agent-disaster/index.mjs
```

Ten crowd-sourced reports go in; a situation report comes out, with a named
human on the hook for releasing it.

The interesting part is the split. `crisis-intake` can read the feed but cannot
publish. `crisis-verification` can reason about the feed but can neither read
files nor publish. `crisis-brief` can publish but can only see what verification
put on the bus. There is no arrangement of these three agents in which a raw,
unverified report reaches the public without passing verification first, because
no single agent holds both ends of that path.

Watch what the policy does to the product without the agents being asked:

- coordinates are rounded to two decimal places, roughly a kilometre, so the
  report can route aid without telling anyone where a shelter is to the metre;
- a report naming a duty nurse and her phone number is withheld entirely;
- the situation report is published only after a human duty officer signs it,
  and because `crisis-brief` declares the high risk tier, the EU AI Act pack
  raises that to two reviewers.
