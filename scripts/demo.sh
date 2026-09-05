#!/usr/bin/env bash
# End-to-end tour of CivicOS. No API key, no network.
#
#   npm run demo
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CIVICOS="node packages/cli/dist/bin.js"
STATE="$ROOT/.civicos-demo"
rm -rf "$STATE"

step() {
  printf '\n\033[1m%s\033[0m\n' "$1"
  printf '\033[2m%s\033[0m\n\n' "$2"
}

step "1. Is this deployment coherent?" "civicos doctor"
$CIVICOS doctor --state "$STATE"

step "2. What rules are in force, and where do they come from?" "civicos policy lint"
$CIVICOS policy lint

step "3. What would policy decide, without running anything?" \
  "civicos policy explain --agent crisis-brief --kind publish --resource public/sitreps/today.md"
$CIVICOS policy explain --agent crisis-brief --kind publish \
  --resource public/sitreps/today.md \
  --payload '{"text":"Flooding on the harbour road.","sources":["r-001"],"corroboration":1}'

step "4. Run the summariser with nobody available to approve." \
  "civicos run ngo-doc-summarizer --input data/samples/ngo-report.txt"
$CIVICOS run ngo-doc-summarizer --input data/samples/ngo-report.txt --state "$STATE" --quiet

step "5. What is waiting for a human?" "civicos approvals list"
$CIVICOS approvals list --state "$STATE"

step "6. Run the three-agent crisis pipeline, with reviewers available." \
  "civicos run disaster-info-coordinator --input data/samples/incoming-reports.jsonl --approvals demo-approve"
$CIVICOS run disaster-info-coordinator \
  --input data/samples/incoming-reports.jsonl \
  --approvals demo-approve --state "$STATE" --quiet

step "7. Is the audit ledger intact?" "civicos audit verify"
$CIVICOS audit verify --state "$STATE"

step "8. What did the agents actually do?" "civicos report"
$CIVICOS report --state "$STATE" | head -40

printf '\n\033[2mPublished output is under %s/out/published.\n' "$STATE"
printf 'Open the oversight console with: civicos console --state %s\033[0m\n\n' "$STATE"
