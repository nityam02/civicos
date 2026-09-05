export interface RawReport {
  id: string;
  ts: string;
  source: string;
  location: string;
  lat: number | null;
  lon: number | null;
  text: string;
}

export interface NormalisedReport extends RawReport {
  category: string;
  /** Weight of the reporting channel, 0-1. Not a truth value. */
  sourceWeight: number;
  hedged: boolean;
}

export interface VerifiedCluster {
  key: string;
  location: string;
  category: string;
  /** Number of distinct source channels reporting this cluster. */
  corroboration: number;
  reportIds: string[];
  sources: string[];
  /** Coarsened representative coordinates, or null when unknown. */
  lat: number | null;
  lon: number | null;
  identifiesIndividuals: boolean;
  rumourRisk: boolean;
  narrative: string;
  firstSeen: string;
  lastSeen: string;
}
