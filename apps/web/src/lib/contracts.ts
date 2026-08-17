export type Classification = 'confirmed' | 'unknown' | 'unaffected';
export type TemporalScope = 'historical' | 'current';
export type EvidenceAvailability = 'available' | 'unavailable';

export interface Incident {
  id: string;
  title: string;
  severity: string;
  ecosystem: string;
  advisory: string;
  affectedPackageCount: number;
  affectedVersionCount: number;
  windowStart: string;
  windowEnd: string;
  detectedAt: string;
  source: string;
}

export interface ExposureService {
  id: string;
  name: string;
  owner: string;
  deployedPackage?: string;
  classification: Classification;
  historicalPaths: number | null;
  currentPaths: number | null;
  lockPath?: string;
  inventoryReason?: string;
}

export interface InventorySummary {
  totalServices: number;
  confirmedServices: number;
  unknownServices: number;
  unaffectedServices: number;
  historicalPathCount: number | null;
  currentPathCount: number | null;
  exactPathCounts: boolean;
}

/**
 * The server owns every query/evidence assertion. `unavailable` means the
 * frontend must not infer a query, proof, duration, or verified integrity.
 */
export interface QueryEvidence {
  availability: EvidenceAvailability;
  queryText?: string;
  snapshot?: string;
  durationMs?: number;
  integrity?: 'verified' | 'unavailable';
  truncated?: boolean;
}

export interface WitnessNode {
  kind: string;
  label: string;
  detail: string;
  edge?: string;
  malicious?: boolean;
}

export interface Witness {
  serviceId: string;
  serviceName: string;
  owner: string;
  classification: Classification;
  pathNumber?: number;
  totalPaths: number | null;
  nodes: WitnessNode[];
  evidence: QueryEvidence;
}

export interface CostBreakdown {
  base: number;
  semver: number;
  scope: number;
  coordination: number;
}

export interface ContainmentAction {
  id: string;
  title: string;
  from: string;
  to: string;
  description: string;
  coveredPaths: number | null;
  affectedServices: number;
  changes: number;
  restarts: number;
  estimateMinutes?: number;
  cost: number;
  costs: CostBreakdown;
  recommended?: boolean;
}

export interface ContainmentPlan {
  status: 'feasible' | 'infeasible' | 'partial' | 'unknown';
  actions: ContainmentAction[];
  coveredPaths: number | null;
  totalPaths: number | null;
  exactCoverage: boolean;
  evidence: QueryEvidence;
  reason?: string;
}

export interface VerificationResult {
  /** `verified` is accepted only when `complete` is true. */
  status: 'verified' | 'unknown' | 'failed';
  complete: boolean;
  verifiedAt?: string;
  proofId?: string;
  before: { services: number; paths: number | null };
  after: { services: number; paths: number | null };
  evaluatedServices: number;
  coverage: string | null;
  evidence: QueryEvidence;
  reason?: string;
}

/** The unified UI response returned by `GET /v1/incident`. */
export interface IncidentUiContract {
  contractVersion: 1;
  engineMode: 'hydradb' | 'fixture';
  incident: Incident;
  inventory: InventorySummary;
  services: ExposureService[];
  witness?: Witness;
  plan?: ContainmentPlan;
  verification?: VerificationResult;
  evidence: QueryEvidence;
}

export interface BlastCutApi {
  getIncident(): Promise<IncidentUiContract>;
}
