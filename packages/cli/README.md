# @civicos/cli

The `civicos` command line and local oversight console.

```bash
civicos doctor                  # is this deployment coherent?
civicos policy lint             # validate the packs in force
civicos policy explain --agent crisis-brief --kind publish --resource public/x.md
civicos run ngo-doc-summarizer --input report.txt
civicos approvals list
civicos audit verify
civicos report --out transparency.md
civicos console                 # read-only dashboard on 127.0.0.1:7777
```

`civicos --help` for the full surface. Part of
[CivicOS](https://github.com/nityam02/civicos). Apache 2.0.
