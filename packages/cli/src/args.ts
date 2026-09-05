export interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean>;
  positional: string[];
}

/**
 * Minimal argument parser. `--flag`, `--flag=value`, `--flag value`, `-x`, and
 * `--` to stop parsing. No dependency, no surprises.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let passthrough = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (passthrough) {
      positional.push(token);
      continue;
    }
    if (token === '--') {
      passthrough = true;
      continue;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      flags[token.slice(1)] = true;
      continue;
    }
    positional.push(token);
  }

  return { command: positional.slice(0, 2), flags, positional };
}

export function flagString(flags: ParsedArgs['flags'], name: string, fallback: string): string {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

export function flagOptional(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

export function flagNumber(flags: ParsedArgs['flags'], name: string, fallback: number): number {
  const value = flags[name];
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
