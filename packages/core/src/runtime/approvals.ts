import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApprovalRequest, ApprovalStatus, ApprovalVote, Clock } from '../types.js';
import { newId } from '../util/canonical.js';
import { systemClock } from '../util/clock.js';

export interface CreateApprovalInput {
  runId: string;
  agentId: string;
  syscallId: string;
  kind: ApprovalRequest['kind'];
  resource: string;
  summary: string;
  preview: string;
  requiredRole: string;
  quorum: number;
  expiresInMs: number;
  reasonCodes: string[];
}

export interface VoteInput {
  approver: string;
  role: string;
  vote: 'approve' | 'deny';
  reasonCode: string;
  note?: string;
}

/**
 * Human oversight state.
 *
 * Three properties matter and all three are enforced here rather than left to
 * the caller: a decision needs a quorum (so one compromised or hurried
 * reviewer cannot wave anything through), it needs a reason code from a fixed
 * vocabulary (so oversight is measurable rather than a rubber stamp), and it
 * expires. An expired request becomes `expired`, which the kernel treats
 * exactly like a refusal - silence is never consent.
 */
export class ApprovalStore {
  protected readonly requests = new Map<string, ApprovalRequest>();

  constructor(protected readonly clock: Clock = systemClock) {}

  create(input: CreateApprovalInput): ApprovalRequest {
    const now = this.clock.now();
    const request: ApprovalRequest = {
      id: newId('apr'),
      runId: input.runId,
      agentId: input.agentId,
      syscallId: input.syscallId,
      kind: input.kind,
      resource: input.resource,
      summary: input.summary,
      preview: input.preview,
      requiredRole: input.requiredRole,
      quorum: Math.max(1, input.quorum),
      reasonCodes: input.reasonCodes,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.expiresInMs).toISOString(),
      status: 'pending',
      votes: [],
    };
    this.requests.set(request.id, request);
    this.flush();
    return request;
  }

  get(id: string): ApprovalRequest | undefined {
    const request = this.requests.get(id);
    if (request) this.refresh(request);
    return request;
  }

  list(filter: { status?: ApprovalStatus; runId?: string } = {}): ApprovalRequest[] {
    const out: ApprovalRequest[] = [];
    for (const request of this.requests.values()) {
      this.refresh(request);
      if (filter.status && request.status !== filter.status) continue;
      if (filter.runId && request.runId !== filter.runId) continue;
      out.push(request);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  vote(id: string, input: VoteInput): ApprovalRequest {
    const request = this.requests.get(id);
    if (!request) throw new Error(`no approval request with id "${id}"`);
    this.refresh(request);
    if (request.status !== 'pending') {
      throw new Error(`approval "${id}" is already ${request.status}`);
    }
    if (input.role !== request.requiredRole) {
      throw new Error(
        `approver role "${input.role}" cannot decide this request; role "${request.requiredRole}" is required`,
      );
    }
    if (request.reasonCodes.length > 0 && !request.reasonCodes.includes(input.reasonCode)) {
      throw new Error(
        `reason code "${input.reasonCode}" is not permitted here; expected one of ${request.reasonCodes.join(', ')}`,
      );
    }
    if (request.votes.some((v) => v.approver === input.approver)) {
      throw new Error(`approver "${input.approver}" has already voted on this request`);
    }

    const vote: ApprovalVote = {
      approver: input.approver,
      role: input.role,
      vote: input.vote,
      reasonCode: input.reasonCode,
      ts: this.clock.now().toISOString(),
    };
    if (input.note !== undefined) vote.note = input.note;
    request.votes.push(vote);

    // A single refusal is decisive; approval needs the full quorum.
    if (input.vote === 'deny') request.status = 'denied';
    else if (request.votes.filter((v) => v.vote === 'approve').length >= request.quorum) {
      request.status = 'approved';
    }
    this.flush();
    return request;
  }

  /** Marks every overdue pending request expired. Returns the ones it changed. */
  expireDue(): ApprovalRequest[] {
    const changed: ApprovalRequest[] = [];
    for (const request of this.requests.values()) {
      if (request.status !== 'pending') continue;
      if (this.refresh(request)) changed.push(request);
    }
    if (changed.length > 0) this.flush();
    return changed;
  }

  private refresh(request: ApprovalRequest): boolean {
    if (request.status !== 'pending') return false;
    if (this.clock.now().getTime() <= new Date(request.expiresAt).getTime()) return false;
    request.status = 'expired';
    return true;
  }

  protected flush(): void {
    /* in-memory store: nothing to do */
  }
}

/** Approval store backed by a JSON file, so approvals survive between CLI calls. */
export class FileApprovalStore extends ApprovalStore {
  constructor(
    private readonly path: string,
    clock: Clock = systemClock,
  ) {
    super(clock);
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as ApprovalRequest[];
      for (const request of parsed) this.requests.set(request.id, request);
    }
  }

  protected override flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify([...this.requests.values()], null, 2)}\n`, 'utf8');
  }
}

export interface ApprovalOutcome {
  status: ApprovalStatus;
  request: ApprovalRequest;
}

/**
 * How a run obtains a human decision. Swapping the gateway is how the same
 * agent runs unattended in CI, interactively at a desk, or against a review
 * queue staffed by a duty officer - without changing the agent or the policy.
 */
export interface ApprovalGateway {
  id: string;
  request(input: CreateApprovalInput, store: ApprovalStore): Promise<ApprovalOutcome>;
}

/** Default for unattended runs: escalations are refused, never silently allowed. */
export class AutoDenyGateway implements ApprovalGateway {
  id = 'auto-deny';

  async request(input: CreateApprovalInput, store: ApprovalStore): Promise<ApprovalOutcome> {
    const request = store.create(input);
    store.vote(request.id, {
      approver: 'system:auto-deny',
      role: input.requiredRole,
      vote: 'deny',
      reasonCode: input.reasonCodes[0] ?? 'no_reviewer',
      note: 'No human reviewer was available; CivicOS fails closed.',
    });
    return { status: 'denied', request };
  }
}

/**
 * Leaves the request pending for a human to answer later via
 * `civicos approvals`. The kernel treats a pending outcome as "not permitted
 * yet" and the run continues without the action.
 */
export class QueueGateway implements ApprovalGateway {
  id = 'queue';

  async request(input: CreateApprovalInput, store: ApprovalStore): Promise<ApprovalOutcome> {
    const request = store.create(input);
    return { status: 'pending', request };
  }
}

/**
 * Replays a fixed script of decisions. Intended for tests, examples and
 * demonstrations - it is not a substitute for a reviewer, and it says so.
 */
export class ScriptedGateway implements ApprovalGateway {
  id = 'scripted';

  constructor(
    private readonly script: Array<{
      match?: (input: CreateApprovalInput) => boolean;
      vote: 'approve' | 'deny';
      approver: string;
      reasonCode?: string;
      note?: string;
    }>,
  ) {}

  async request(input: CreateApprovalInput, store: ApprovalStore): Promise<ApprovalOutcome> {
    const request = store.create(input);
    const step = this.script.find((s) => !s.match || s.match(input));
    if (!step) {
      store.vote(request.id, {
        approver: 'system:scripted',
        role: input.requiredRole,
        vote: 'deny',
        reasonCode: input.reasonCodes[0] ?? 'no_reviewer',
        note: 'No scripted decision matched this request.',
      });
      return { status: 'denied', request };
    }
    const voteInput: Parameters<ApprovalStore['vote']>[1] = {
      approver: step.approver,
      role: input.requiredRole,
      vote: step.vote,
      reasonCode: step.reasonCode ?? input.reasonCodes[0] ?? 'reviewed',
    };
    if (step.note !== undefined) voteInput.note = step.note;
    let updated = store.vote(request.id, voteInput);
    // Satisfy a quorum greater than one with additional scripted reviewers.
    let extra = 2;
    while (updated.status === 'pending' && extra <= request.quorum) {
      updated = store.vote(request.id, { ...voteInput, approver: `${step.approver}+${extra}` });
      extra += 1;
    }
    return { status: updated.status, request: updated };
  }
}
