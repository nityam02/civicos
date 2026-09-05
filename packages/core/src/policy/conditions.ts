import { globMatch } from '../util/glob.js';

/**
 * The condition language used by `when:` blocks in policy rules.
 *
 * It is deliberately not a programming language. There is no `eval`, no
 * arbitrary code, no user-supplied function calls: a condition is data, it
 * terminates, and it can be diffed and reviewed by a non-engineer. Every
 * operator below is total - an operator applied to the wrong type is `false`,
 * never an exception, so a malformed rule can never crash the kernel mid-run
 * and fail open.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | FieldCondition;

export type FieldCondition = Record<string, unknown>;

export interface Operators {
  eq?: unknown;
  ne?: unknown;
  in?: unknown[];
  nin?: unknown[];
  glob?: string | string[];
  regex?: string;
  contains?: string;
  icontains?: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  exists?: boolean;
  length_gt?: number;
  length_lt?: number;
}

const MAX_REGEX_LENGTH = 200;

export function getPath(source: unknown, path: string): unknown {
  if (path === '') return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (current instanceof Map) {
      current = current.get(segment);
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      current = Number.isNaN(index) ? undefined : current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function evaluateCondition(condition: Condition | undefined, subject: unknown): boolean {
  if (condition === undefined || condition === null) return true;
  if (typeof condition !== 'object') return false;

  if ('all' in condition && Array.isArray((condition as { all: Condition[] }).all)) {
    return (condition as { all: Condition[] }).all.every((c) => evaluateCondition(c, subject));
  }
  if ('any' in condition && Array.isArray((condition as { any: Condition[] }).any)) {
    return (condition as { any: Condition[] }).any.some((c) => evaluateCondition(c, subject));
  }
  if ('not' in condition) {
    return !evaluateCondition((condition as { not: Condition }).not, subject);
  }

  for (const [path, expected] of Object.entries(condition as FieldCondition)) {
    const actual = getPath(subject, path);
    if (!matchField(actual, expected)) return false;
  }
  return true;
}

function matchField(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (Array.isArray(expected)) return expected.some((e) => looseEqual(actual, e));
  if (typeof expected === 'object') return matchOperators(actual, expected as Operators);
  return looseEqual(actual, expected);
}

function matchOperators(actual: unknown, ops: Operators): boolean {
  for (const [op, arg] of Object.entries(ops)) {
    if (!applyOperator(op, actual, arg)) return false;
  }
  return true;
}

function applyOperator(op: string, actual: unknown, arg: unknown): boolean {
  switch (op) {
    case 'eq':
      return looseEqual(actual, arg);
    case 'ne':
      return !looseEqual(actual, arg);
    case 'in':
      return Array.isArray(arg) && arg.some((a) => looseEqual(actual, a));
    case 'nin':
      return Array.isArray(arg) && !arg.some((a) => looseEqual(actual, a));
    case 'glob': {
      if (typeof actual !== 'string') return false;
      const patterns = Array.isArray(arg) ? arg : [arg];
      return patterns.some((p) => typeof p === 'string' && globMatch(p, actual));
    }
    case 'regex': {
      if (typeof actual !== 'string' || typeof arg !== 'string') return false;
      if (arg.length > MAX_REGEX_LENGTH) return false;
      try {
        return new RegExp(arg, 'i').test(actual);
      } catch {
        return false;
      }
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => looseEqual(a, arg));
      return typeof actual === 'string' && typeof arg === 'string' && actual.includes(arg);
    case 'icontains':
      return (
        typeof actual === 'string' &&
        typeof arg === 'string' &&
        actual.toLowerCase().includes(arg.toLowerCase())
      );
    case 'gt':
      return typeof actual === 'number' && typeof arg === 'number' && actual > arg;
    case 'gte':
      return typeof actual === 'number' && typeof arg === 'number' && actual >= arg;
    case 'lt':
      return typeof actual === 'number' && typeof arg === 'number' && actual < arg;
    case 'lte':
      return typeof actual === 'number' && typeof arg === 'number' && actual <= arg;
    case 'exists':
      return arg === false ? actual === undefined || actual === null : actual !== undefined && actual !== null;
    case 'length_gt':
      return lengthOf(actual) > Number(arg);
    case 'length_lt':
      return lengthOf(actual) < Number(arg);
    default:
      // Unknown operators never silently pass: an unreviewed rule must not allow.
      return false;
  }
}

function lengthOf(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return -1;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);
  return false;
}

/** Reports operator names a rule uses that the engine does not implement. */
export function unknownOperators(condition: unknown, found = new Set<string>()): Set<string> {
  const known = new Set([
    'eq', 'ne', 'in', 'nin', 'glob', 'regex', 'contains', 'icontains',
    'gt', 'gte', 'lt', 'lte', 'exists', 'length_gt', 'length_lt',
  ]);
  if (!condition || typeof condition !== 'object') return found;
  if (Array.isArray(condition)) {
    for (const item of condition) unknownOperators(item, found);
    return found;
  }
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (key === 'all' || key === 'any' || key === 'not') {
      unknownOperators(value, found);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const op of Object.keys(value as Record<string, unknown>)) {
        if (!known.has(op)) found.add(op);
      }
    }
  }
  return found;
}
