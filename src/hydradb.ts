import { createDemoFixture } from "./fixture.js";
import type { DependencyEdge, GraphFixture, SnapshotPhase, Witness } from "./types.js";

export const HYDRADB_GRAPH_ID = "blastcut";
export const HYDRADB_CELL_ID = "cell-0";

export interface HydraHttpValue {
  type: string;
  value?: unknown;
}

export interface HydraHttpResponse {
  columns: string[];
  rows: HydraHttpValue[][];
}

export interface HydraDbConnection {
  baseUrl: string;
  token: string;
}

/** Stable numeric identities are required by HydraDB's native SPpaths procedure. */
export function blastCutVertexId(externalId: string, fixture: GraphFixture = createDemoFixture()): number {
  const serviceIndex = fixture.services.findIndex((service) => service.id === externalId);
  if (serviceIndex >= 0) return serviceIndex + 1;
  const packageIndex = fixture.packages.findIndex((pkg) => pkg.id === externalId);
  if (packageIndex >= 0) return 1_001 + packageIndex;
  throw new Error(`unknown BlastCut vertex ${externalId}`);
}

export function temporalFixtureEdges(phase: SnapshotPhase, fixture: GraphFixture = createDemoFixture()): DependencyEdge[] {
  if (phase === "during") return fixture.edges;
  const absentOutsideIncident = new Set(["dep:tanstack-start:router", "dep:legacy-metrics:router"]);
  return fixture.edges.filter((edge) => !absentOutsideIncident.has(edge.id));
}

export function hydraPathQuery(sourceNode: number, targetNode: number, maxLen: number, pathBudget: number): string {
  return `CALL algo.SPpaths({sourceNode: ${sourceNode}, targetNode: ${targetNode}, relTypes: ['DEPLOYS', 'DEPENDS_ON', 'REACHES'], relDirection: 'outgoing', maxLen: ${maxLen}, pathCount: ${pathBudget}, resultLimit: ${pathBudget}}) YIELD path RETURN path`;
}

export async function executeHydraQuery(connection: HydraDbConnection, namespace: string, query: string, timeoutMs = 250): Promise<HydraHttpResponse> {
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl.replace(/\/$/, "")}/v1/graphs/${HYDRADB_GRAPH_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "X-Graph-Namespace": namespace,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cell_id: HYDRADB_CELL_ID, consistency: "strong", timeout_ms: timeoutMs, query }),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
  } catch (error) {
    throw new Error(`HydraDB request failed: ${error instanceof Error ? error.message : "unexpected transport error"}`);
  }
  if (!response.ok) throw new Error(`HydraDB query failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<HydraHttpResponse>;
}

/** Decodes HydraDB's tagged HTTP `path` values without inventing fixture evidence. */
export function decodeHydraPaths(response: HydraHttpResponse, serviceId: string, maxLen: number): Witness[] {
  if (response.columns.length !== 1 || response.columns[0] !== "path") {
    throw new Error(`HydraDB path response must contain exactly the path column; got ${response.columns.join(", ")}`);
  }
  return response.rows.map((row, index) => {
    const value = row[0];
    if (row.length !== 1 || value?.type !== "path" || !isRecord(value.value)) {
      throw new Error(`HydraDB row ${index} is not a tagged path value`);
    }
    const nodes = value.value.nodes;
    const relationships = value.value.relationships;
    if (!Array.isArray(nodes) || !Array.isArray(relationships) || nodes.length !== relationships.length + 1) {
      throw new Error(`HydraDB row ${index} contains a malformed path`);
    }
    const nodeIds = nodes.map((node, nodeIndex) => pathExternalId(node, `node ${nodeIndex}`));
    const edgeIds = relationships.map((relationship, relationshipIndex) => pathRelationshipId(relationship, `relationship ${relationshipIndex}`));
    return { serviceId, nodeIds, edgeIds, reachesBound: edgeIds.length === maxLen };
  });
}

export async function seedHydraDbFixture(connection: HydraDbConnection, namespace: string, phase: SnapshotPhase): Promise<void> {
  const fixture = createDemoFixture();
  const unavailableServices = new Set(fixture.services.filter((service) => service.lockfile === "missing").map((service) => service.id));
  for (const edge of temporalFixtureEdges(phase, fixture)) {
    // A missing lockfile is evidence-insufficient, so no dependency deployment is asserted for it.
    if (edge.kind === "DEPLOYS" && unavailableServices.has(edge.from)) continue;
    // HydraDB MERGE identifies a relationship structurally (type/source/destination),
    // so the deterministic fixture has no duplicate same-type endpoint pairs.
    const sourceLabel = fixture.services.some((service) => service.id === edge.from) ? "Service" : "Package";
    const targetLabel = fixture.services.some((service) => service.id === edge.to) ? "Service" : "Package";
    await executeHydraQuery(connection, namespace,
      `MERGE (s:${sourceLabel} {id: ${blastCutVertexId(edge.from, fixture)}})-[:${edge.kind}]->(d:${targetLabel} {id: ${blastCutVertexId(edge.to, fixture)}})`);
  }
}

export function removalQuery(edge: DependencyEdge, fixture: GraphFixture = createDemoFixture()): string {
  return `MATCH (s {id: ${blastCutVertexId(edge.from, fixture)}})-[r:${edge.kind}]->(d {id: ${blastCutVertexId(edge.to, fixture)}}) DELETE r`;
}

function pathExternalId(value: unknown, location: string): string {
  if (!isRecord(value) || typeof value.id !== "number") throw new Error(`HydraDB path ${location} has no numeric id`);
  const fixture = createDemoFixture();
  const externalId = fixture.services.find((service) => blastCutVertexId(service.id, fixture) === value.id)?.id
    ?? fixture.packages.find((pkg) => blastCutVertexId(pkg.id, fixture) === value.id)?.id;
  if (!externalId) throw new Error(`HydraDB path ${location} contains an unknown BlastCut id ${value.id}`);
  return externalId;
}

function pathRelationshipId(value: unknown, location: string): string {
  if (!isRecord(value) || typeof value.edge_type !== "string" || typeof value.src !== "number" || typeof value.dst !== "number") {
    throw new Error(`HydraDB path ${location} lacks edge type or endpoint ids`);
  }
  const fixture = createDemoFixture();
  const edge = fixture.edges.find((candidate) => candidate.kind === value.edge_type
    && blastCutVertexId(candidate.from, fixture) === value.src
    && blastCutVertexId(candidate.to, fixture) === value.dst);
  if (!edge) throw new Error(`HydraDB path ${location} contains an unknown BlastCut relationship`);
  return edge.id;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
