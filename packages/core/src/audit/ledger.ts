import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditRecord } from '../types.js';
import { canonicalJSON, sha256 } from '../util/canonical.js';

export const GENESIS = 'GENESIS';

export type AuditInput = Omit<AuditRecord, 'seq' | 'prevHash' | 'hash'>;

export interface VerificationResult {
  ok: boolean;
  length: number;
  /** Sequence number of the first record that failed verification. */
  brokenAt?: number;
  reason?: string;
  headHash: string;
}

/**
 * Append-only, hash-chained audit log.
 *
 * Each record commits to the hash of the record before it, so removing,
 * reordering or editing any entry invalidates every hash after it. That does
 * not make the log unforgeable by whoever controls the file - it makes
 * tampering *detectable*, which is the property a public-interest deployment
 * actually needs: the operator can publish the head hash, and anyone holding a
 * copy of the log can prove it matches.
 */
export abstract class AuditLedger {
  protected head = GENESIS;
  protected count = 0;

  abstract records(): AuditRecord[];
  protected abstract persist(record: AuditRecord): void;

  get headHash(): string {
    return this.head;
  }

  get length(): number {
    return this.count;
  }

  append(input: AuditInput): AuditRecord {
    const base = { ...input, seq: this.count, prevHash: this.head };
    const hash = sha256(canonicalJSON(base));
    const record: AuditRecord = { ...base, hash };
    this.persist(record);
    this.head = hash;
    this.count += 1;
    return record;
  }

  verify(): VerificationResult {
    return verifyChain(this.records());
  }

  /** Records for one run, in order. */
  byRun(runId: string): AuditRecord[] {
    return this.records().filter((r) => r.runId === runId);
  }
}

export function verifyChain(records: AuditRecord[]): VerificationResult {
  let prev = GENESIS;
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.seq !== i) {
      return { ok: false, length: records.length, brokenAt: i, reason: `sequence gap: expected ${i}, found ${record.seq}`, headHash: prev };
    }
    if (record.prevHash !== prev) {
      return { ok: false, length: records.length, brokenAt: i, reason: 'previous-hash mismatch: a record was removed, reordered or inserted', headHash: prev };
    }
    const { hash, ...rest } = record;
    const expected = sha256(canonicalJSON(rest));
    if (expected !== hash) {
      return { ok: false, length: records.length, brokenAt: i, reason: 'content hash mismatch: this record was modified after it was written', headHash: prev };
    }
    prev = hash;
  }
  return { ok: true, length: records.length, headHash: prev };
}

export class MemoryLedger extends AuditLedger {
  private readonly store: AuditRecord[] = [];

  records(): AuditRecord[] {
    return [...this.store];
  }

  protected persist(record: AuditRecord): void {
    this.store.push(record);
  }
}

/** JSON Lines ledger. One record per line, appended and never rewritten. */
export class FileLedger extends AuditLedger {
  constructor(private readonly path: string) {
    super();
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, '', 'utf8');
      return;
    }
    const existing = this.records();
    this.count = existing.length;
    this.head = existing.length > 0 ? existing[existing.length - 1]!.hash : GENESIS;
  }

  records(): AuditRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line, index) => {
        try {
          return JSON.parse(line) as AuditRecord;
        } catch (error) {
          throw new Error(`audit ledger line ${index + 1} is not valid JSON: ${String(error)}`);
        }
      });
  }

  protected persist(record: AuditRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
