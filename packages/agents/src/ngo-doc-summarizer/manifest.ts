import type { AgentManifest } from '@civicos/core';

/**
 * The manifest is the agent's contract with the deployment. A reviewer who
 * reads only this file knows what the agent may touch, which policies bind it,
 * what data it handles and who is accountable for it.
 */
export const ngoDocSummarizerManifest: AgentManifest = {
  id: 'ngo-doc-summarizer',
  name: 'NGO Document Summariser',
  version: '0.1.0',
  purpose:
    'Reads documents held by a civil-society organisation and drafts a short, sourced brief for a human editor to review before publication. It exists so that small organisations without a research team can still turn their own records into something they can act on.',
  riskTier: 'limited',
  owner: 'CivicOS reference agents',
  contact: 'agents@civicos.invalid',
  capabilities: [
    { resource: 'corpus/**', actions: ['data.read'] },
    { resource: 'model/**', actions: ['model.complete'] },
    { resource: 'workspace/briefs/**', actions: ['data.write'] },
    { resource: 'public/briefs/**', actions: ['publish'] },
  ],
  policies: ['baseline', 'ngo-document-handling'],
  dataCategories: ['personal_data', 'organisational_records'],
  humanOversight: { required: true, roles: ['editor'] },
  limitations: [
    'Summaries are extractive by default: the agent selects sentences, it does not verify claims.',
    'Redaction is pattern-based and will miss identifiers written in unusual formats.',
    'The agent has no access to any document outside the corpus it is pointed at.',
  ],
};
