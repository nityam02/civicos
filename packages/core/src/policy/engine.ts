import type {
  AgentManifest,
  DecisionReason,
  Effect,
  Obligation,
  PolicyDecision,
  Syscall,
} from '../types.js';
import { evaluateCondition } from './conditions.js';
import type { ApprovalSpec, PolicyPack, PolicyRule } from './pack.js';

/**
 * The subject a rule is evaluated against. Rules address it by dotted path,
 * e.g. `payload.text`, `agent.riskTier`, `context.dryRun`.
 */
export interface EvaluationSubject {
  kind: string;
  resource: string;
  agentId: string;
  runId: string;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  agent: {
    id: string;
    riskTier: string;
    dataCategories: string[];
    policies: string[];
    humanOversightRequired: boolean;
  };
  context: Record<string, unknown>;
}

export interface EvaluationResult extends PolicyDecision {
  /** Populated when the winning effect is `require_approval`. */
  approval?: ApprovalSpec;
  subject: EvaluationSubject;
}

/**
 * Deterministic, order-independent policy evaluation.
 *
 * Every rule in every loaded pack is evaluated against the syscall. The
 * strongest matched effect wins, in the fixed precedence
 * `deny > require_approval > allow`, and when nothing matches the pack default
 * applies. Rule order therefore cannot change the outcome, so two reviewers
 * reading the same packs reach the same conclusion the engine does - and an
 * appended rule can only ever make the system stricter, never accidentally
 * shadow a `deny` above it.
 *
 * `transform` rules never decide the outcome; they only contribute obligations
 * to whatever effect wins.
 */
export class PolicyEngine {
  private readonly packs: PolicyPack[];

  constructor(packs: PolicyPack[] = []) {
    this.packs = [...packs];
  }

  get packIds(): string[] {
    return this.packs.map((p) => p.id);
  }

  getPack(id: string): PolicyPack | undefined {
    return this.packs.find((p) => p.id === id);
  }

  add(pack: PolicyPack): void {
    if (this.packs.some((p) => p.id === pack.id)) {
      throw new Error(`policy pack "${pack.id}" is already loaded`);
    }
    this.packs.push(pack);
  }

  /** Every rule across all packs, for documentation and coverage reporting. */
  allRules(): Array<{ pack: PolicyPack; rule: PolicyRule }> {
    return this.packs.flatMap((pack) => pack.rules.map((rule) => ({ pack, rule })));
  }

  buildSubject(
    syscall: Syscall,
    manifest: AgentManifest,
    context: Record<string, unknown> = {},
  ): EvaluationSubject {
    return {
      kind: syscall.kind,
      resource: syscall.resource,
      agentId: syscall.agentId,
      runId: syscall.runId,
      payload: syscall.payload ?? {},
      meta: syscall.meta ?? {},
      agent: {
        id: manifest.id,
        riskTier: manifest.riskTier,
        dataCategories: manifest.dataCategories,
        policies: manifest.policies,
        humanOversightRequired: manifest.humanOversight.required,
      },
      context,
    };
  }

  evaluate(
    syscall: Syscall,
    manifest: AgentManifest,
    context: Record<string, unknown> = {},
  ): EvaluationResult {
    const subject = this.buildSubject(syscall, manifest, context);
    // Only the packs the agent's manifest declares are in force for it. A pack
    // written for humanitarian work does not silently govern an unrelated
    // agent, and the manifest stays an accurate statement of what binds it.
    const active = this.packs.filter((pack) => manifest.policies.includes(pack.id));
    const reasons: DecisionReason[] = [];
    const obligations: Obligation[] = [];
    let approval: ApprovalSpec | undefined;
    let risk = 0;
    let strongest: Effect | null = null;

    for (const pack of active) {
      for (const rule of pack.rules) {
        if (!evaluateCondition(rule.when, subject)) continue;
        reasons.push({
          ruleId: rule.id,
          packId: pack.id,
          effect: rule.effect,
          description: rule.description,
          controls: rule.controls ?? [],
        });
        risk += rule.risk ?? defaultRisk(rule.effect);
        for (const obligation of rule.obligations ?? []) obligations.push(obligation);
        if (rule.effect === 'transform') continue;
        if (strongest === null || rank(rule.effect) > rank(strongest)) {
          strongest = rule.effect;
        }
        if (rule.effect === 'require_approval' && rule.approval) {
          approval = strongerApproval(approval, rule.approval);
        }
      }
    }

    const usedDefault = strongest === null;
    const effect: Effect = strongest ?? this.defaultEffect(active);
    if (usedDefault) {
      risk += this.defaultRisk(active);
      reasons.push({
        ruleId: 'default',
        packId: active[0]?.id ?? 'none',
        effect,
        description:
          effect === 'deny'
            ? 'No rule permitted this action, so the capability-safe default applied.'
            : 'No rule matched; pack default applied.',
        controls: ['CIVICOS-DEFAULT-DENY'],
      });
    }

    // A deny outcome discards obligations: nothing runs, so nothing is owed.
    const finalObligations = effect === 'deny' ? [] : dedupeObligations(obligations);

    const result: EvaluationResult = {
      effect,
      reasons,
      obligations: finalObligations,
      riskScore: Math.max(0, Math.min(100, Math.round(risk))),
      usedDefault,
      subject,
    };
    if (effect === 'require_approval' && approval) result.approval = approval;
    return result;
  }

  /** The strictest default across the packs in force wins; no packs means deny. */
  private defaultEffect(packs: PolicyPack[]): Effect {
    let effect: Effect = 'deny';
    for (const pack of packs) {
      if (rank(pack.defaults.effect) > rank(effect)) effect = pack.defaults.effect;
    }
    return packs.length === 0 ? 'deny' : effect;
  }

  private defaultRisk(packs: PolicyPack[]): number {
    return packs.reduce((max, p) => Math.max(max, p.defaults.risk ?? 10), 10);
  }
}

function rank(effect: Effect): number {
  switch (effect) {
    case 'deny':
      return 3;
    case 'require_approval':
      return 2;
    case 'allow':
      return 1;
    default:
      return 0;
  }
}

function defaultRisk(effect: Effect): number {
  switch (effect) {
    case 'deny':
      return 40;
    case 'require_approval':
      return 25;
    case 'transform':
      return 5;
    default:
      return 1;
  }
}

/** When several rules demand approval, take the most demanding of each field. */
function strongerApproval(a: ApprovalSpec | undefined, b: ApprovalSpec): ApprovalSpec {
  if (!a) return b;
  return {
    role: a.quorum >= b.quorum ? a.role : b.role,
    quorum: Math.max(a.quorum, b.quorum),
    expiresInMs: Math.min(a.expiresInMs, b.expiresInMs),
    reasonCodes: [...new Set([...a.reasonCodes, ...b.reasonCodes])],
  };
}

function dedupeObligations(obligations: Obligation[]): Obligation[] {
  const seen = new Set<string>();
  const out: Obligation[] = [];
  for (const obligation of obligations) {
    const key = JSON.stringify(obligation, Object.keys(obligation).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(obligation);
  }
  return out;
}
