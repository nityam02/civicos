import type { AgentManifest } from '@civicos/core';

const OWNER = 'CivicOS reference agents';
const CONTACT = 'agents@civicos.invalid';

/**
 * Three narrow agents rather than one wide one.
 *
 * Intake can read the raw feed but cannot publish. Verification can reason
 * about the feed but cannot read files or publish. Only the brief agent can
 * publish, and it can only read what verification put on the bus. No single
 * compromised or malfunctioning stage can take a raw, unverified report and put
 * it in front of the public.
 */
export const crisisIntakeManifest: AgentManifest = {
  id: 'crisis-intake',
  name: 'Crisis Intake',
  version: '0.1.0',
  purpose:
    'Normalises crowd-sourced crisis reports arriving from hotlines, volunteer networks, field teams and social media into a single structured record set for downstream verification.',
  riskTier: 'limited',
  owner: OWNER,
  contact: CONTACT,
  capabilities: [
    { resource: 'corpus/**', actions: ['data.read'] },
    { resource: 'model/**', actions: ['model.complete'] },
    { resource: 'bus/**', actions: ['message.send'] },
  ],
  policies: ['baseline', 'humanitarian-response'],
  dataCategories: ['personal_data', 'location', 'crisis_reports'],
  humanOversight: { required: false, roles: ['duty-officer'] },
  limitations: [
    'Category assignment is keyword-based and will misfile unusual phrasing.',
    'Intake performs no verification: everything it emits is unconfirmed by construction.',
  ],
};

export const crisisVerificationManifest: AgentManifest = {
  id: 'crisis-verification',
  name: 'Crisis Verification',
  version: '0.1.0',
  purpose:
    'Clusters normalised crisis reports by location and subject, counts independent corroborating sources, and marks clusters that identify individuals or that rest on a single unverified source.',
  riskTier: 'limited',
  owner: OWNER,
  contact: CONTACT,
  capabilities: [
    { resource: 'model/**', actions: ['model.complete'] },
    { resource: 'bus/**', actions: ['message.send'] },
  ],
  policies: ['baseline', 'humanitarian-response'],
  dataCategories: ['personal_data', 'location', 'crisis_reports'],
  humanOversight: { required: false, roles: ['duty-officer'] },
  limitations: [
    'Corroboration counts distinct source channels; it does not establish that a report is true.',
    'Two reports repeating the same rumour will corroborate each other.',
  ],
};

export const crisisBriefManifest: AgentManifest = {
  id: 'crisis-brief',
  name: 'Crisis Situation Report',
  version: '0.1.0',
  purpose:
    'Assembles verified crisis clusters into a situation report for responders, withholding anything that identifies individuals and routing the result to human duty officers before release.',
  // High risk: this is the stage whose output people act on.
  riskTier: 'high',
  owner: OWNER,
  contact: CONTACT,
  capabilities: [
    { resource: 'model/**', actions: ['model.complete'] },
    { resource: 'workspace/sitreps/**', actions: ['data.write'] },
    { resource: 'public/sitreps/**', actions: ['publish'] },
  ],
  policies: ['baseline', 'humanitarian-response', 'eu-ai-act-high-risk'],
  dataCategories: ['location', 'crisis_reports'],
  humanOversight: { required: true, roles: ['editor', 'duty-officer'] },
  limitations: [
    'Locations in the published product are deliberately imprecise and must not be used for targeting.',
    'The report reflects only what was reported; absence of a report is not absence of need.',
  ],
};
