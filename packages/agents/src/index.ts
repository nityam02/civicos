/**
 * Reference agents for CivicOS.
 *
 * They are written to be read. Each one shows a different part of the kernel
 * contract: the summariser shows minimisation and single-reviewer sign-off; the
 * crisis pipeline shows separation of duties across three narrow agents, source
 * corroboration, and a two-person rule on a high-risk publication.
 */
export * from './ngo-doc-summarizer/index.js';
export * from './disaster-info-coordinator/index.js';

import { NgoDocSummarizer } from './ngo-doc-summarizer/index.js';
import { CrisisIntake, CrisisVerification, CrisisBrief } from './disaster-info-coordinator/index.js';
import type { Agent } from '@civicos/core';

/** Every reference agent, for registration and for `civicos agents list`. */
export function referenceAgents(): Agent[] {
  return [new NgoDocSummarizer(), new CrisisIntake(), new CrisisVerification(), new CrisisBrief()];
}
