/**
 * A strict, dependency-free parser for the subset of YAML that CivicOS policy
 * packs and agent manifests are allowed to use.
 *
 * Why not a YAML library? Policy files sit inside the trust boundary: they
 * decide what an agent may do. A general YAML parser is tens of thousands of
 * lines with a history of surprising coercions (`no` -> false, sexagesimals,
 * anchors, merge keys, arbitrary tags). CivicOS instead defines a small,
 * boring subset that a reviewer can hold in their head, and rejects everything
 * else loudly rather than guessing.
 *
 * Supported: nested block maps and sequences, `#` comments, single/double
 * quoted and plain scalars, integers, floats, booleans (`true`/`false` only),
 * `null`/`~`, flow sequences `[a, b]`, flow maps `{a: 1}`, and block scalars
 * (`|`, `|-`, `>`, `>-`).
 *
 * Not supported (and rejected): tabs for indentation, anchors and aliases,
 * tags, multiple documents, merge keys, and implicit boolean spellings such as
 * `yes`/`on`/`off`.
 */

export class YamlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line + 1})`);
    this.name = 'YamlError';
  }
}

interface State {
  lines: string[];
  i: number;
}

const BANNED_PLAIN = new Set(['yes', 'no', 'on', 'off', 'Yes', 'No', 'On', 'Off', 'YES', 'NO']);

export function parseYaml(source: string): unknown {
  const raw = source.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    const lead = line.slice(0, line.length - line.trimStart().length);
    if (lead.includes('\t')) throw new YamlError('tabs are not allowed for indentation', i);
    lines.push(line.trimEnd() === '---' ? '' : line);
  }
  const state: State = { lines, i: 0 };
  skipBlank(state);
  if (state.i >= lines.length) return null;
  const value = parseNode(state, indentOf(lines[state.i]!));
  skipBlank(state);
  if (state.i < lines.length) {
    throw new YamlError(`unexpected content ${JSON.stringify(lines[state.i])}`, state.i);
  }
  return value;
}

/** Parses and asserts the document is a map. */
export function parseYamlObject(source: string): Record<string, unknown> {
  const value = parseYaml(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new YamlError('expected a mapping at the top level of the document', 0);
  }
  return value as Record<string, unknown>;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

function skipBlank(state: State): void {
  while (state.i < state.lines.length && isBlank(state.lines[state.i]!)) state.i++;
}

function parseNode(state: State, indent: number): unknown {
  skipBlank(state);
  if (state.i >= state.lines.length) return null;
  const line = state.lines[state.i]!;
  if (indentOf(line) < indent) return null;
  return line.trim().startsWith('-') ? parseSeq(state, indent) : parseMap(state, indent);
}

function parseMap(state: State, indent: number): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (;;) {
    skipBlank(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i]!;
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new YamlError('unexpected indentation inside mapping', state.i);
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed === '-') break;

    const split = splitKey(trimmed, state.i);
    const key = split.key;
    const rest = split.rest;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      throw new YamlError(`duplicate key ${JSON.stringify(key)}`, state.i);
    }
    const keyLine = state.i;
    state.i++;

    if (rest === '') {
      map[key] = parseChildBlock(state, indent);
    } else if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      map[key] = parseBlockScalar(state, indent, rest);
    } else {
      map[key] = parseScalar(rest, keyLine);
    }
  }
  return map;
}

/** Reads the block that belongs to a `key:` line with nothing after the colon. */
function parseChildBlock(state: State, parentIndent: number): unknown {
  skipBlank(state);
  if (state.i >= state.lines.length) return null;
  const next = state.lines[state.i]!;
  const nind = indentOf(next);
  if (nind > parentIndent) return parseNode(state, nind);
  // YAML permits a sequence to sit at the same indentation as its parent key.
  if (nind === parentIndent && next.trim().startsWith('-')) return parseSeq(state, parentIndent);
  return null;
}

function parseSeq(state: State, indent: number): unknown[] {
  const out: unknown[] = [];
  for (;;) {
    skipBlank(state);
    if (state.i >= state.lines.length) break;
    const line = state.lines[state.i]!;
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new YamlError('unexpected indentation inside sequence', state.i);
    const trimmed = line.trim();
    if (!(trimmed === '-' || trimmed.startsWith('- '))) break;

    const afterDash = trimmed === '-' ? '' : trimmed.slice(1);
    const gap = afterDash.length - afterDash.trimStart().length;
    const rest = afterDash.trim();
    const contentColumn = ind + 1 + gap;
    const itemLine = state.i;
    state.i++;

    if (rest === '') {
      out.push(parseChildBlock(state, indent));
    } else if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      out.push(parseBlockScalar(state, indent, rest));
    } else if (looksLikeKey(rest)) {
      // `- key: value` starts a mapping whose indentation is the content column.
      state.lines[itemLine] = ' '.repeat(contentColumn) + rest;
      state.i = itemLine;
      out.push(parseMap(state, contentColumn));
    } else {
      out.push(parseScalar(rest, itemLine));
    }
  }
  return out;
}

function parseBlockScalar(state: State, parentIndent: number, marker: string): string {
  const fold = marker.startsWith('>');
  const chomp = marker.endsWith('-');
  const collected: string[] = [];
  let blockIndent = -1;
  while (state.i < state.lines.length) {
    const line = state.lines[state.i]!;
    if (line.trim() === '') {
      collected.push('');
      state.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (blockIndent === -1) blockIndent = ind;
    if (ind < blockIndent) break;
    collected.push(line.slice(blockIndent));
    state.i++;
  }
  while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
  const text = fold ? foldLines(collected) : collected.join('\n');
  return chomp ? text : `${text}\n`;
}

function foldLines(lines: string[]): string {
  const parts: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    if (line === '') {
      if (buffer.length) parts.push(buffer.join(' '));
      buffer = [];
      parts.push('');
    } else {
      buffer.push(line.trim());
    }
  }
  if (buffer.length) parts.push(buffer.join(' '));
  return parts.join('\n');
}

function splitKey(text: string, lineNo: number): { key: string; rest: string } {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      const key = unquote(text.slice(0, i).trim());
      if (key === '') throw new YamlError('empty mapping key', lineNo);
      return { key, rest: stripComment(text.slice(i + 1)).trim() };
    }
  }
  throw new YamlError(`expected "key: value" but found ${JSON.stringify(text)}`, lineNo);
}

function looksLikeKey(text: string): boolean {
  if (text.startsWith('{') || text.startsWith('[')) return false;
  try {
    splitKey(text, 0);
    return true;
  } catch {
    return false;
  }
}

/** Removes a trailing ` # comment`, honouring quotes. */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || text[i - 1] === ' ')) return text.slice(0, i);
  }
  return text;
}

function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return JSON.parse(text) as string;
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

export function parseScalar(text: string, lineNo = 0): unknown {
  const value = text.trim();
  if (value === '') return null;
  if (value.startsWith('"') || value.startsWith("'")) return unquote(value);
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) throw new YamlError('unterminated flow sequence', lineNo);
    return splitFlow(value.slice(1, -1), lineNo).map((part) => parseScalar(part, lineNo));
  }
  if (value.startsWith('{')) {
    if (!value.endsWith('}')) throw new YamlError('unterminated flow mapping', lineNo);
    const out: Record<string, unknown> = {};
    for (const part of splitFlow(value.slice(1, -1), lineNo)) {
      const { key, rest } = splitKey(part.trim(), lineNo);
      out[key] = parseScalar(rest, lineNo);
    }
    return out;
  }
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (BANNED_PLAIN.has(value)) {
    throw new YamlError(
      `ambiguous boolean ${JSON.stringify(value)}: write true or false, or quote the string`,
      lineNo,
    );
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+(e[-+]?\d+)?$/i.test(value)) return Number.parseFloat(value);
  if (value.startsWith('&') || value.startsWith('*') || value.startsWith('!')) {
    throw new YamlError('anchors, aliases and tags are not supported in CivicOS policy files', lineNo);
  }
  return value;
}

function splitFlow(text: string, lineNo: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new YamlError('unbalanced brackets in flow collection', lineNo);
  const tail = text.slice(start);
  if (tail.trim() !== '' || parts.length > 0) parts.push(tail);
  return parts.filter((p) => p.trim() !== '');
}
