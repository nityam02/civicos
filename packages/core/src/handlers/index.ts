import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { HandlerContext, Syscall, SyscallHandler } from '../types.js';

/**
 * Reference syscall handlers.
 *
 * Handlers are the only code in CivicOS that touches the outside world, so they
 * are small, boring and defensive on purpose. Each one re-checks its own
 * invariants even though the kernel has already applied capabilities and
 * policy: defence in depth means a bug in the policy layer is not enough on its
 * own to escape the sandbox.
 */

export function modelHandler(): SyscallHandler {
  return {
    kind: 'model.complete',
    resource: '**',
    async execute(syscall: Syscall, ctx: HandlerContext) {
      const payload = syscall.payload as {
        prompt?: unknown;
        system?: unknown;
        task?: unknown;
        options?: unknown;
      };
      if (typeof payload.prompt !== 'string') {
        throw new Error('model.complete requires a string payload.prompt');
      }
      const response = await ctx.model.complete({
        prompt: payload.prompt,
        ...(typeof payload.system === 'string' ? { system: payload.system } : {}),
        ...(typeof payload.task === 'string' ? { task: payload.task as 'summarize' } : {}),
        ...(payload.options && typeof payload.options === 'object'
          ? { options: payload.options as Record<string, unknown> }
          : {}),
      });
      return response;
    },
  };
}

export interface FileHandlerOptions {
  /** Absolute path all reads and writes are confined to. */
  root: string;
  /** Maximum bytes a single read may return. */
  maxBytes?: number;
}

/**
 * Reads a file. The resource name is interpreted as a path relative to `root`;
 * anything that resolves outside `root` is refused, symlinks included.
 */
export function fileReadHandler(options: FileHandlerOptions): SyscallHandler {
  const root = resolve(options.root);
  const maxBytes = options.maxBytes ?? 4_000_000;
  return {
    kind: 'data.read',
    resource: '**',
    async execute(syscall: Syscall) {
      const target = confine(root, resourcePath(syscall));
      if (!existsSync(target)) throw new Error(`no such file: ${relative(root, target)}`);
      const stats = statSync(target);
      if (!stats.isFile()) throw new Error(`not a regular file: ${relative(root, target)}`);
      if (stats.size > maxBytes) {
        throw new Error(`file is ${stats.size} bytes, above the ${maxBytes}-byte read limit`);
      }
      return { path: relative(root, target), bytes: stats.size, text: readFileSync(target, 'utf8') };
    },
  };
}

export function fileWriteHandler(options: FileHandlerOptions): SyscallHandler {
  const root = resolve(options.root);
  return {
    kind: 'data.write',
    resource: '**',
    async execute(syscall: Syscall) {
      const target = confine(root, resourcePath(syscall));
      const body = syscall.payload.text ?? syscall.payload.body;
      if (typeof body !== 'string') throw new Error('data.write requires a string payload.text');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body, 'utf8');
      return { path: relative(root, target), bytes: Buffer.byteLength(body) };
    },
  };
}

/**
 * Publication: making something visible outside the system. Kept separate from
 * `data.write` precisely so policy can treat it differently - writing a working
 * file is routine, publishing to the public is the act that needs a human.
 */
export function publishHandler(options: FileHandlerOptions): SyscallHandler {
  const root = resolve(options.root);
  return {
    kind: 'publish',
    resource: '**',
    async execute(syscall: Syscall, ctx: HandlerContext) {
      const target = confine(root, resourcePath(syscall));
      const body = syscall.payload.text ?? syscall.payload.body;
      if (typeof body !== 'string') throw new Error('publish requires a string payload.text');
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body, 'utf8');
      ctx.logger.info(`published ${relative(root, target)}`);
      return { published: relative(root, target), bytes: Buffer.byteLength(body) };
    },
  };
}

/** Writes a message onto the shared blackboard for a downstream agent. */
export function messageHandler(): SyscallHandler {
  return {
    kind: 'message.send',
    resource: '**',
    async execute(syscall: Syscall, ctx: HandlerContext) {
      const key = `msg:${syscall.resource}`;
      const inbox = (ctx.blackboard.get(key) as unknown[] | undefined) ?? [];
      inbox.push({ from: syscall.agentId, ts: syscall.ts, payload: syscall.payload });
      ctx.blackboard.set(key, inbox);
      return { delivered: syscall.resource, queued: inbox.length };
    },
  };
}

/**
 * Network fetch, refused unless the host is on an explicit allowlist. There is
 * no "allow all" option: an agent that can reach any host can exfiltrate
 * anything it has read.
 */
export function networkHandler(allowedHosts: string[] = []): SyscallHandler {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return {
    kind: 'net.fetch',
    resource: '**',
    async execute(syscall: Syscall) {
      const url = syscall.payload.url;
      if (typeof url !== 'string') throw new Error('net.fetch requires a string payload.url');
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`net.fetch received a malformed url: ${url}`);
      }
      if (parsed.protocol !== 'https:') throw new Error('net.fetch permits https only');
      if (!allowed.has(parsed.hostname.toLowerCase())) {
        throw new Error(
          `host "${parsed.hostname}" is not on the network allowlist (${[...allowed].join(', ') || 'empty'})`,
        );
      }
      const response = await fetch(parsed, { redirect: 'error' });
      const text = await response.text();
      return { status: response.status, host: parsed.hostname, bytes: text.length, text };
    },
  };
}

function resourcePath(syscall: Syscall): string {
  const explicit = syscall.payload.path;
  return typeof explicit === 'string' ? explicit : syscall.resource;
}

/** Rejects any path that escapes `root`, after resolving `..` and symlinks. */
function confine(root: string, candidate: string): string {
  const target = resolve(root, candidate.replace(/^[/\\]+/, ''));
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`path "${candidate}" escapes the permitted workspace`);
  }
  return join(root, rel);
}
