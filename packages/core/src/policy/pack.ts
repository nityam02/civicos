import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parseYamlObject } from '../util/yaml.js';
import type { Condition } from './conditions.js';
import { unknownOperators } from './conditions.js';
import type { Effect, Obligation, SyscallKind } from '../types.js';
import { SYSCALL_KINDS } from '../types.js';

/** A citation to the external rule a policy rule implements. */
export interface Authority {
  framework: string;
  reference: string;
  requirement: string;
}

export interface ApprovalSpec {
  role: string;
  quorum: number;
  expiresInMs: number;
  reasonCodes: string[];
}

export interface PolicyRule {
  id: string;
  description: string;
  when?: Condition;
  effect: Effect;
  /** Contribution to the decision risk score, 0-100. */
  risk?: number;
  obligations?: Obligation[];
  approval?: ApprovalSpec;
  /** Control identifiers this rule implements, e.g. `EU-AI-ACT-ART-14`. */
  controls?: string[];
}

export interface PolicyPack {
  id: string;
  version: string;
  title: string;
  description: string;
  authority: Authority[];
  defaults: { effect: Effect; risk?: number };
  rules: PolicyRule[];
  /** Path the pack was loaded from, when it came from disk. */
  source?: string;
}

export interface LintIssue {
  level: 'error' | 'warning';
  message: string;
  ruleId?: string;
}

const VALID_EFFECTS: Effect[] = ['allow', 'deny', 'require_approval', 'transform'];
const VALID_OBLIGATIONS = new Set([
  'redact', 'coarsen_geo', 'label', 'cite', 'log', 'rate_limit', 'retain',
]);

export function parsePolicyPack(source: string, path?: string): PolicyPack {
  const doc = parseYamlObject(source);
  const pack: PolicyPack = {
    id: requireString(doc, 'id'),
    version: requireString(doc, 'version'),
    title: requireString(doc, 'title'),
    description: typeof doc.description === 'string' ? doc.description : '',
    authority: normaliseAuthority(doc.authority),
    defaults: normaliseDefaults(doc.defaults),
    rules: normaliseRules(doc.rules),
  };
  if (path) pack.source = path;
  const errors = lintPolicyPack(pack).filter((i) => i.level === 'error');
  if (errors.length > 0) {
    throw new Error(
      `policy pack "${pack.id}" is invalid:\n${errors.map((e) => `  - ${e.message}`).join('\n')}`,
    );
  }
  return pack;
}

export function loadPolicyPack(path: string): PolicyPack {
  return parsePolicyPack(readFileSync(path, 'utf8'), path);
}

/** Loads every `*.yaml` / `*.yml` policy pack in a directory (non-recursive). */
export function loadPolicyDirectory(dir: string): PolicyPack[] {
  const packs: PolicyPack[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    const ext = extname(entry);
    if (ext !== '.yaml' && ext !== '.yml') continue;
    packs.push(loadPolicyPack(full));
  }
  return packs;
}

export function lintPolicyPack(pack: PolicyPack): LintIssue[] {
  const issues: LintIssue[] = [];
  const push = (level: LintIssue['level'], message: string, ruleId?: string) =>
    issues.push(ruleId ? { level, message, ruleId } : { level, message });

  if (!/^[a-z0-9][a-z0-9-]*$/.test(pack.id)) {
    push('error', `pack id "${pack.id}" must be lowercase kebab-case`);
  }
  if (!VALID_EFFECTS.includes(pack.defaults.effect)) {
    push('error', `defaults.effect "${pack.defaults.effect}" is not a valid effect`);
  }
  if (pack.defaults.effect === 'allow') {
    push('warning', 'defaults.effect is "allow": this pack fails open. Prefer "deny".');
  }
  if (pack.authority.length === 0) {
    push('warning', 'pack declares no authority; transparency reports will not cite a source');
  }
  if (pack.rules.length === 0) push('warning', 'pack contains no rules');

  const seen = new Set<string>();
  for (const rule of pack.rules) {
    if (seen.has(rule.id)) push('error', `duplicate rule id "${rule.id}"`, rule.id);
    seen.add(rule.id);
    if (!VALID_EFFECTS.includes(rule.effect)) {
      push('error', `rule "${rule.id}" has invalid effect "${rule.effect}"`, rule.id);
    }
    if (!rule.description || rule.description.length < 8) {
      push('warning', `rule "${rule.id}" has no meaningful description`, rule.id);
    }
    if (rule.effect === 'require_approval' && !rule.approval) {
      push('error', `rule "${rule.id}" requires approval but declares no approval block`, rule.id);
    }
    if (rule.approval) {
      if (rule.approval.quorum < 1) {
        push('error', `rule "${rule.id}" approval.quorum must be >= 1`, rule.id);
      }
      if (rule.approval.expiresInMs <= 0) {
        push('error', `rule "${rule.id}" approval.expiresInMs must be > 0`, rule.id);
      }
      if (rule.approval.reasonCodes.length === 0) {
        push('warning', `rule "${rule.id}" declares no approval reason codes`, rule.id);
      }
    }
    for (const obligation of rule.obligations ?? []) {
      if (!VALID_OBLIGATIONS.has(obligation.type)) {
        push('error', `rule "${rule.id}" has unknown obligation "${obligation.type}"`, rule.id);
      }
    }
    const kind = (rule.when as Record<string, unknown> | undefined)?.kind;
    if (typeof kind === 'string' && !SYSCALL_KINDS.includes(kind as SyscallKind)) {
      push('error', `rule "${rule.id}" matches unknown syscall kind "${kind}"`, rule.id);
    }
    for (const op of unknownOperators(rule.when)) {
      push('error', `rule "${rule.id}" uses unknown operator "${op}"`, rule.id);
    }
    if (rule.risk !== undefined && (rule.risk < 0 || rule.risk > 100)) {
      push('error', `rule "${rule.id}" risk must be between 0 and 100`, rule.id);
    }
    if (rule.effect !== 'allow' && (rule.controls ?? []).length === 0) {
      push('warning', `rule "${rule.id}" cites no control identifier`, rule.id);
    }
  }
  return issues;
}

function requireString(doc: Record<string, unknown>, key: string): string {
  const value = doc[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`policy pack is missing required string field "${key}"`);
  }
  return value;
}

function normaliseAuthority(value: unknown): Authority[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    return [
      {
        framework: String(e.framework ?? 'unspecified'),
        reference: String(e.reference ?? ''),
        requirement: String(e.requirement ?? ''),
      },
    ];
  });
}

function normaliseDefaults(value: unknown): { effect: Effect; risk?: number } {
  if (!value || typeof value !== 'object') return { effect: 'deny' };
  const v = value as Record<string, unknown>;
  const out: { effect: Effect; risk?: number } = {
    effect: (typeof v.effect === 'string' ? v.effect : 'deny') as Effect,
  };
  if (typeof v.risk === 'number') out.risk = v.risk;
  return out;
}

function normaliseRules(value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`rule at index ${index} is not a mapping`);
    }
    const e = entry as Record<string, unknown>;
    const rule: PolicyRule = {
      id: String(e.id ?? `rule-${index}`),
      description: String(e.description ?? ''),
      effect: (typeof e.effect === 'string' ? e.effect : 'deny') as Effect,
    };
    if (e.when && typeof e.when === 'object') rule.when = e.when as Condition;
    if (typeof e.risk === 'number') rule.risk = e.risk;
    if (Array.isArray(e.obligations)) rule.obligations = e.obligations as Obligation[];
    if (Array.isArray(e.controls)) rule.controls = e.controls.map(String);
    if (e.approval && typeof e.approval === 'object') {
      const a = e.approval as Record<string, unknown>;
      rule.approval = {
        role: String(a.role ?? 'reviewer'),
        quorum: typeof a.quorum === 'number' ? a.quorum : 1,
        expiresInMs: typeof a.expiresInMs === 'number' ? a.expiresInMs : 3_600_000,
        reasonCodes: Array.isArray(a.reasonCodes) ? a.reasonCodes.map(String) : [],
      };
    }
    return rule;
  });
}
