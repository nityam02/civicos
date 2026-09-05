import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PolicyEngine } from './policy/engine.js';
import { loadPolicyDirectory } from './policy/pack.js';
import type { PolicyPack } from './policy/pack.js';
import { FileLedger, MemoryLedger } from './audit/ledger.js';
import type { AuditLedger } from './audit/ledger.js';
import { Kernel } from './runtime/kernel.js';
import { Supervisor } from './runtime/orchestrator.js';
import { ApprovalStore, FileApprovalStore, AutoDenyGateway } from './runtime/approvals.js';
import type { ApprovalGateway } from './runtime/approvals.js';
import {
  fileReadHandler,
  fileWriteHandler,
  messageHandler,
  modelHandler,
  networkHandler,
  publishHandler,
} from './handlers/index.js';
import { createLogger } from './util/logger.js';
import type { LogLevel } from './util/logger.js';
import type { Budget, Clock, Logger, ModelProvider } from './types.js';
import { DeterministicModel } from './providers/deterministic.js';

export interface BootstrapOptions {
  /** Root of the deployment. Defaults to the current working directory. */
  root?: string;
  /** Directory of policy packs. Defaults to `<root>/policies`. */
  policyDir?: string;
  policies?: PolicyPack[];
  /** State directory for the ledger and approval queue. Defaults to `<root>/.civicos`. */
  stateDir?: string;
  /** Keep everything in memory: used by tests and `--ephemeral`. */
  ephemeral?: boolean;
  model?: ModelProvider;
  gateway?: ApprovalGateway;
  budget?: Budget;
  clock?: Clock;
  logger?: Logger;
  logLevel?: LogLevel;
  dryRun?: boolean;
  /** Hosts `net.fetch` may reach. Empty means no network at all. */
  allowedHosts?: string[];
}

export interface Deployment {
  kernel: Kernel;
  supervisor: Supervisor;
  ledger: AuditLedger;
  approvals: ApprovalStore;
  policy: PolicyEngine;
  logger: Logger;
  paths: { root: string; stateDir: string; workspace: string; outputDir: string };
}

/**
 * Wires a complete, opinionated CivicOS deployment: policy packs loaded from
 * disk, a hash-chained ledger, a persistent approval queue, and the reference
 * handlers confined to the workspace. Every part is replaceable - this is the
 * default, not the only way.
 */
export function bootstrap(options: BootstrapOptions = {}): Deployment {
  const root = resolve(options.root ?? process.cwd());
  const stateDir = resolve(options.stateDir ?? join(root, '.civicos'));
  const outputDir = join(stateDir, 'out');
  const logger = options.logger ?? createLogger({ prefix: '[civicos]', ...(options.logLevel ? { level: options.logLevel } : {}) });

  const packs = options.policies ?? loadPolicyDirectory(options.policyDir ?? join(root, 'policies'));
  const policy = new PolicyEngine(packs);

  let ledger: AuditLedger;
  let approvals: ApprovalStore;
  if (options.ephemeral) {
    ledger = new MemoryLedger();
    approvals = new ApprovalStore(options.clock);
  } else {
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    ledger = new FileLedger(join(stateDir, 'audit.jsonl'));
    approvals = new FileApprovalStore(join(stateDir, 'approvals.json'), options.clock);
  }

  const kernel = new Kernel({
    policy,
    ledger,
    approvals,
    model: options.model ?? new DeterministicModel(),
    gateway: options.gateway ?? new AutoDenyGateway(),
    logger,
    workspace: root,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  });

  kernel
    .registerHandler(modelHandler())
    .registerHandler(fileReadHandler({ root }))
    .registerHandler(fileWriteHandler({ root: outputDir }))
    .registerHandler(publishHandler({ root: join(outputDir, 'published') }))
    .registerHandler(messageHandler())
    .registerHandler(networkHandler(options.allowedHosts ?? []));

  const supervisor = new Supervisor(kernel, logger);

  return {
    kernel,
    supervisor,
    ledger,
    approvals,
    policy,
    logger,
    paths: { root, stateDir, workspace: root, outputDir },
  };
}
