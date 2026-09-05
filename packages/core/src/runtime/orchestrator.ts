import type { Agent, AgentContext, AgentResult, Logger, ModelRequest, Syscall, SyscallResult } from '../types.js';
import type { Kernel } from './kernel.js';
import { newId } from '../util/canonical.js';
import { assertManifestValid } from './capabilities.js';

export interface Task {
  id: string;
  /** Id of a registered agent. */
  agent: string;
  /** Static input, or a function of the results so far. */
  input?: unknown | ((results: Map<string, AgentResult>) => unknown);
  dependsOn?: string[];
  /** Skip this task unless the predicate holds. */
  when?: (results: Map<string, AgentResult>) => boolean;
}

export interface Plan {
  id: string;
  description: string;
  tasks: Task[];
  /** `halt` (default) stops the run on the first failure; `continue` carries on. */
  onFailure?: 'halt' | 'continue';
  /** Maximum tasks executed at once. Default 1, for reproducible ledgers. */
  concurrency?: number;
}

export interface TaskOutcome {
  taskId: string;
  agentId: string;
  status: 'ok' | 'error' | 'skipped';
  result?: AgentResult;
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export interface RunReport {
  runId: string;
  planId: string;
  status: 'ok' | 'partial' | 'failed';
  outcomes: TaskOutcome[];
  ledgerHead: string;
  ledgerLength: number;
}

/**
 * Multi-agent orchestration.
 *
 * The supervisor is deliberately dull: a dependency graph, a stable topological
 * order, an explicit concurrency limit, and a shared blackboard as the only
 * channel between agents. Agents cannot call each other, discover each other,
 * or pass each other capabilities - so the blast radius of one misbehaving
 * agent is the tasks that declared a dependency on it, and nothing else.
 * At concurrency 1 the resulting audit ledger is byte-for-byte reproducible.
 */
export class Supervisor {
  private readonly agents = new Map<string, Agent>();

  constructor(
    private readonly kernel: Kernel,
    private readonly logger: Logger,
  ) {}

  register(agent: Agent): this {
    assertManifestValid(agent.manifest);
    this.kernel.registerAgent(agent.manifest);
    this.agents.set(agent.manifest.id, agent);
    return this;
  }

  get registered(): Agent[] {
    return [...this.agents.values()];
  }

  agent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /** Runs a single agent. Sugar over a one-task plan. */
  async runAgent(agentId: string, input: unknown, runId = newId('run')): Promise<RunReport> {
    return this.run(
      { id: `single:${agentId}`, description: `Single-agent run of ${agentId}`, tasks: [{ id: agentId, agent: agentId, input }] },
      runId,
    );
  }

  async run(plan: Plan, runId = newId('run')): Promise<RunReport> {
    const order = topoSort(plan.tasks);
    const concurrency = Math.max(1, plan.concurrency ?? 1);
    const onFailure = plan.onFailure ?? 'halt';
    const results = new Map<string, AgentResult>();
    const outcomes: TaskOutcome[] = [];
    let halted = false;

    this.kernel.startRun(runId, { planId: plan.id, description: plan.description, tasks: order.map((t) => t.id) });

    for (const wave of waves(order, concurrency)) {
      if (halted) break;
      const settled = await Promise.all(
        wave.map(async (task): Promise<TaskOutcome> => {
          const startedAt = new Date().toISOString();
          if (task.when && !task.when(results)) {
            return { taskId: task.id, agentId: task.agent, status: 'skipped', startedAt, finishedAt: new Date().toISOString() };
          }
          const agent = this.agents.get(task.agent);
          if (!agent) {
            return {
              taskId: task.id,
              agentId: task.agent,
              status: 'error',
              error: `agent "${task.agent}" is not registered`,
              startedAt,
              finishedAt: new Date().toISOString(),
            };
          }
          const input = typeof task.input === 'function'
            ? (task.input as (r: Map<string, AgentResult>) => unknown)(results)
            : task.input;
          try {
            this.logger.info(`task ${task.id} -> ${task.agent}`);
            const result = await agent.run(this.contextFor(agent, runId, input));
            results.set(task.id, result);
            return { taskId: task.id, agentId: task.agent, status: 'ok', result, startedAt, finishedAt: new Date().toISOString() };
          } catch (thrown) {
            const message = thrown instanceof Error ? thrown.message : String(thrown);
            this.logger.error(`task ${task.id} failed: ${message}`);
            return { taskId: task.id, agentId: task.agent, status: 'error', error: message, startedAt, finishedAt: new Date().toISOString() };
          }
        }),
      );
      outcomes.push(...settled);
      if (onFailure === 'halt' && settled.some((o) => o.status === 'error')) halted = true;
    }

    const failed = outcomes.filter((o) => o.status === 'error').length;
    const status: RunReport['status'] = failed === 0 ? 'ok' : failed === outcomes.length ? 'failed' : 'partial';
    this.kernel.endRun(runId, { planId: plan.id, status, failed, tasks: outcomes.length });

    return {
      runId,
      planId: plan.id,
      status,
      outcomes,
      ledgerHead: this.kernel.ledger.headHash,
      ledgerLength: this.kernel.ledger.length,
    };
  }

  private contextFor(agent: Agent, runId: string, input: unknown): AgentContext {
    const kernel = this.kernel;
    const agentId = agent.manifest.id;
    const logger = this.logger;
    return {
      manifest: agent.manifest,
      runId,
      input,
      blackboard: kernel.blackboard,
      logger,
      async syscall<T>(req: Omit<Syscall, 'id' | 'ts' | 'runId' | 'agentId'>): Promise<SyscallResult<T>> {
        return kernel.syscall<T>(agentId, { ...req, runId });
      },
      async complete(req: ModelRequest, resource = 'model/default'): Promise<string> {
        const result = await kernel.syscall<{ text: string }>(agentId, {
          runId,
          kind: 'model.complete',
          resource,
          payload: { ...req },
        });
        if (!result.ok || !result.value) {
          throw new Error(result.error ?? 'model call was not permitted');
        }
        return result.value.text;
      },
      async note(message: string, meta: Record<string, unknown> = {}): Promise<void> {
        kernel.note(runId, agentId, message, meta);
      },
    };
  }
}

/** Stable topological sort: ties break on declaration order, so runs repeat. */
export function topoSort(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    for (const dep of task.dependsOn ?? []) {
      if (!byId.has(dep)) throw new Error(`task "${task.id}" depends on unknown task "${dep}"`);
    }
  }
  const visited = new Map<string, 'visiting' | 'done'>();
  const out: Task[] = [];
  const visit = (task: Task, trail: string[]): void => {
    const state = visited.get(task.id);
    if (state === 'done') return;
    if (state === 'visiting') {
      throw new Error(`dependency cycle: ${[...trail, task.id].join(' -> ')}`);
    }
    visited.set(task.id, 'visiting');
    for (const dep of task.dependsOn ?? []) visit(byId.get(dep)!, [...trail, task.id]);
    visited.set(task.id, 'done');
    out.push(task);
  };
  for (const task of tasks) visit(task, []);
  return out;
}

/** Groups a topologically sorted list into dependency-safe execution waves. */
function waves(order: Task[], concurrency: number): Task[][] {
  if (concurrency === 1) return order.map((t) => [t]);
  const done = new Set<string>();
  const remaining = [...order];
  const out: Task[][] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((t) => (t.dependsOn ?? []).every((d) => done.has(d))).slice(0, concurrency);
    if (ready.length === 0) throw new Error('unable to schedule: unresolved dependencies');
    for (const task of ready) {
      done.add(task.id);
      remaining.splice(remaining.indexOf(task), 1);
    }
    out.push(ready);
  }
  return out;
}
