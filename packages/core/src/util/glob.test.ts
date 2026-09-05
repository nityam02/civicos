import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globMatch, globSpecificity } from './glob.js';

test('single star does not cross a path separator', () => {
  assert.ok(globMatch('public/*', 'public/brief.md'));
  assert.ok(!globMatch('public/*', 'public/briefs/brief.md'));
});

test('double star crosses separators', () => {
  assert.ok(globMatch('public/**', 'public/briefs/2026/brief.md'));
  assert.ok(globMatch('**', 'anything/at/all'));
  assert.ok(!globMatch('public/**', 'private/brief.md'));
});

test('literal characters are escaped, not treated as regex', () => {
  assert.ok(globMatch('corpus/report.txt', 'corpus/report.txt'));
  assert.ok(!globMatch('corpus/report.txt', 'corpus/reportXtxt'));
  assert.ok(!globMatch('a+b', 'aab'));
});

test('question mark matches exactly one non-separator character', () => {
  assert.ok(globMatch('doc?.md', 'doc1.md'));
  assert.ok(!globMatch('doc?.md', 'doc12.md'));
  assert.ok(!globMatch('doc?.md', 'doc/.md'));
});

test('specificity prefers literal patterns over wildcards', () => {
  assert.ok(globSpecificity('public/briefs/report.md') > globSpecificity('public/**'));
  assert.ok(globSpecificity('public/briefs/*') > globSpecificity('**'));
});
