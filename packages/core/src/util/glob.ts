/**
 * Minimal, non-backtracking glob over `/`-separated resource names.
 *
 *   `*`  matches any run of characters except `/`
 *   `**` matches any run of characters including `/`
 *   `?`  matches exactly one character except `/`
 *
 * Everything else is literal. Patterns are compiled once and cached; the
 * generated expressions contain no nested quantifiers, so matching is linear.
 */
const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${out}$`);
  cache.set(pattern, re);
  return re;
}

export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** Specificity score: more literal characters and fewer wildcards wins. */
export function globSpecificity(pattern: string): number {
  const wildcards = (pattern.match(/\*\*|\*|\?/g) ?? []).length;
  return pattern.length - wildcards * 8;
}
