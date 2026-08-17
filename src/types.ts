export const MAX_PATH_LENGTH = 16;

export type EngineMode = "fixture" | "hydradb";
export type SnapshotPhase = "before" | "during" | "after";
export type ServiceState = "exposed" | "unaffected" | "unknown";
export type UnknownReason =
  | "saturated"
  | "admission"
  | "deadline"
  | "budget"
  | "witness-at-bound"
  | "depth-truncated"
  | "missing-inventory"
  | "phase-unavailable"
  | "unsupported"
  | "malformed";

export interface PackageNode {
  id: string;
  name: string;
  version: string;
  scope: "public" | "private";
  malicious?: boolean;
}

export interface Service {
  id: string;
  owner: string;
  production: boolean;
  lockfile: "v2" | "v3" | "missing";
}

export interface DependencyEdge {
  id: string;
  from: string;
  to: string;
  kind: "DEPLOYS" | "DEPENDS_ON" | "REACHES";
  packageName?: string;
  packageVersion?: string;
  lockOccurrence?: string;
}

export interface TemporalSnapshot {
  phase: SnapshotPhase;
  capturedAt: string;
  namespace: string;
  checksum: string;
}

export interface GraphFixture {
  incident: Incident;
  services: Service[];
  packages: PackageNode[];
  edges: DependencyEdge[];
  snapshots: TemporalSnapshot[];
}

export interface Incident {
  id: string;
  advisory: "GHSA-g7cv-rxg3-hmpx";
  detectedAt: string;
  window: { start: string; end: string };
  maliciousPackages: number;
  maliciousVersions: number;
  target: { name: string; version: string };
}

export interface QueryLimits {
  maxLen?: number;
  pathBudget?: number;
  deadlineMs?: number;
  admissionAllowed?: boolean;
}

export interface Witness {
  serviceId: string;
  edgeIds: string[];
  nodeIds: string[];
  reachesBound: boolean;
}

export interface ServiceAnalysis {
  serviceId: string;
  owner?: string;
  lockfile?: Service["lockfile"];
  state: ServiceState;
  paths?: Witness[];
  pathCount?: number;
  unknownReason?: UnknownReason;
}

export interface BoundedQueryResult {
  queryText: string;
  analyses: ServiceAnalysis[];
  saturated: boolean;
  engineMode: EngineMode;
  snapshot: TemporalSnapshot;
}

export interface Action {
  id: string;
  kind: "override" | "patch";
  edgeIds: string[];
  affectedServices: string[];
  semverRisk: 0 | 2 | 8;
  scopeRisk: 0 | 2;
  coordinationCost: number;
  cost: number;
}

export interface ContainmentPlan {
  weighted: Action[];
  unweightedBaseline: Action[];
  coveredPaths: number;
  totalPaths: number;
  exact: boolean;
  feasible: boolean;
  uncoveredPaths: number;
  sensitivity: { multiplier: number; actions: string[]; totalCost: number; feasible: boolean }[];
}

export interface VerificationResult {
  before: BoundedQueryResult;
  after: BoundedQueryResult;
  plan: ContainmentPlan;
  verified: boolean;
  verificationReasons: string[];
}
