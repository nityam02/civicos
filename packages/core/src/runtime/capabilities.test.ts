import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCapability, validateManifest, assertManifestValid } from './capabilities.js';
import type { AgentManifest, Syscall } from '../types.js';

const base: AgentManifest = {
  id: 'reader',
  name: 'Reader',
  version: '1.0.0',
  purpose: 'Reads a named corpus and does nothing else at all, for capability tests.',
  riskTier: 'limited',
  owner: 'tests',
  contact: 'tests@civicos.invalid',
  capabilities: [
    { resource: 'corpus/**', actions: ['data.read'] },
    { resource: 'model/summarize', actions: ['model.complete'] },
  ],
  policies: ['baseline'],
  dataCategories: [],
  humanOversight: { required: false, roles: [] },
};

const syscall = (kind: Syscall['kind'], resource: string): Syscall => ({
  id: 's', ts: '2026-09-05T00:00:00.000Z', runId: 'r', agentId: 'reader', kind, resource, payload: {},
});

test('a granted capability admits the syscall', () => {
  const result = checkCapability(base, syscall('data.read', 'corpus/report.txt'));
  assert.ok(result.granted);
  assert.equal(result.capability?.resource, 'corpus/**');
});

test('a capability for one action does not carry to another', () => {
  const result = checkCapability(base, syscall('publish', 'corpus/report.txt'));
  assert.ok(!result.granted);
  assert.match(result.reason, /holds no capability for publish/);
});

test('a capability for one resource does not carry to another', () => {
  const result = checkCapability(base, syscall('data.read', 'private/secrets.txt'));
  assert.ok(!result.granted);
  assert.match(result.reason, /not on resource/);
});

test('the most specific matching capability is the one reported', () => {
  const manifest: AgentManifest = {
    ...base,
    capabilities: [
      { resource: 'corpus/**', actions: ['data.read'] },
      { resource: 'corpus/public/report.txt', actions: ['data.read'] },
    ],
  };
  const result = checkCapability(manifest, syscall('data.read', 'corpus/public/report.txt'));
  assert.equal(result.capability?.resource, 'corpus/public/report.txt');
});

test('a high-risk agent must declare human oversight', () => {
  const issues = validateManifest({ ...base, riskTier: 'high' });
  assert.ok(issues.some((i) => i.level === 'error' && i.message.includes('humanOversight.required')));
  assert.throws(() => assertManifestValid({ ...base, riskTier: 'high' }), /is invalid/);
});

test('an agent with no policy pack and no stated purpose is rejected', () => {
  const issues = validateManifest({ ...base, policies: [], purpose: 'too short' });
  assert.ok(issues.some((i) => i.message.includes('declares no policy packs')));
  assert.ok(issues.some((i) => i.message.includes('purpose')));
});

test('a wildcard capability is a warning, not an error', () => {
  const issues = validateManifest({ ...base, capabilities: [{ resource: '**', actions: ['data.read'] }] });
  const wildcard = issues.find((i) => i.message.includes('whole resource namespace'));
  assert.equal(wildcard?.level, 'warning');
  assert.doesNotThrow(() => assertManifestValid({ ...base, capabilities: [{ resource: '**', actions: ['data.read'] }] }));
});

test('a valid manifest produces no errors', () => {
  assert.equal(validateManifest(base).filter((i) => i.level === 'error').length, 0);
});
