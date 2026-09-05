import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, flagBool, flagNumber, flagString, flagOptional } from './args.js';
import { renderConsoleHtml } from './console-page.js';

test('parses commands, positional arguments and flag forms', () => {
  const args = parseArgs(['run', 'ngo-doc-summarizer', '--input', 'a.txt', '--dry-run', '--port=8080', '-q']);
  assert.deepEqual(args.positional, ['run', 'ngo-doc-summarizer']);
  assert.equal(args.flags.input, 'a.txt');
  assert.equal(args.flags['dry-run'], true);
  assert.equal(args.flags.port, '8080');
  assert.equal(args.flags.q, true);
});

test('a flag followed by another flag is boolean, not a value', () => {
  const args = parseArgs(['audit', 'tail', '--json', '--n', '5']);
  assert.equal(args.flags.json, true);
  assert.equal(args.flags.n, '5');
});

test('everything after -- is positional', () => {
  const args = parseArgs(['run', 'x', '--', '--not-a-flag']);
  assert.deepEqual(args.positional, ['run', 'x', '--not-a-flag']);
  assert.equal(args.flags['not-a-flag'], undefined);
});

test('flag accessors coerce safely', () => {
  const { flags } = parseArgs(['x', '--name', 'ana', '--count', 'seven', '--on']);
  assert.equal(flagString(flags, 'name', 'default'), 'ana');
  assert.equal(flagString(flags, 'missing', 'default'), 'default');
  assert.equal(flagOptional(flags, 'missing'), undefined);
  assert.equal(flagNumber(flags, 'count', 3), 3, 'a non-numeric value falls back');
  assert.equal(flagBool(flags, 'on'), true);
  assert.equal(flagBool(flags, 'off'), false);
});

test('the console page is self-contained and loads no third-party code', () => {
  const html = renderConsoleHtml();
  assert.match(html, /<title>CivicOS console<\/title>/);
  assert.ok(!/src\s*=\s*["']https?:/.test(html), 'no remote scripts');
  assert.ok(!/<link[^>]+href\s*=\s*["']https?:/.test(html), 'no remote stylesheets');
  assert.match(html, /fetch\('\/api\/state'\)/);
});
