import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const app = createApp();
function request(path: string, headers: HeadersInit = { "X-Graph-Namespace": "scenario-a" }, method = "GET") { return app(new Request(`http://blastcut${path}`, { headers, method })); }

test("health and 404 are routed before namespace validation or graph analysis", async () => {
  const health = await (await request("/health", {})).json() as { hydraDbDuringExercised: boolean; supportedLivePhases: string[] };
  assert.equal(health.hydraDbDuringExercised, true); assert.deepEqual(health.supportedLivePhases, ["during"]);
  assert.equal((await request("/not-a-route", {})).status, 404);
  assert.equal((await request("/health", {}, "POST")).status, 405);
});
test("analysis returns fixture mode, temporal snapshot, valid bounded SPpaths text, and CORS", async () => {
  const response = await request("/v1/analysis?phase=during&maxLen=16");
  const body = await response.json() as { engineMode: string; queryText: string; snapshot: { phase: string }; analyses: unknown[] };
  assert.equal(response.status, 200); assert.equal(body.engineMode, "fixture"); assert.equal(body.snapshot.phase, "during");
  assert.match(body.queryText, /algo\.SPpaths/); assert.match(body.queryText, /maxLen: 16/); assert.match(body.queryText, /relDirection: 'outgoing'/); assert.doesNotMatch(body.queryText, /\$/);
  assert.equal(body.analyses.length, 25); assert.equal(response.headers.get("access-control-allow-origin"), "*");
});
test("namespace is mandatory and all numeric limits are positive finite integers", async () => {
  assert.equal((await request("/v1/analysis", {})).status, 400);
  for (const value of ["0", "-1", "1.5", "Infinity", "wat"]) assert.equal((await request(`/v1/analysis?pathBudget=${value}`)).status, 400);
  assert.equal((await request("/v1/analysis?deadlineMs=0")).status, 400);
  assert.equal((await request("/v1/analysis?maxLen=17")).status, 400);
});
test("admission deny is explicit and fails closed", async () => {
  const body = await (await request("/v1/analysis?admission=deny")).json() as { analyses: { state: string; unknownReason?: string }[] };
  assert(body.analyses.every((item) => item.state === "unknown" && item.unknownReason === "admission"));
});
test("a non-target branch at maxLen is depth-truncated and fail-closed", async () => {
  const body = await (await request("/v1/analysis?maxLen=1")).json() as { analyses: { serviceId: string; state: string; unknownReason?: string }[] };
  const checkout = body.analyses.find((item) => item.serviceId === "checkout-api");
  assert.equal(checkout?.state, "unknown"); assert.equal(checkout?.unknownReason, "depth-truncated");
});
test("saturation and missing inventory suppress exact claims", async () => {
  const body = await (await request("/v1/analysis?pathBudget=1")).json() as { analyses: { state: string; pathCount?: number; unknownReason?: string }[] };
  assert(body.analyses.some((item) => item.unknownReason === "saturated"));
  assert(body.analyses.filter((item) => item.state === "unknown").every((item) => item.pathCount === undefined));
  const ordinary = await (await request("/v1/analysis")).json() as { analyses: { serviceId: string; state: string; unknownReason?: string }[] };
  assert.equal(ordinary.analyses.find((item) => item.serviceId === "ledger-export")?.unknownReason, "missing-inventory");
});
test("verification reuses the requested phase and refuses verification with missing inventory", async () => {
  const body = await (await request("/v1/verify?phase=during")).json() as {
    verified: boolean; before: { snapshot: { phase: string } }; after: { snapshot: { phase: string }; analyses: { state: string }[] }; verificationReasons: string[];
  };
  assert.equal(body.before.snapshot.phase, "during"); assert.equal(body.after.snapshot.phase, "during");
  assert.equal(body.after.analyses.filter((item) => item.state === "exposed").length, 0);
  assert.equal(body.verified, false); assert(body.verificationReasons.some((reason) => reason.includes("unknown")));
});
test("unified incident endpoint derives honest fixture evidence", async () => {
  const body = await (await request("/v1/incident")).json() as { engineMode: string; evidence: { integrity: string; timing: string; proof: string }; inventory: { unknownServices: number }; plan: { exactCoverage: boolean }; verification: { complete: boolean } };
  assert.equal(body.engineMode, "fixture"); assert.deepEqual(body.evidence, { availability: "unavailable", integrity: "unavailable", timing: "unavailable", proof: "unavailable" });
  assert.equal(body.inventory.unknownServices, 1); assert.equal(body.plan.exactCoverage, false); assert.equal(body.verification.complete, false);
});

class CounterfactualDeniedEngine {
  readonly mode = "hydradb" as const;
  async analyze(namespace: string, phase: "before" | "during" | "after", _limits?: unknown, removed = new Set<string>()) {
    if (removed.size > 0 || namespace.endsWith("-verification")) throw new Error("HydraDB query failed: 403 counterfactual namespace unauthorized");
    return {
      engineMode: this.mode,
      queryText: "CALL algo.SPpaths({sourceNode: 1, targetNode: 1001, relTypes: ['DEPENDS_ON'], maxLen: 16}) YIELD path RETURN path",
      saturated: false,
      snapshot: { phase, namespace, capturedAt: "2026-05-11T19:23:00.000Z", checksum: "sha256:test" },
      analyses: [{ serviceId: "checkout-api", state: "exposed" as const, pathCount: 1, paths: [{ serviceId: "checkout-api", nodeIds: ["checkout-api", "target"], edgeIds: ["cut"], reachesBound: false }] }],
    };
  }
}

test("incident preserves source analysis when live counterfactual namespace is unauthorized", async () => {
  const liveApp = createApp(new CounterfactualDeniedEngine());
  const response = await liveApp(new Request("http://blastcut/v1/incident", { headers: { "X-Graph-Namespace": "authorized" } }));
  const body = await response.json() as { engineMode: string; inventory: { confirmedServices: number }; verification: { status: string; complete: boolean; reason?: string }; evidence: { availability: string } };
  assert.equal(response.status, 200); assert.equal(body.engineMode, "hydradb"); assert.equal(body.inventory.confirmedServices, 1);
  assert.equal(body.verification.status, "unknown"); assert.equal(body.verification.complete, false);
  assert.match(body.verification.reason ?? "", /namespace unauthorized/); assert.equal(body.evidence.availability, "unavailable");
});

test("direct verification retains a 503 when the live counterfactual namespace is unauthorized", async () => {
  const liveApp = createApp(new CounterfactualDeniedEngine());
  const response = await liveApp(new Request("http://blastcut/v1/verify", { headers: { "X-Graph-Namespace": "authorized" } }));
  assert.equal(response.status, 503);
});
