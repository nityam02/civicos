import { CIVICOS_VERSION } from '@civicos/core';
import { parseArgs } from './args.js';
import { runCommand } from './commands/run.js';
import { policyCommand } from './commands/policy.js';
import { approvalsCommand } from './commands/approvals.js';
import { auditCommand, reportCommand } from './commands/audit.js';
import { agentsCommand } from './commands/agents.js';
import { doctorCommand } from './commands/doctor.js';
import { consoleCommand } from './commands/console.js';

const HELP = `
civicos ${CIVICOS_VERSION} - an operating system for safe, public-interest AI agents

usage
  civicos <command> [options]

commands
  doctor                          check that this deployment is coherent
  agents list|show <id>           inspect the agents registered here
  policy lint|list                validate and list the policy packs in force
  policy explain                  ask what policy would decide, without running anything
      --agent <id> --kind <syscall-kind> --resource <resource> [--payload '<json>']
  run <agent|plan> --input <path> run an agent or a multi-agent plan
  approvals list|show|approve|deny
                                  work the human approval queue
  audit verify|tail|export        verify or read the tamper-evident ledger
  report                          render a public transparency report
  console [--port 7777]           serve a local read-only oversight dashboard

common options
  --root <dir>        deployment root (default: the working directory)
  --policies <dir>    policy pack directory (default: <root>/policies)
  --state <dir>       ledger and approval state (default: <root>/.civicos)
  --approvals <mode>  queue (default) | interactive | auto-deny | demo-approve
  --dry-run           evaluate and log everything, execute nothing
  --ephemeral         keep the ledger in memory; write nothing to disk
  --json              machine-readable output where supported
  --quiet             errors only
  -h, --help          this text

examples
  civicos doctor
  civicos policy explain --agent crisis-brief --kind publish --resource public/sitreps/x.md
  civicos run ngo-doc-summarizer --input data/samples/ngo-report.txt
  civicos run disaster-info-coordinator --input data/samples/incoming-reports.jsonl --approvals interactive
  civicos audit verify && civicos report --out transparency.md
`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const command = args.positional[0];

  if (!command || args.flags.help === true || args.flags.h === true) {
    process.stdout.write(`${HELP}\n`);
    return command ? 0 : 1;
  }
  if (args.flags.version === true || args.flags.v === true || command === 'version') {
    process.stdout.write(`${CIVICOS_VERSION}\n`);
    return 0;
  }

  try {
    switch (command) {
      case 'doctor':
        return await doctorCommand(args);
      case 'agents':
        return await agentsCommand(args);
      case 'policy':
        return await policyCommand(args);
      case 'run':
        return await runCommand(args);
      case 'approvals':
        return await approvalsCommand(args);
      case 'audit':
        return await auditCommand(args);
      case 'report':
        return await reportCommand(args);
      case 'console':
        return await consoleCommand(args);
      default:
        process.stderr.write(`unknown command "${command}"\n${HELP}\n`);
        return 2;
    }
  } catch (error) {
    process.stderr.write(`\ncivicos: ${error instanceof Error ? error.message : String(error)}\n\n`);
    if (process.env.CIVICOS_DEBUG && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
}
