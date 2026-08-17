import { createDemoFixture } from "./fixture.js";
import { blastCutVertexId, decodeHydraPaths, executeHydraQuery, hydraPathQuery, removalQuery, seedHydraDbFixture, temporalFixtureEdges, type HydraDbConnection } from "./hydradb.js";
import { MAX_PATH_LENGTH, type BoundedQueryResult, type DependencyEdge, type EngineMode, type GraphFixture, type QueryLimits, type ServiceAnalysis, type TemporalSnapshot, type Witness } from "./types.js";

export interface GraphEngine {
  readonly mode: EngineMode;
  analyze(namespace: string, phase: "before" | "during" | "after", limits?: QueryLimits, removedEdgeIds?: Set<string>): Promise<BoundedQueryResult>;
}

/** Deterministic evaluator for the same typed, bounded graph contract used by HydraDB. */
export class FixtureGraphEngine implements GraphEngine {
  readonly mode = "fixture" as const;
  constructor(private readonly fixture: GraphFixture = createDemoFixture()) {}

  async analyze(namespace: string, phase: "before" | "during" | "after", limits: QueryLimits = {}, removedEdgeIds = new Set<string>()): Promise<BoundedQueryResult> {
    const maxLen = boundedMaxLen(limits.maxLen);
    const budget = boundedPathBudget(limits.pathBudget);
    const snapshot = this.snapshot(namespace, phase);
    const queryText = hydraPathQuery(1, blastCutVertexId("pkg:tanstack-router:1.120.7", this.fixture), maxLen, budget);
    if (limits.admissionAllowed === false) return this.failAll(queryText, snapshot, "admission");
    if (limits.deadlineMs !== undefined && limits.deadlineMs <= 0) return this.failAll(queryText, snapshot, "deadline");
    const target = this.fixture.packages.find((node) => node.malicious);
    if (!target) return this.failAll(queryText, snapshot, "malformed");
    const analyses: ServiceAnalysis[] = [];
    let remaining = budget;
    let saturated = false;
    for (const service of this.fixture.services) {
      if (service.lockfile === "missing") {
        analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "missing-inventory" });
        continue;
      }
      const enumerated = enumeratePaths(temporalFixtureEdges(phase, this.fixture), service.id, target.id, maxLen, removedEdgeIds, remaining);
      remaining -= enumerated.paths.length;
      saturated ||= enumerated.budgetExhausted;
      if (enumerated.depthTruncated) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "depth-truncated" });
      else if (enumerated.budgetExhausted) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "saturated" });
      else if (enumerated.paths.some((path) => path.reachesBound)) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "witness-at-bound" });
      else if (enumerated.paths.length) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "exposed", paths: enumerated.paths, pathCount: enumerated.paths.length });
      else analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unaffected", paths: [], pathCount: 0 });
    }
    if (saturated) suppressExactCounts(analyses);
    return { queryText, analyses, saturated, engineMode: this.mode, snapshot };
  }

  private snapshot(namespace: string, phase: "before" | "during" | "after"): TemporalSnapshot {
    const source = this.fixture.snapshots.find((item) => item.phase === phase);
    if (!source) throw new Error(`Missing ${phase} fixture snapshot`);
    return { ...source, namespace };
  }
  private failAll(queryText: string, snapshot: TemporalSnapshot, reason: NonNullable<ServiceAnalysis["unknownReason"]>): BoundedQueryResult {
    return { queryText, snapshot, engineMode: this.mode, saturated: false, analyses: this.fixture.services.map((service) => ({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: reason })) };
  }
}

/**
 * HydraDB adapter. Docker-backed live `during` analysis has been exercised;
 * before/after are deliberately unavailable until phase-scoped evidence is
 * authorized. `algo.SPpaths` accepts integer node ids and the tagged-path
 * decoder never substitutes fixture results.
 */
export class HydraDbGraphEngine implements GraphEngine {
  readonly mode = "hydradb" as const;
  private readonly fixture = createDemoFixture();
  private readonly connection: HydraDbConnection;

  constructor(baseUrl: string, token: string) { this.connection = { baseUrl, token }; }

  async analyze(namespace: string, phase: "before" | "during" | "after", limits: QueryLimits = {}, removedEdgeIds = new Set<string>()): Promise<BoundedQueryResult> {
    const maxLen = boundedMaxLen(limits.maxLen);
    const pathBudget = boundedPathBudget(limits.pathBudget);
    const snapshot = this.snapshot(namespace, phase);
    const target = this.fixture.packages.find((pkg) => pkg.malicious)!;
    const queryText = hydraPathQuery(1, blastCutVertexId(target.id, this.fixture), maxLen, pathBudget);
    if (limits.admissionAllowed === false) return this.failAll(queryText, snapshot, "admission");
    if ((limits.deadlineMs ?? 250) <= 0) return this.failAll(queryText, snapshot, "deadline");
    // The live Docker retest seeded only the incident-time graph in the caller's
    // authorized namespace. Do not query it for before/after: that would present
    // the during graph as temporal evidence. Phase-scoped live namespaces/markers
    // are not authorized or verified yet, so fail closed without issuing a query.
    if (phase !== "during") return this.failAll(queryText, snapshot, "phase-unavailable");

    // Counterfactual namespaces are independently seeded from the same temporal
    // lock snapshot before their selected relationship evidence is removed.
    if (removedEdgeIds.size) {
      await seedHydraDbFixture(this.connection, namespace, phase);
      for (const edgeId of removedEdgeIds) {
        const edge = this.fixture.edges.find((candidate) => candidate.id === edgeId);
        if (edge) await executeHydraQuery(this.connection, namespace, removalQuery(edge, this.fixture), limits.deadlineMs ?? 250);
      }
    }

    const analyses: ServiceAnalysis[] = [];
    let remaining = pathBudget;
    let saturated = false;
    for (const service of this.fixture.services) {
      if (service.lockfile === "missing") {
        analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "missing-inventory" });
        continue;
      }
      if (remaining === 0) { saturated = true; analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "saturated" }); continue; }
      const serviceQuery = hydraPathQuery(blastCutVertexId(service.id, this.fixture), blastCutVertexId(target.id, this.fixture), maxLen, remaining);
      const response = await executeHydraQuery(this.connection, namespace, serviceQuery, limits.deadlineMs ?? 250);
      const paths = decodeHydraPaths(response, service.id, maxLen);
      remaining -= paths.length;
      const atBound = paths.some((path) => path.reachesBound);
      if (paths.length === 0) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unaffected", paths: [], pathCount: 0 });
      else if (atBound) analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "witness-at-bound" });
      else if (remaining === 0) { saturated = true; analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: "saturated" }); }
      else analyses.push({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "exposed", paths, pathCount: paths.length });
    }
    if (saturated) suppressExactCounts(analyses);
    return { queryText, analyses, saturated, engineMode: this.mode, snapshot };
  }

  private snapshot(namespace: string, phase: "before" | "during" | "after"): TemporalSnapshot {
    return { ...this.fixture.snapshots.find((item) => item.phase === phase)!, namespace };
  }
  private failAll(queryText: string, snapshot: TemporalSnapshot, reason: ServiceAnalysis["unknownReason"]): BoundedQueryResult {
    return { queryText, snapshot, engineMode: this.mode, saturated: false, analyses: this.fixture.services.map((service) => ({ serviceId: service.id, owner: service.owner, lockfile: service.lockfile, state: "unknown", unknownReason: reason })) };
  }
}

function suppressExactCounts(analyses: ServiceAnalysis[]): void {
  for (const analysis of analyses) {
    delete analysis.pathCount;
    delete analysis.paths;
    if (analysis.state !== "unaffected") {
      analysis.state = "unknown";
      analysis.unknownReason = "saturated";
    }
  }
}

function boundedMaxLen(candidate = MAX_PATH_LENGTH): number {
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_PATH_LENGTH) throw new Error(`maxLen must be an integer from 1 to ${MAX_PATH_LENGTH}`);
  return candidate;
}
function boundedPathBudget(candidate = 128): number {
  if (!Number.isInteger(candidate) || candidate < 1) throw new Error("pathBudget must be a positive integer");
  return candidate;
}

interface Enumeration { paths: Witness[]; depthTruncated: boolean; budgetExhausted: boolean }

function enumeratePaths(edges: DependencyEdge[], source: string, target: string, maxLen: number, removed: Set<string>, remaining: number): Enumeration {
  const outgoing = new Map<string, DependencyEdge[]>();
  for (const edge of edges) if (!removed.has(edge.id)) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const paths: Witness[] = [];
  let depthTruncated = false;
  let budgetExhausted = false;
  const visit = (node: string, nodes: string[], edgeIds: string[]): void => {
    if (paths.length >= remaining) { budgetExhausted = true; return; }
    if (node === target) { paths.push({ serviceId: source, nodeIds: nodes, edgeIds, reachesBound: edgeIds.length === maxLen }); return; }
    const nextEdges = (outgoing.get(node) ?? []).filter((edge) => !nodes.includes(edge.to));
    if (edgeIds.length === maxLen) { if (nextEdges.length > 0) depthTruncated = true; return; }
    for (const edge of nextEdges) visit(edge.to, [...nodes, edge.to], [...edgeIds, edge.id]);
  };
  visit(source, [source], []);
  return { paths, depthTruncated, budgetExhausted };
}
