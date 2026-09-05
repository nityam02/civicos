import type { Budget, BudgetUsage, Syscall } from '../types.js';

export interface BudgetVerdict {
  ok: boolean;
  reason?: string;
  limit?: string;
}

/**
 * Resource accounting for a run.
 *
 * An agent that loops forever is not only expensive, it is an availability
 * risk for whoever depends on it. The meter is checked before every syscall
 * and, unlike a timeout, it is deterministic in every dimension except wall
 * clock - so a run that exceeds its budget does so reproducibly.
 */
export class BudgetMeter {
  private readonly startedAt = Date.now();
  private readonly usage: BudgetUsage = {
    syscalls: 0,
    modelCalls: 0,
    modelInputChars: 0,
    publishes: 0,
    wallMs: 0,
  };

  constructor(private readonly budget: Budget = {}) {}

  snapshot(): BudgetUsage {
    return { ...this.usage, wallMs: Date.now() - this.startedAt };
  }

  check(syscall: Syscall): BudgetVerdict {
    const b = this.budget;
    if (b.maxSyscalls !== undefined && this.usage.syscalls >= b.maxSyscalls) {
      return { ok: false, limit: 'maxSyscalls', reason: `run exceeded ${b.maxSyscalls} mediated actions` };
    }
    if (b.maxWallMs !== undefined && Date.now() - this.startedAt > b.maxWallMs) {
      return { ok: false, limit: 'maxWallMs', reason: `run exceeded ${b.maxWallMs}ms of wall-clock time` };
    }
    if (syscall.kind === 'model.complete') {
      if (b.maxModelCalls !== undefined && this.usage.modelCalls >= b.maxModelCalls) {
        return { ok: false, limit: 'maxModelCalls', reason: `run exceeded ${b.maxModelCalls} model calls` };
      }
      const chars = promptLength(syscall);
      if (
        b.maxModelInputChars !== undefined &&
        this.usage.modelInputChars + chars > b.maxModelInputChars
      ) {
        return {
          ok: false,
          limit: 'maxModelInputChars',
          reason: `run exceeded ${b.maxModelInputChars} characters of model input`,
        };
      }
    }
    if (syscall.kind === 'publish' && b.maxPublishes !== undefined && this.usage.publishes >= b.maxPublishes) {
      return { ok: false, limit: 'maxPublishes', reason: `run exceeded ${b.maxPublishes} publications` };
    }
    return { ok: true };
  }

  record(syscall: Syscall): void {
    this.usage.syscalls += 1;
    if (syscall.kind === 'model.complete') {
      this.usage.modelCalls += 1;
      this.usage.modelInputChars += promptLength(syscall);
    }
    if (syscall.kind === 'publish') this.usage.publishes += 1;
  }
}

function promptLength(syscall: Syscall): number {
  const prompt = syscall.payload?.prompt;
  const system = syscall.payload?.system;
  return (typeof prompt === 'string' ? prompt.length : 0) + (typeof system === 'string' ? system.length : 0);
}

export const DEFAULT_BUDGET: Budget = {
  maxSyscalls: 200,
  maxModelCalls: 40,
  maxModelInputChars: 400_000,
  maxWallMs: 120_000,
  maxPublishes: 10,
};
