import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bootstrap,
  QueueGateway,
  ScriptedGateway,
  createMemoryLogger,
  fixedClock,
} from '@civicos/core';
import type { ApprovalGateway, Deployment } from '@civicos/core';
import { referenceAgents } from './index.js';
import { disasterResponsePlan } from './disaster-info-coordinator/index.js';
import { parseFeed } from './disaster-info-coordinator/intake.js';
import { clusterReports } from './disaster-info-coordinator/verification.js';
import type { NormalisedReport } from './disaster-info-coordinator/types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function deploy(gateway: ApprovalGateway): Deployment {
  const deployment = bootstrap({
    root: REPO_ROOT,
    policyDir: join(REPO_ROOT, 'policies'),
    stateDir: mkdtempSync(join(tmpdir(), 'civicos-agents-')),
    ephemeral: true,
    gateway,
    clock: fixedClock('2026-09-05T00:00:00.000Z', 500),
    logger: createMemoryLogger(),
  });
  for (const agent of referenceAgents()) deployment.supervisor.register(agent);
  return deployment;
}

test('every reference agent has a manifest the kernel accepts', () => {
  const deployment = deploy(new QueueGateway());
  assert.equal(deployment.supervisor.registered.length, 4);
  for (const agent of deployment.supervisor.registered) {
    assert.ok(agent.manifest.purpose.length > 20, `${agent.manifest.id} states its purpose`);
    assert.ok(agent.manifest.policies.length > 0, `${agent.manifest.id} declares policy packs`);
  }
});

test('the summariser holds publication until a human answers', async () => {
  const deployment = deploy(new QueueGateway());
  const report = await deployment.supervisor.runAgent(
    'ngo-doc-summarizer',
    'data/samples/ngo-report.txt',
  );
  assert.equal(report.status, 'ok');
  const output = report.outcomes[0]!.result!.output as { published: boolean; brief: string };
  assert.equal(output.published, false);
  assert.equal(deployment.approvals.list({ status: 'pending' }).length, 1);
  assert.ok(deployment.ledger.verify().ok);
});

test('the summariser removes personal data before the model sees it', async () => {
  const deployment = deploy(new QueueGateway());
  await deployment.supervisor.runAgent('ngo-doc-summarizer', 'data/samples/ngo-report.txt');
  const modelCalls = deployment.ledger
    .records()
    .filter((r) => r.kind === 'model.complete' && r.event === 'syscall');
  assert.ok(modelCalls.length >= 2);
  const detectors = modelCalls.flatMap((r) => (r.redactions ?? []).map((f) => f.detector));
  assert.ok(detectors.includes('email'), 'the report contains an email address that was removed');
  assert.ok(detectors.includes('phone'), 'the report contains a phone number that was removed');
});

test('an approved brief is published, sourced and labelled', async () => {
  const deployment = deploy(new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]));
  const report = await deployment.supervisor.runAgent(
    'ngo-doc-summarizer',
    'data/samples/ngo-report.txt',
  );
  const output = report.outcomes[0]!.result!.output as {
    published: boolean;
    sources: string[];
    brief: string;
  };
  assert.equal(output.published, true);
  assert.ok(output.sources.length > 0);

  const published = readFileSync(
    join(deployment.paths.outputDir, 'published', 'briefs', 'ngo-report-txt.md'),
    'utf8',
  );
  assert.match(published, /Reviewed and approved by a named human/);
  assert.match(published, /## Sources/);
});

test('a document outside the corpus namespace cannot be read', async () => {
  const deployment = deploy(new QueueGateway());
  const report = await deployment.supervisor.runAgent('ngo-doc-summarizer', {
    documents: [{ id: '../../etc/passwd', path: '../../etc/passwd' }],
  });
  const output = report.outcomes[0]!.result!.output as { failures: string[] };
  assert.ok(output.failures.length > 0);
  assert.ok(deployment.ledger.records().some((r) => r.outcome !== 'ok'));
});

test('the crisis pipeline runs intake, verification and briefing in order', async () => {
  const deployment = deploy(new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]));
  const report = await deployment.supervisor.run(
    disasterResponsePlan('data/samples/incoming-reports.jsonl'),
  );
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.outcomes.map((o) => o.taskId), ['intake', 'verify', 'brief']);
  const brief = report.outcomes[2]!.result!.output as {
    published: boolean;
    withheld: number;
    sitrep: string;
  };
  assert.equal(brief.published, true);
  assert.ok(brief.withheld >= 1, 'the report naming a nurse and a phone number is withheld');
});

test('the published situation report carries no precise coordinates', async () => {
  const deployment = deploy(new ScriptedGateway([{ vote: 'approve', approver: 'ana' }]));
  const report = await deployment.supervisor.run(
    disasterResponsePlan('data/samples/incoming-reports.jsonl'),
  );
  const brief = report.outcomes[2]!.result!.output as { sitrep: string };
  assert.ok(brief.sitrep.includes('37.94'), 'coarsened coordinates are present');
  assert.ok(!/\d{1,3}\.\d{4,}/.test(brief.sitrep), 'no coordinate keeps more than two decimals');
});

test('the high-risk brief agent needs two reviewers, not one', async () => {
  const deployment = deploy(new QueueGateway());
  await deployment.supervisor.run(disasterResponsePlan('data/samples/incoming-reports.jsonl'));
  const pending = deployment.approvals.list({ status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.quorum, 2, 'the EU AI Act pack raises the quorum for a high-risk agent');
});

test('the feed parser skips malformed lines instead of failing the run', () => {
  const { reports, malformed } = parseFeed(
    ['{"id":"a","text":"ok"}', 'not json at all', '{"id":"b"}', ''].join('\n'),
  );
  assert.equal(reports.length, 1);
  assert.equal(malformed, 2);
});

test('corroboration counts independent channels, not repeated messages', () => {
  const base: NormalisedReport = {
    id: 'r-1', ts: '2026-09-04T06:00:00Z', source: 'social_media', location: 'Harbour',
    lat: 37.9384, lon: 23.6431, text: 'water rising', category: 'water_sanitation',
    sourceWeight: 0.35, hedged: false,
  };
  const echoed = clusterReports([
    base,
    { ...base, id: 'r-2', ts: '2026-09-04T06:05:00Z' },
    { ...base, id: 'r-3', ts: '2026-09-04T06:10:00Z' },
  ]);
  assert.equal(echoed.length, 1);
  assert.equal(echoed[0]!.corroboration, 1, 'three posts on one channel corroborate nothing');

  const independent = clusterReports([base, { ...base, id: 'r-4', source: 'field_team' }]);
  assert.equal(independent[0]!.corroboration, 2);
});

test('a cluster naming a person and a phone number is flagged', () => {
  const clusters = clusterReports([
    {
      id: 'r-4', ts: '2026-09-04T07:02:00Z', source: 'community_hotline', location: 'Clinic',
      lat: 37.9621, lon: 23.6014,
      text: 'Contact the duty nurse Maria Antonopoulou on +30 694 555 0177.',
      category: 'medical', sourceWeight: 0.8, hedged: false,
    },
  ]);
  assert.equal(clusters[0]!.identifiesIndividuals, true);
});

test('clustering coarsens the coordinates it reports', () => {
  const clusters = clusterReports([
    {
      id: 'r-1', ts: '2026-09-04T06:00:00Z', source: 'field_team', location: 'Harbour',
      lat: 37.938412, lon: 23.643117, text: 'flooding', category: 'water_sanitation',
      sourceWeight: 1, hedged: false,
    },
  ]);
  assert.equal(clusters[0]!.lat, 37.94);
  assert.equal(clusters[0]!.lon, 23.64);
});
