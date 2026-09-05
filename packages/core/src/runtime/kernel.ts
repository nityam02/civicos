import type {
  AgentManifest,
  Clock,
  HandlerContext,
  Logger,
  ModelProvider,
  Obligation,
  Syscall,
  SyscallHandler,
  SyscallReceipt,
  SyscallResult,
} from '../types.js';
import type { AuditLedger } from '../audit/ledger.js';
import { PolicyEngine } from '../policy/engine.js';
import { globMatch, globSpecificity } from '../util/glob.js';
import { newId } from '../util/canonical.js';
import { systemClock } from '../util/clock.js';
import { createLogger } from '../util/logger.js';
import { ApprovalStore, AutoDenyGateway } from './approvals.js';
import type { ApprovalGateway } from './approvals.js';
import { BudgetMeter, DEFAULT_BUDGET } from './budget.js';
import { checkCapability } from './capabilities.js';
import { applyObligationsToPayload } from './redact.js';
import type { Budget } from '../types.js';

export interface KernelOptions {
  policy: PolicyEngine;
  ledger: AuditLedger;
  model: ModelProvider;
  approvals?: ApprovalStore;
  gateway?: ApprovalGateway;
  clock?: Clock;
  logger?: Logger;
  budget?: Budget;
  /** Directory handlers may read and write within. */
  workspace?: string;
  /**
   * Evaluate and log everything, execute nothing. The honest way to introduce
   * an agent into a live public-interest workflow before trusting it.
   */
  dryRun?: boolean;
}

interface RegisteredAgent {
  manifest: AgentManifest;
  meter: BudgetMeter;
}

/**
 * The CivicOS kernel.
 *
 * Agents hold no direct references to the outside world: no filesystem, no
 * network, no model client. They can only ask the kernel, and every ask goes
 * through the same six gates in the same order - capability, budget, policy,
 * obligations, human approval, execution - with an audit record written
 * whatever the outcome. Everything interesting about CivicOS is a consequence
 * of that single chokepoint.
 */
export class Kernel {
  readonly policy: PolicyEngine;
  readonly ledger: AuditLedger;
  readonly approvals: ApprovalStore;
  readonly model: ModelProvider;
  readonly blackboard = new Map<string, unknown>();
  readonly dryRun: boolean;
  readonly workspace: string;

  private readonly gateway: ApprovalGateway;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly budget: Budget;
  private readonly handlers: SyscallHandler[] = [];
  private readonly agents = new Map<string, RegisteredAgent>();
  /** Sliding-window timestamps per (agent, kind, resource) for `rate_limit`. */
  private readonly rateWindows = new Map<string, number[]>();

  constructor(options: KernelOptions) {
    this.policy = options.policy;
    this.ledger = options.ledger;
    this.model = options.model;
    this.clock = options.clock ?? systemClock;
    this.approvals = options.approvals ?? new ApprovalStore(this.clock);
    this.gateway = options.gateway ?? new AutoDenyGateway();
    this.logger = options.logger ?? createLogger({ prefix: '[civicos]' });
    this.budget = options.budget ?? DEFAULT_BUDGET;
    this.workspace = options.workspace ?? process.cwd();
    this.dryRun = options.dryRun ?? false;
  }

  registerHandler(handler: SyscallHandler): this {
    this.handlers.push(handler);
    return this;
  }

  registerAgent(manifest: AgentManifest): void {
    for (const packId of manifest.policies) {
      if (!this.policy.getPack(packId)) {
        throw new Error(
          `agent "${manifest.id}" requires policy pack "${packId}", which is not loaded. ` +
            `Loaded packs: ${this.policy.packIds.join(', ') || 'none'}`,
        );
      }
    }
    this.agents.set(manifest.id, { manifest, meter: new BudgetMeter(this.budget) });
  }

  getManifest(agentId: string): AgentManifest | undefined {
    return this.agents.get(agentId)?.manifest;
  }

  startRun(runId: string, meta: Record<string, unknown> = {}): void {
    this.ledger.append({
      ts: this.clock.now().toISOString(),
      runId,
      actor: 'kernel',
      event: 'run.start',
      outcome: 'ok',
      meta: {
        ...meta,
        dryRun: this.dryRun,
        policyPacks: this.policy.packIds,
        model: { provider: this.model.id, model: this.model.model, deterministic: this.model.deterministic },
        gateway: this.gateway.id,
      },
    });
  }

  endRun(runId: string, meta: Record<string, unknown> = {}): void {
    this.ledger.append({
      ts: this.clock.now().toISOString(),
      runId,
      actor: 'kernel',
      event: 'run.end',
      outcome: 'ok',
      meta,
    });
  }

  note(runId: string, actor: string, message: string, meta: Record<string, unknown> = {}): void {
    this.ledger.append({
      ts: this.clock.now().toISOString(),
      runId,
      actor,
      event: 'agent.note',
      outcome: 'ok',
      meta: { message, ...meta },
    });
  }

  /**
   * The single entry point for everything an agent wants to do.
   *
   * Note the ordering: obligations are applied to the payload *before* the
   * approval request is built and before the handler runs, so a reviewer never
   * sees raw personal data and neither does the model.
   */
  async syscall<T = unknown>(
    agentId: string,
    request: Omit<Syscall, 'id' | 'ts' | 'runId' | 'agentId'> & { runId: string },
  ): Promise<SyscallResult<T>> {
    const registered = this.agents.get(agentId);
    if (!registered) throw new Error(`agent "${agentId}" is not registered with this kernel`);
    const { manifest, meter } = registered;

    let syscall: Syscall = {
      id: newId('sys'),
      ts: this.clock.now().toISOString(),
      runId: request.runId,
      agentId,
      kind: request.kind,
      resource: request.resource,
      payload: request.payload ?? {},
      ...(request.meta ? { meta: request.meta } : {}),
    };

    // Gate 1 - capability. Not negotiable by policy.
    const capability = checkCapability(manifest, syscall);
    if (!capability.granted) {
      return this.refuse(syscall, 'capability.denied', capability.reason);
    }

    // Gate 2 - budget.
    const budgetVerdict = meter.check(syscall);
    if (!budgetVerdict.ok) {
      return this.refuse(syscall, 'budget.exceeded', budgetVerdict.reason ?? 'budget exceeded');
    }

    // Gate 3 - policy.
    const decision = this.policy.evaluate(syscall, manifest, {
      dryRun: this.dryRun,
      usage: meter.snapshot(),
      capability: capability.capability ?? null,
    });

    if (decision.effect === 'deny') {
      meter.record(syscall);
      const record = this.ledger.append({
        ts: this.clock.now().toISOString(),
        runId: syscall.runId,
        actor: agentId,
        event: 'syscall',
        kind: syscall.kind,
        resource: syscall.resource,
        syscallId: syscall.id,
        decision: {
          effect: decision.effect,
          riskScore: decision.riskScore,
          reasons: decision.reasons,
          usedDefault: decision.usedDefault,
        },
        outcome: 'skipped',
        error: describeDenial(decision.reasons),
      });
      return {
        ok: false,
        decision,
        receipt: toReceipt(syscall, record.seq, record.hash, decision.effect),
        error: describeDenial(decision.reasons),
      };
    }

    // Gate 4 - obligations, applied to the payload before anyone sees it.
    const { payload, findings } = applyObligationsToPayload(syscall.payload, decision.obligations);
    syscall = { ...syscall, payload };

    // Gate 5 - preconditions the obligations impose before anything happens.
    // A `cite` obligation that cannot be satisfied stops the action here rather
    // than putting an unsourced document in front of a reviewer.
    const unsatisfied = this.checkObligationPreconditions(syscall, decision.obligations);
    if (unsatisfied) {
      meter.record(syscall);
      const record = this.ledger.append({
        ts: this.clock.now().toISOString(),
        runId: syscall.runId,
        actor: agentId,
        event: 'obligation.unsatisfied',
        kind: syscall.kind,
        resource: syscall.resource,
        syscallId: syscall.id,
        decision: {
          effect: decision.effect,
          riskScore: decision.riskScore,
          reasons: decision.reasons,
          usedDefault: decision.usedDefault,
        },
        obligations: decision.obligations,
        redactions: findings,
        outcome: 'skipped',
        error: unsatisfied,
      });
      return {
        ok: false,
        decision,
        receipt: toReceipt(syscall, record.seq, record.hash, 'deny'),
        error: unsatisfied,
      };
    }

    // Gate 6 - human approval.
    let approvalMeta: SyscallApprovalMeta | undefined;
    if (decision.effect === 'require_approval') {
      const spec = decision.approval ?? {
        role: manifest.humanOversight.roles[0] ?? 'reviewer',
        quorum: 1,
        expiresInMs: 3_600_000,
        reasonCodes: ['approved', 'rejected'],
      };
      const input = {
        runId: syscall.runId,
        agentId,
        syscallId: syscall.id,
        kind: syscall.kind,
        resource: syscall.resource,
        summary: `${agentId} requests ${syscall.kind} on ${syscall.resource}`,
        preview: previewOf(syscall.payload),
        requiredRole: spec.role,
        quorum: spec.quorum,
        expiresInMs: spec.expiresInMs,
        reasonCodes: spec.reasonCodes,
      };
      const outcome = await this.gateway.request(input, this.approvals);
      this.ledger.append({
        ts: this.clock.now().toISOString(),
        runId: syscall.runId,
        actor: agentId,
        event: 'approval.requested',
        kind: syscall.kind,
        resource: syscall.resource,
        syscallId: syscall.id,
        approval: {
          requestId: outcome.request.id,
          status: 'pending',
          approvers: [],
          reasonCodes: spec.reasonCodes,
        },
        outcome: 'ok',
      });
      this.ledger.append({
        ts: this.clock.now().toISOString(),
        runId: syscall.runId,
        actor: agentId,
        event: 'approval.resolved',
        kind: syscall.kind,
        resource: syscall.resource,
        syscallId: syscall.id,
        approval: {
          requestId: outcome.request.id,
          status: outcome.status,
          approvers: outcome.request.votes.map((v) => v.approver),
          reasonCodes: outcome.request.votes.map((v) => v.reasonCode),
        },
        outcome: 'ok',
      });
      approvalMeta = {
        requestId: outcome.request.id,
        status: outcome.status,
        approvers: outcome.request.votes.map((v) => v.approver),
        reasonCodes: outcome.request.votes.map((v) => v.reasonCode),
      };
      if (outcome.status !== 'approved') {
        meter.record(syscall);
        const record = this.ledger.append({
          ts: this.clock.now().toISOString(),
          runId: syscall.runId,
          actor: agentId,
          event: 'syscall',
          kind: syscall.kind,
          resource: syscall.resource,
          syscallId: syscall.id,
          decision: {
            effect: decision.effect,
            riskScore: decision.riskScore,
            reasons: decision.reasons,
            usedDefault: decision.usedDefault,
          },
          obligations: decision.obligations,
          redactions: findings,
          approval: approvalMeta,
          outcome: 'skipped',
          error: `human approval ${outcome.status}`,
        });
        return {
          ok: false,
          decision,
          receipt: toReceipt(syscall, record.seq, record.hash, decision.effect),
          error: `human approval ${outcome.status}`,
        };
      }
    }

    // Gate 7 - execution.
    meter.record(syscall);
    let value: unknown;
    let outcome: 'ok' | 'error' | 'skipped' = 'ok';
    let error: string | undefined;

    if (this.dryRun) {
      outcome = 'skipped';
      value = undefined;
    } else {
      const handler = this.resolveHandler(syscall);
      if (!handler) {
        outcome = 'error';
        error = `no handler registered for ${syscall.kind} on "${syscall.resource}"`;
      } else {
        try {
          value = await handler.execute(syscall, this.handlerContext(agentId));
        } catch (thrown) {
          outcome = 'error';
          error = thrown instanceof Error ? thrown.message : String(thrown);
        }
      }
    }

    const record = this.ledger.append({
      ts: this.clock.now().toISOString(),
      runId: syscall.runId,
      actor: agentId,
      event: 'syscall',
      kind: syscall.kind,
      resource: syscall.resource,
      syscallId: syscall.id,
      decision: {
        effect: decision.effect,
        riskScore: decision.riskScore,
        reasons: decision.reasons,
        usedDefault: decision.usedDefault,
      },
      obligations: decision.obligations,
      redactions: findings,
      ...(approvalMeta ? { approval: approvalMeta } : {}),
      outcome,
      ...(error ? { error } : {}),
      meta: { simulated: this.dryRun },
    });

    const result: SyscallResult<T> = {
      ok: outcome !== 'error',
      decision,
      receipt: toReceipt(syscall, record.seq, record.hash, decision.effect),
    };
    if (outcome === 'ok') result.value = value as T;
    if (error) result.error = error;
    if (this.dryRun) result.simulated = true;
    return result;
  }

  /**
   * Enforces the obligations that must hold *before* an action runs.
   *
   * `cite` requires a non-empty source list on the payload, so nothing is ever
   * published without saying where it came from. `rate_limit` caps how often an
   * agent may repeat the same action in a sliding window. Obligations that only
   * describe how a record is kept (`log`, `retain`) are recorded in the ledger
   * and surfaced in transparency reports; see docs/audit-and-transparency.md.
   */
  private checkObligationPreconditions(syscall: Syscall, obligations: Obligation[]): string | null {
    for (const obligation of obligations) {
      if (obligation.type === 'cite') {
        const fields = obligation.fields ?? ['payload.sources'];
        for (const field of fields) {
          const path = field.startsWith('payload.') ? field.slice('payload.'.length) : field;
          const value = (syscall.payload as Record<string, unknown>)[path];
          const empty =
            value === undefined ||
            value === null ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'string' && value.trim() === '');
          if (empty) {
            return `obligation "cite" is not satisfied: ${field} is empty, so this output has no traceable source`;
          }
        }
      }
      if (obligation.type === 'rate_limit') {
        const max = typeof obligation.max === 'number' ? obligation.max : 60;
        const windowMs = typeof obligation.windowMs === 'number' ? obligation.windowMs : 3_600_000;
        const key = `${syscall.agentId}|${syscall.kind}|${syscall.resource}`;
        const now = this.clock.now().getTime();
        const recent = (this.rateWindows.get(key) ?? []).filter((t) => now - t < windowMs);
        if (recent.length >= max) {
          return `obligation "rate_limit" is not satisfied: ${max} ${syscall.kind} actions on "${syscall.resource}" already occurred in the last ${windowMs}ms`;
        }
        recent.push(now);
        this.rateWindows.set(key, recent);
      }
    }
    return null;
  }

  private handlerContext(agentId: string): HandlerContext {
    return {
      model: this.model,
      blackboard: this.blackboard,
      workspace: this.workspace,
      logger: {
        info: (m, meta) => this.logger.info(`${agentId}: ${m}`, meta),
        warn: (m, meta) => this.logger.warn(`${agentId}: ${m}`, meta),
        error: (m, meta) => this.logger.error(`${agentId}: ${m}`, meta),
        debug: (m, meta) => this.logger.debug(`${agentId}: ${m}`, meta),
      },
    };
  }

  private resolveHandler(syscall: Syscall): SyscallHandler | undefined {
    return this.handlers
      .filter((h) => h.kind === syscall.kind && globMatch(h.resource, syscall.resource))
      .sort((a, b) => globSpecificity(b.resource) - globSpecificity(a.resource))[0];
  }

  private refuse<T>(
    syscall: Syscall,
    event: 'capability.denied' | 'budget.exceeded',
    reason: string,
  ): SyscallResult<T> {
    const record = this.ledger.append({
      ts: this.clock.now().toISOString(),
      runId: syscall.runId,
      actor: syscall.agentId,
      event,
      kind: syscall.kind,
      resource: syscall.resource,
      syscallId: syscall.id,
      outcome: 'skipped',
      error: reason,
    });
    return {
      ok: false,
      error: reason,
      decision: {
        effect: 'deny',
        reasons: [
          {
            ruleId: event,
            packId: 'kernel',
            effect: 'deny',
            description: reason,
            controls: event === 'capability.denied' ? ['CIVICOS-CAP-01'] : ['CIVICOS-BUDGET-01'],
          },
        ],
        obligations: [],
        riskScore: 60,
        usedDefault: false,
      },
      receipt: toReceipt(syscall, record.seq, record.hash, 'deny'),
    };
  }
}

interface SyscallApprovalMeta {
  requestId: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  approvers: string[];
  reasonCodes: string[];
}

function toReceipt(
  syscall: Syscall,
  seq: number,
  hash: string,
  effect: SyscallResult['decision']['effect'],
): SyscallReceipt {
  return { syscallId: syscall.id, runId: syscall.runId, ledgerSeq: seq, effect, recordHash: hash };
}

function describeDenial(reasons: Array<{ effect: string; description: string; ruleId: string }>): string {
  const denial = reasons.find((r) => r.effect === 'deny');
  return denial ? `${denial.ruleId}: ${denial.description}` : 'denied by policy';
}

function previewOf(payload: Record<string, unknown>, limit = 800): string {
  const text = payload.text ?? payload.prompt ?? payload.body ?? payload.content;
  const rendered = typeof text === 'string' ? text : JSON.stringify(payload);
  return rendered.length > limit ? `${rendered.slice(0, limit)}\n... [truncated]` : rendered;
}
