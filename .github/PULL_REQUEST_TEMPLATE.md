## What this changes

<!-- One or two sentences. What problem does this solve? -->

## How you know it works

<!-- Tests added, examples run, manual checks. -->

## Does this change what an agent is permitted to do?

<!-- Answer explicitly, even if the answer is no. If yes, describe the change in
     permissions: which capability, policy, obligation, approval or audit
     behaviour differs, and why that is safe. These get read closely. -->

- [ ] No
- [ ] Yes — described above

## Checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Behavioural changes have tests
- [ ] Docs updated if behaviour or the policy language changed
- [ ] If this changes an invariant listed in [CONTRIBUTING.md](../CONTRIBUTING.md#the-rules-that-are-not-negotiable), an ADR is included
- [ ] For a policy pack: `authority` cited, `controls` set, reviewed by someone with domain experience (say who)
