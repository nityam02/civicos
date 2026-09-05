import type { Plan } from '@civicos/core';
import { CrisisIntake } from './intake.js';
import { CrisisVerification } from './verification.js';
import { CrisisBrief } from './brief.js';

export * from './types.js';
export * from './manifests.js';
export { CrisisIntake, parseFeed } from './intake.js';
export { CrisisVerification, clusterReports } from './verification.js';
export { CrisisBrief, renderSitrep } from './brief.js';

/**
 * The coordination pipeline: intake, then verification, then the situation
 * report. Stated as data rather than code so the shape of the workflow is
 * reviewable and the supervisor can enforce the dependency order.
 */
export function disasterResponsePlan(feedPath: string): Plan {
  return {
    id: 'disaster-info-coordinator',
    description:
      'Normalise crowd-sourced crisis reports, corroborate them across independent channels, and produce a situation report for human release.',
    onFailure: 'halt',
    concurrency: 1,
    tasks: [
      { id: 'intake', agent: 'crisis-intake', input: { path: feedPath } },
      { id: 'verify', agent: 'crisis-verification', dependsOn: ['intake'] },
      { id: 'brief', agent: 'crisis-brief', dependsOn: ['verify'] },
    ],
  };
}

export function disasterResponseAgents(): [CrisisIntake, CrisisVerification, CrisisBrief] {
  return [new CrisisIntake(), new CrisisVerification(), new CrisisBrief()];
}
