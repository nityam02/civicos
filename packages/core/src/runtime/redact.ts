import type { Obligation, RedactionFinding } from '../types.js';
import { commitment } from '../util/canonical.js';

/**
 * Content minimisation.
 *
 * CivicOS redacts *before* text reaches a model, a log line, an approval queue
 * or a published output. Detected values are replaced with a stable
 * pseudonym - `[REDACTED:email#5f2a...]` - so a reviewer can still see that the
 * same person appears twice in a document without ever seeing who they are.
 * The commitment is a salted hash: it proves what was removed if a value is
 * later presented, and reveals nothing on its own.
 *
 * These detectors are pattern-based. They are a safety net, not a guarantee -
 * see `docs/threat-model.md`.
 */
export interface Detector {
  id: string;
  description: string;
  pattern: RegExp;
  /** Optional second check; return false to reject a candidate match. */
  validate?(match: string): boolean;
}

export const DETECTORS: Detector[] = [
  {
    id: 'email',
    description: 'Email addresses',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    id: 'phone',
    description: 'International and national phone numbers',
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g,
    validate: (m) => (m.replace(/\D/g, '').length >= 9 && m.replace(/\D/g, '').length <= 15),
  },
  {
    id: 'ipv4',
    description: 'IPv4 addresses',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    validate: (m) => m.split('.').every((part) => Number(part) <= 255),
  },
  {
    id: 'payment_card',
    description: 'Payment card numbers (Luhn-checked)',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => luhn(m.replace(/\D/g, '')),
  },
  {
    id: 'national_id',
    description: 'Long identifier runs that look like national ID or case numbers',
    pattern: /\b(?:[A-Z]{2,3}[-/]?)?\d{6,12}[A-Z]?\b/g,
    validate: (m) => m.replace(/\D/g, '').length >= 6,
  },
  {
    id: 'geo',
    description: 'Decimal latitude/longitude pairs',
    pattern: /[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/g,
  },
  {
    id: 'credential',
    description: 'API keys, bearer tokens and other secret-shaped strings',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/g,
  },
];

const BY_ID = new Map(DETECTORS.map((d) => [d.id, d]));

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
}

export function redactText(
  text: string,
  detectorIds: string[] = ['email', 'phone', 'payment_card', 'credential'],
  field = 'text',
): RedactionResult {
  const counts = new Map<string, { count: number; commitment: string }>();
  let output = text;

  for (const id of detectorIds) {
    const detector = BY_ID.get(id);
    if (!detector) continue;
    output = output.replace(new RegExp(detector.pattern.source, detector.pattern.flags), (match) => {
      if (detector.validate && !detector.validate(match)) return match;
      const token = commitment(match.trim());
      const key = `${id}:${token}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { count: 1, commitment: token });
      return `[REDACTED:${id}#${token.slice(0, 8)}]`;
    });
  }

  const findings: RedactionFinding[] = [...counts.entries()].map(([key, value]) => ({
    detector: key.split(':')[0]!,
    field,
    commitment: value.commitment,
    count: value.count,
  }));
  return { text: output, findings };
}

/**
 * Reduces the precision of coordinates. Publishing the exact location of a
 * displaced-persons site or a shelter can put people in danger; two decimal
 * places (~1.1 km) is enough to route aid and not enough to find an individual.
 */
export function coarsenGeo(text: string, precision = 2): { text: string; count: number } {
  let count = 0;
  const out = text.replace(/[-+]?\d{1,3}\.\d{3,}/g, (match) => {
    count += 1;
    return Number.parseFloat(match).toFixed(precision);
  });
  return { text: out, count };
}

export function coarsenCoordinate(value: number, precision = 2): number {
  return Number.parseFloat(value.toFixed(precision));
}

/** Applies `redact` and `coarsen_geo` obligations to a payload, in place of a copy. */
export function applyObligationsToPayload(
  payload: Record<string, unknown>,
  obligations: Obligation[],
): { payload: Record<string, unknown>; findings: RedactionFinding[] } {
  let next: Record<string, unknown> = structuredClone(payload);
  const findings: RedactionFinding[] = [];

  // Minimisation always runs before labelling, whatever order the rules were
  // written in, so a provenance banner is never scanned as if it were content.
  const ordered = [
    ...obligations.filter((o) => o.type === 'redact' || o.type === 'coarsen_geo'),
    ...obligations.filter((o) => o.type === 'label'),
  ];

  for (const obligation of ordered) {
    if (obligation.type === 'redact') {
      const fields = obligation.fields ?? ['payload.text', 'payload.prompt'];
      const detectors = obligation.detectors ?? ['email', 'phone', 'payment_card', 'credential'];
      for (const field of fields) {
        const path = field.startsWith('payload.') ? field.slice('payload.'.length) : field;
        const current = getIn(next, path);
        if (typeof current !== 'string') continue;
        const result = redactText(current, detectors, field);
        if (result.findings.length === 0) continue;
        next = setIn(next, path, result.text);
        findings.push(...result.findings);
      }
    } else if (obligation.type === 'coarsen_geo') {
      const fields = obligation.fields ?? ['payload.text'];
      const precision = obligation.precision ?? 2;
      for (const field of fields) {
        const path = field.startsWith('payload.') ? field.slice('payload.'.length) : field;
        const current = getIn(next, path);
        if (typeof current === 'string') {
          const result = coarsenGeo(current, precision);
          if (result.count > 0) {
            next = setIn(next, path, result.text);
            findings.push({ detector: 'geo_coarsened', field, commitment: '', count: result.count });
          }
        } else if (typeof current === 'number') {
          next = setIn(next, path, coarsenCoordinate(current, precision));
          findings.push({ detector: 'geo_coarsened', field, commitment: '', count: 1 });
        }
      }
    } else if (obligation.type === 'label' && typeof obligation.text === 'string') {
      // The provenance banner is written into the content itself, not attached
      // beside it: a reader who receives only the document still sees it.
      const fields = obligation.fields ?? ['payload.text'];
      for (const field of fields) {
        const path = field.startsWith('payload.') ? field.slice('payload.'.length) : field;
        const current = getIn(next, path);
        if (typeof current !== 'string' || current.includes(obligation.text)) continue;
        next = setIn(next, path, `> ${obligation.text}\n\n${current}`);
      }
    }
  }
  return { payload: next, findings };
}

function getIn(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setIn(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.');
  const out = { ...obj };
  let cursor: Record<string, unknown> = out;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    const child = cursor[key];
    const copy = child && typeof child === 'object' ? { ...(child as Record<string, unknown>) } : {};
    cursor[key] = copy;
    cursor = copy;
  }
  cursor[segments[segments.length - 1]!] = value;
  return out;
}

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}
