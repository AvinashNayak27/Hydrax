import { FixtureGraphEngine, HydraDbGraphEngine, type GraphEngine } from "./engine.js";
import { planContainment } from "./planner.js";
import { MAX_PATH_LENGTH, type BoundedQueryResult, type QueryLimits, type SnapshotPhase, type VerificationResult } from "./types.js";

export function createApp(engine: GraphEngine = configuredEngine()) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return json({ ok: true, engineMode: engine.mode, hydraDbDuringExercised: true, supportedLivePhases: ["during"], counterfactualVerification: "namespace-authorization-required" });
    }
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (!["/v1/analysis", "/v1/witness", "/v1/containment", "/v1/verify", "/v1/incident"].includes(url.pathname)) return json({ error: "not found" }, 404);
    const namespace = request.headers.get("X-Graph-Namespace");
    if (!namespace) return json({ error: "X-Graph-Namespace is required for scenario isolation" }, 400);
    try {
      const phase = readPhase(url.searchParams.get("phase"));
      const limits = readLimits(url.searchParams);
      if (url.pathname === "/v1/verify") return json(await verify(engine, namespace, phase, limits));
      const analysis = await engine.analyze(namespace, phase, limits);
      if (url.pathname === "/v1/analysis") return json(analysis);
      if (url.pathname === "/v1/witness") {
        const serviceId = url.searchParams.get("serviceId");
        if (!serviceId) return json({ error: "serviceId is required" }, 400);
        const service = analysis.analyses.find((item) => item.serviceId === serviceId);
        return service ? json({ engineMode: analysis.engineMode, queryText: analysis.queryText, snapshot: analysis.snapshot, service }) : json({ error: "service not found" }, 404);
      }
      const plan = planFrom(analysis);
      if (url.pathname === "/v1/containment") return json({ engineMode: analysis.engineMode, queryText: analysis.queryText, snapshot: analysis.snapshot, plan, exact: false });
      // An incident overview remains useful when the separately authorized
      // counterfactual namespace is unavailable. Direct /v1/verify retains its
      // error response so operators can distinguish failed verification.
      let verification: VerificationResult;
      try {
        verification = await verify(engine, namespace, phase, limits, analysis, plan);
      } catch (error) {
        verification = unavailableVerification(analysis, plan, verificationFailureReason(error));
      }
      return json(incidentContract(analysis, plan, verification));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      const status = /HydraDB|unexercised/.test(message) ? 503 : 400;
      return json({ error: message, engineMode: engine.mode }, status);
    }
  };
}

async function verify(engine: GraphEngine, namespace: string, phase: SnapshotPhase, limits: QueryLimits, knownBefore?: BoundedQueryResult, knownPlan?: ReturnType<typeof planFrom>): Promise<VerificationResult> {
  const before = knownBefore ?? await engine.analyze(namespace, phase, limits);
  const plan = knownPlan ?? planFrom(before);
  // This is an edge-removal counterfactual of the *same immutable phase*, never
  // a shortcut to the post-incident snapshot. A distinct namespace prevents the
  // live adapter's removal writes from changing the source evidence namespace.
  const after = await engine.analyze(`${namespace}-verification`, phase, limits, new Set(plan.weighted.flatMap((action) => action.edgeIds)));
  const reasons: string[] = [];
  if (!trusted(before)) reasons.push("before analysis is untrusted (unknown or saturated)");
  if (!trusted(after)) reasons.push("after analysis is untrusted (unknown or saturated)");
  if (!plan.feasible || plan.coveredPaths !== plan.totalPaths) reasons.push("plan does not cover every trusted witness path");
  if (after.analyses.some((item) => item.state === "exposed")) reasons.push("residual exposure remains");
  return { before, after, plan, verified: reasons.length === 0, verificationReasons: reasons };
}

function planFrom(analysis: BoundedQueryResult) { return planContainment(analysis.analyses.flatMap((item) => item.paths ?? [])); }
function trusted(analysis: BoundedQueryResult): boolean { return !analysis.saturated && analysis.analyses.every((item) => item.state !== "unknown"); }

function unavailableVerification(before: BoundedQueryResult, plan: ReturnType<typeof planFrom>, reason: string): VerificationResult {
  const after: BoundedQueryResult = {
    ...before,
    snapshot: { ...before.snapshot, namespace: `${before.snapshot.namespace}-verification` },
    analyses: before.analyses.map((item) => ({
      serviceId: item.serviceId,
      owner: item.owner,
      lockfile: item.lockfile,
      state: "unknown" as const,
      unknownReason: "unsupported" as const,
    })),
  };
  return { before, after, plan, verified: false, verificationReasons: [reason] };
}

function verificationFailureReason(error: unknown): string {
  const detail = error instanceof Error ? error.message : "unexpected verification failure";
  return `counterfactual verification unavailable: ${detail}`;
}

function incidentContract(analysis: BoundedQueryResult, plan: ReturnType<typeof planFrom>, verification: VerificationResult) {
  const count = (state: string) => analysis.analyses.filter((item) => item.state === state).length;
  const trustedCounts = trusted(analysis);
  const knownPathCount = trustedCounts ? analysis.analyses.reduce((total, item) => total + (item.pathCount ?? 0), 0) : null;
  const evidence = { availability: "unavailable", integrity: "unavailable", timing: "unavailable", proof: "unavailable" };
  const exposed = analysis.analyses.filter((item) => item.state === "exposed");
  const first = exposed[0];
  return {
    contractVersion: 1,
    engineMode: analysis.engineMode,
    incident: {
      id: "tanstack-2026-05-11", title: "TanStack package compromise", severity: "critical", ecosystem: "npm",
      advisory: "GHSA-g7cv-rxg3-hmpx", affectedPackageCount: 42, affectedVersionCount: 84,
      windowStart: "2026-05-11T19:20:00.000Z", windowEnd: "2026-05-11T19:26:00.000Z", detectedAt: "2026-05-11T19:20:00.000Z", source: analysis.engineMode === "hydradb" ? "hydradb-during-exercised" : "deterministic-fixture",
      phase: analysis.snapshot.phase, snapshot: analysis.snapshot,
    },
    inventory: {
      totalServices: analysis.analyses.length, confirmedServices: count("exposed"), unknownServices: count("unknown"), unaffectedServices: count("unaffected"),
      historicalPathCount: knownPathCount, currentPathCount: knownPathCount, exactPathCounts: trustedCounts,
    },
    services: analysis.analyses.map((item) => ({
      id: item.serviceId, name: item.serviceId, owner: item.owner ?? "unavailable", deployedPackage: item.lockfile ? `package-lock ${item.lockfile}` : undefined,
      classification: item.state === "exposed" ? "confirmed" : item.state,
      historicalPaths: trustedCounts ? item.pathCount ?? null : null, currentPaths: trustedCounts ? item.pathCount ?? null : null, inventoryReason: item.unknownReason,
    })),
    witness: first ? {
      serviceId: first.serviceId, serviceName: first.serviceId, owner: first.owner ?? "unavailable", classification: "confirmed", pathNumber: 1, totalPaths: first.pathCount ?? null,
      nodes: (first.paths?.[0]?.nodeIds ?? []).map((id, index) => ({ kind: index === 0 ? "Service" : index === (first.paths?.[0]?.nodeIds.length ?? 0) - 1 ? "Package" : "Package", label: id, detail: id, edge: index ? first.paths?.[0]?.edgeIds[index - 1] : undefined, malicious: index === (first.paths?.[0]?.nodeIds.length ?? 0) - 1 })),
      evidence,
    } : undefined,
    plan: {
      status: plan.feasible ? "feasible" : "infeasible", actions: plan.weighted.map((item) => ({
        id: item.id, title: item.id, from: item.edgeIds.join(","), to: "removed", description: "Counterfactual edge removal only",
        coveredPaths: trustedCounts ? analysis.analyses.flatMap((entry) => entry.paths ?? []).filter((path) => item.edgeIds.some((edge) => path.edgeIds.includes(edge))).length : null,
        affectedServices: item.affectedServices.length, changes: 1, restarts: item.affectedServices.length, cost: item.cost,
        costs: { base: 1, semver: item.semverRisk, scope: item.scopeRisk, coordination: item.coordinationCost },
      })), coveredPaths: trustedCounts ? plan.coveredPaths : null, totalPaths: trustedCounts ? plan.totalPaths : null,
      exactCoverage: trustedCounts && plan.feasible, evidence, reason: plan.feasible ? undefined : "candidate actions do not cover all trusted paths",
    },
    verification: {
      status: verification.verified ? "verified" : verification.after.analyses.some((item) => item.state === "exposed") ? "failed" : "unknown",
      complete: verification.verified, before: { services: count("exposed"), paths: knownPathCount },
      after: { services: verification.after.analyses.filter((item) => item.state === "exposed").length, paths: trusted(verification.after) ? verification.after.analyses.reduce((total, item) => total + (item.pathCount ?? 0), 0) : null },
      evaluatedServices: verification.after.analyses.length, coverage: trustedCounts ? `${plan.coveredPaths}/${plan.totalPaths}` : null,
      evidence, reason: verification.verificationReasons.join("; ") || undefined,
    },
    evidence, queryText: analysis.queryText,
  };
}

function configuredEngine(): GraphEngine {
  const baseUrl = process.env.HYDRADB_URL;
  const token = process.env.HYDRADB_TOKEN;
  return baseUrl && token ? new HydraDbGraphEngine(baseUrl, token) : new FixtureGraphEngine();
}
function readPhase(value: string | null): SnapshotPhase { if (!value || value === "during") return "during"; if (value === "before" || value === "after") return value; throw new Error("phase must be before, during, or after"); }
function readLimits(params: URLSearchParams): QueryLimits {
  const positiveInteger = (key: string): number | undefined => {
    if (!params.has(key)) return undefined;
    const raw = params.get(key) ?? "";
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive finite integer`);
    return value;
  };
  const maxLen = positiveInteger("maxLen");
  if (maxLen !== undefined && maxLen > MAX_PATH_LENGTH) throw new Error(`maxLen must be 1-${MAX_PATH_LENGTH}`);
  const admission = params.get("admission");
  if (admission !== null && admission !== "allow" && admission !== "deny") throw new Error("admission must be allow or deny");
  return { maxLen, pathBudget: positiveInteger("pathBudget"), deadlineMs: positiveInteger("deadlineMs"), admissionAllowed: admission !== "deny" };
}
function corsHeaders(): HeadersInit { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Graph-Namespace", "Vary": "Origin" }; }
function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...corsHeaders() } }); }
