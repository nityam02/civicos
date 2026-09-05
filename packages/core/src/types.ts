/**
 * CivicOS core type definitions.
 *
 * The vocabulary here is deliberately small. Everything an agent can do in
 * CivicOS is expressed as a {@link Syscall} that the {@link Kernel} mediates,
 * and every mediated syscall produces exactly one tamper-evident
 * {@link AuditRecord}. If a concept cannot be expressed in these types, an
 * agent cannot do it.
 */

/** The complete set of privileged operations an agent may request. */
export type SyscallKind =
  | 'model.complete'
  | 'data.read'
  | 'data.write'
  | 'net.fetch'
  | 'agent.spawn'
  | 'message.send'
  | 'tool.invoke'
  | 'publish';

export const SYSCALL_KINDS: readonly SyscallKind[] = [
  'model.complete',
  'data.read',
  'data.write',
  'net.fetch',
  'agent.spawn',
  'message.send',
  'tool.invoke',
  'publish',
];

/** Outcome of policy evaluation for a single syscall. */
export type Effect = 'allow' | 'deny' | 'require_approval' | 'transform';

/**
 * Risk tier, aligned with the EU AI Act's risk-based structure. CivicOS uses it
 * to pick default obligations: `high` forces human oversight on every
 * externally visible action.
 */
export type RiskTier = 'minimal' | 'limited' | 'high';

export interface Principal {
  id: string;
  kind: 'agent' | 'human' | 'service';
  roles?: string[];
}

/**
 * An unforgeable grant. Capabilities are declared in an agent manifest and
 * checked by the kernel before policy is even consulted: policy can only
 * narrow what a capability already permits, never widen it.
 */
export interface Capability {
  /** Glob over the resource namespace, e.g. `corpus/**` or `public/briefs/*`. */
  resource: string;
  actions: SyscallKind[];
  /** Free-form constraints surfaced to policy rules as `capability.constraints`. */
  constraints?: Record<string, unknown>;
}

/** Declarative, reviewable description of an agent. Required to run. */
export interface AgentManifest {
  id: string;
  name: string;
  version: string;
  /** Plain-language statement of what this agent is for. Published verbatim in transparency reports. */
  purpose: string;
  riskTier: RiskTier;
  owner: string;
  contact: string;
  capabilities: Capability[];
  /** Ids of policy packs that must be loaded for this agent to run. */
  policies: string[];
  /** Categories of data the agent may touch, e.g. `personal_data`, `location`. */
  dataCategories: string[];
  humanOversight: {
    required: boolean;
    /** Roles entitled to approve this agent's escalations. */
    roles: string[];
  };
  /** Known limitations, published with every transparency report. */
  limitations?: string[];
}

export interface Syscall {
  id: string;
  ts: string;
  /** Id of the run this syscall belongs to; ties a whole session together. */
  runId: string;
  /** Id of the requesting agent (from its manifest). */
  agentId: string;
  kind: SyscallKind;
  resource: string;
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export type ObligationType =
  | 'redact'
  | 'coarsen_geo'
  | 'label'
  | 'cite'
  | 'log'
  | 'rate_limit'
  | 'retain';

/**
 * A duty attached to a decision. Obligations are executed by the kernel, not by
 * the agent; an agent cannot decline one.
 */
export interface Obligation {
  type: ObligationType;
  /** Dotted paths into the syscall, e.g. `payload.text`. */
  fields?: string[];
  detectors?: string[];
  /** For `coarsen_geo`: decimal places to keep (2 dp ~ 1.1 km). */
  precision?: number;
  /** For `label`: text prepended to outputs. */
  text?: string;
  /** For `rate_limit`: max invocations per window. */
  max?: number;
  windowMs?: number;
  /** For `retain`: retention period in days, published in the transparency report. */
  days?: number;
  [key: string]: unknown;
}

export interface DecisionReason {
  ruleId: string;
  packId: string;
  effect: Effect;
  description: string;
  /** External control identifiers, e.g. `EU-AI-ACT-ART-14`. */
  controls: string[];
}

export interface PolicyDecision {
  effect: Effect;
  /** Every rule that matched, in evaluation order. This is the explanation. */
  reasons: DecisionReason[];
  obligations: Obligation[];
  /** 0-100. Derived from matched rules; used for triage, never for enforcement. */
  riskScore: number;
  /** True when no rule matched and the pack default applied. */
  usedDefault: boolean;
}

export interface RedactionFinding {
  detector: string;
  field: string;
  /** Short commitment to the removed value: proves *what* was removed without storing it. */
  commitment: string;
  count: number;
}

export interface AuditRecord {
  seq: number;
  ts: string;
  runId: string;
  actor: string;
  event: AuditEvent;
  kind?: SyscallKind;
  resource?: string;
  syscallId?: string;
  decision?: {
    effect: Effect;
    riskScore: number;
    reasons: DecisionReason[];
    usedDefault: boolean;
  };
  obligations?: Obligation[];
  redactions?: RedactionFinding[];
  approval?: {
    requestId: string;
    status: ApprovalStatus;
    approvers: string[];
    reasonCodes: string[];
  };
  outcome?: 'ok' | 'error' | 'skipped';
  error?: string;
  meta?: Record<string, unknown>;
  /** Hash of the previous record; `GENESIS` for the first. */
  prevHash: string;
  /** SHA-256 over the canonical JSON of this record excluding `hash`. */
  hash: string;
}

export type AuditEvent =
  | 'run.start'
  | 'run.end'
  | 'syscall'
  | 'approval.requested'
  | 'approval.resolved'
  | 'budget.exceeded'
  | 'capability.denied'
  | 'obligation.unsatisfied'
  | 'agent.note';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalVote {
  approver: string;
  role: string;
  vote: 'approve' | 'deny';
  /** Constrained vocabulary so approvals are analysable, not just free text. */
  reasonCode: string;
  note?: string;
  ts: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  agentId: string;
  syscallId: string;
  kind: SyscallKind;
  resource: string;
  /** Human-readable summary of what is being asked. */
  summary: string;
  /** Redacted preview of the payload, safe to show a reviewer. */
  preview: string;
  requiredRole: string;
  quorum: number;
  reasonCodes: string[];
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  votes: ApprovalVote[];
}

export interface Budget {
  maxSyscalls?: number;
  maxModelCalls?: number;
  maxModelInputChars?: number;
  maxWallMs?: number;
  maxPublishes?: number;
}

export interface BudgetUsage {
  syscalls: number;
  modelCalls: number;
  modelInputChars: number;
  publishes: number;
  wallMs: number;
}

export interface SyscallReceipt {
  syscallId: string;
  runId: string;
  ledgerSeq: number;
  effect: Effect;
  /** Hash of the audit record: a pointer a citizen can verify against the ledger. */
  recordHash: string;
}

export interface SyscallResult<T = unknown> {
  ok: boolean;
  value?: T;
  decision: PolicyDecision;
  receipt: SyscallReceipt;
  error?: string;
  /** True when the kernel evaluated but deliberately did not execute (dry run). */
  simulated?: boolean;
}

export interface ModelRequest {
  system?: string;
  prompt: string;
  maxOutputChars?: number;
  /** Free-form task hint used by the deterministic provider to pick a strategy. */
  task?: 'summarize' | 'classify' | 'extract' | 'draft';
  options?: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  provider: string;
  model: string;
  /** Deterministic providers report `true`; identical input yields identical output. */
  deterministic: boolean;
  usage?: { inputChars: number; outputChars: number; inputTokens?: number; outputTokens?: number };
}

export interface ModelProvider {
  id: string;
  model: string;
  deterministic: boolean;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** A registered implementation of a syscall kind. */
export interface SyscallHandler {
  kind: SyscallKind;
  /** Glob of resources this handler serves. First match wins. */
  resource: string;
  execute(syscall: Syscall, ctx: HandlerContext): Promise<unknown>;
}

export interface HandlerContext {
  model: ModelProvider;
  /** Shared, in-run key/value space; the only channel between agents. */
  blackboard: Map<string, unknown>;
  workspace: string;
  logger: Logger;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export interface Clock {
  now(): Date;
}

export interface AgentContext {
  manifest: AgentManifest;
  runId: string;
  input: unknown;
  blackboard: Map<string, unknown>;
  logger: Logger;
  /** The only way an agent can affect the world. */
  syscall<T = unknown>(
    req: Omit<Syscall, 'id' | 'ts' | 'runId' | 'agentId'>,
  ): Promise<SyscallResult<T>>;
  /** Convenience wrapper over a `model.complete` syscall. */
  complete(req: ModelRequest, resource?: string): Promise<string>;
  note(message: string, meta?: Record<string, unknown>): Promise<void>;
}

export interface AgentResult {
  summary: string;
  output: unknown;
  /** Receipts for every consequential action, for the run report. */
  receipts: SyscallReceipt[];
}

export interface Agent {
  manifest: AgentManifest;
  run(ctx: AgentContext): Promise<AgentResult>;
}
