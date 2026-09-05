import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic JSON serialisation: object keys sorted, no incidental
 * whitespace. Two structurally equal values always produce the same string, so
 * the same value always produces the same hash on any machine. The audit chain
 * depends on this.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return canonicalise(Object.fromEntries(value.entries()));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = canonicalise(v);
  }
  return out;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256(canonicalJSON(value));
}

/**
 * Short, salted commitment to a redacted value. Enough to prove "the same
 * person appeared in these two documents" or "this exact string was removed",
 * without retaining the value itself.
 */
export function commitment(value: string, salt = 'civicos'): string {
  return sha256(`${salt}:${value}`).slice(0, 16);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
