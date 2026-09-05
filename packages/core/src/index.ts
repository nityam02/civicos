/**
 * CivicOS - an operating system for safe, public-interest AI agents.
 *
 * Public API surface. Everything a host application needs to run agents under
 * capability control, declarative policy, human oversight and a tamper-evident
 * audit ledger.
 *
 * @packageDocumentation
 */
export * from './types.js';

export { PolicyEngine } from './policy/engine.js';
export type { EvaluationResult, EvaluationSubject } from './policy/engine.js';
export {
  parsePolicyPack,
  loadPolicyPack,
  loadPolicyDirectory,
  lintPolicyPack,
} from './policy/pack.js';
export type { PolicyPack, PolicyRule, Authority, ApprovalSpec, LintIssue } from './policy/pack.js';
export { evaluateCondition, getPath, unknownOperators } from './policy/conditions.js';
export type { Condition, Operators } from './policy/conditions.js';

export { AuditLedger, MemoryLedger, FileLedger, verifyChain, GENESIS } from './audit/ledger.js';
export type { AuditInput, VerificationResult } from './audit/ledger.js';
export { buildTransparencySummary, renderTransparencyMarkdown } from './audit/report.js';
export type { TransparencySummary } from './audit/report.js';

export { Kernel } from './runtime/kernel.js';
export type { KernelOptions } from './runtime/kernel.js';
export { Supervisor, topoSort } from './runtime/orchestrator.js';
export type { Plan, Task, TaskOutcome, RunReport } from './runtime/orchestrator.js';
export {
  ApprovalStore,
  FileApprovalStore,
  AutoDenyGateway,
  QueueGateway,
  ScriptedGateway,
} from './runtime/approvals.js';
export type {
  ApprovalGateway,
  ApprovalOutcome,
  CreateApprovalInput,
  VoteInput,
} from './runtime/approvals.js';
export { BudgetMeter, DEFAULT_BUDGET } from './runtime/budget.js';
export { checkCapability, validateManifest, assertManifestValid } from './runtime/capabilities.js';
export type { CapabilityCheck, ManifestIssue } from './runtime/capabilities.js';
export {
  DETECTORS,
  redactText,
  coarsenGeo,
  coarsenCoordinate,
  applyObligationsToPayload,
} from './runtime/redact.js';
export type { Detector, RedactionResult } from './runtime/redact.js';

export {
  modelHandler,
  fileReadHandler,
  fileWriteHandler,
  publishHandler,
  messageHandler,
  networkHandler,
} from './handlers/index.js';

export { DeterministicModel, splitSentences, tokenise } from './providers/deterministic.js';
export { AnthropicModel, providerFromEnv } from './providers/anthropic.js';
export type { AnthropicModelOptions } from './providers/anthropic.js';

export { bootstrap } from './bootstrap.js';
export type { BootstrapOptions, Deployment } from './bootstrap.js';

export { parseYaml, parseYamlObject, YamlError } from './util/yaml.js';
export { canonicalJSON, sha256, hashValue, commitment, newId } from './util/canonical.js';
export { globMatch, globToRegExp, globSpecificity } from './util/glob.js';
export { createLogger, createMemoryLogger } from './util/logger.js';
export type { LogLevel } from './util/logger.js';
export { systemClock, fixedClock } from './util/clock.js';

export const CIVICOS_VERSION = '0.1.0';
