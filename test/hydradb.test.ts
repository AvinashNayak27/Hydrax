import assert from "node:assert/strict";
import test from "node:test";
import { blastCutVertexId, decodeHydraPaths, executeHydraQuery, hydraPathQuery, seedHydraDbFixture, temporalFixtureEdges, type HydraHttpResponse } from "../src/hydradb.js";

test("HydraDB query uses valid literal integer SPpaths arguments", () => {
  const query = hydraPathQuery(blastCutVertexId("checkout-api"), blastCutVertexId("pkg:tanstack-router:1.120.7"), 3, 4);
  assert.match(query, /algo\.SPpaths\(\{sourceNode: 1, targetNode: 1001,/);
  assert.match(query, /pathCount: 4, resultLimit: 4/);
  assert.doesNotMatch(query, /\$/);
});

test("HydraDB tagged path response decodes seeded external identities", () => {
  const response: HydraHttpResponse = {
    columns: ["path"],
    rows: [[{
      type: "path",
      value: {
        nodes: [
          { id: 1, labels: ["Service"], properties: {} },
          { id: 1002, labels: ["Package"], properties: {} },
          { id: 1001, labels: ["Package"], properties: {} },
        ],
        relationships: [
          { id: 1, edge_type: "DEPLOYS", src: 1, dst: 1002, properties: {} },
          { id: 2, edge_type: "DEPENDS_ON", src: 1002, dst: 1001, properties: {} },
        ],
      },
    }]],
  };
  assert.deepEqual(decodeHydraPaths(response, "checkout-api", 3), [{
    serviceId: "checkout-api",
    nodeIds: ["checkout-api", "pkg:tanstack-start:1.120.7", "pkg:tanstack-router:1.120.7"],
    edgeIds: ["deploy:checkout-api", "dep:tanstack-start:router"],
    reachesBound: false,
  }]);
});

test("before and after seeded temporal graphs exclude incident dependency edges", () => {
  for (const phase of ["before", "after"] as const) {
    assert(!temporalFixtureEdges(phase).some((edge) => edge.id === "dep:tanstack-start:router"));
    assert(!temporalFixtureEdges(phase).some((edge) => edge.id === "dep:legacy-metrics:router"));
  }
});

test("HydraDB seed is idempotent, typed, and excludes missing-lockfile deployment evidence", async () => {
  const originalFetch = globalThis.fetch;
  const writes: string[] = [];
  globalThis.fetch = async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)).query);
    return new Response(JSON.stringify({ columns: [], rows: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await seedHydraDbFixture({ baseUrl: "https://graph.example", token: "test-token" }, "blastcut-evidence", "during");
    assert(writes.length > 0);
    assert(writes.every((query) => query.startsWith("MERGE ")));
    assert(writes.some((query) => query.includes("(s:Service {id: 1})-[:DEPLOYS]->(d:Package {id: 1002})")));
    assert(!writes.some((query) => query.includes("{id: 5})-[:DEPLOYS]")), "missing ledger-export inventory must not be asserted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("HydraDB adapter posts an explicit bounded SPpaths request with namespace isolation", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { url: String(input), init: init ?? {} };
    return new Response(JSON.stringify({ columns: ["path"], rows: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const query = hydraPathQuery(7, 1001, 16, 31);
    await executeHydraQuery({ baseUrl: "https://graph.example/", token: "test-token" }, "scenario-42", query, 125);
    assert.equal(captured?.url, "https://graph.example/v1/graphs/blastcut/query");
    assert.deepEqual(captured?.init.headers, {
      Authorization: "Bearer test-token",
      "X-Graph-Namespace": "scenario-42",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(captured?.init.body));
    assert.deepEqual(body, { cell_id: "cell-0", consistency: "strong", timeout_ms: 125, query });
    assert.match(query, /CALL algo\.SPpaths/);
    assert.match(query, /sourceNode: 7/);
    assert.match(query, /targetNode: 1001/);
    assert.match(query, /maxLen: 16/);
    assert.doesNotMatch(query, /\$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { HydraDbGraphEngine } from "../src/engine.js";

test("live before and after fail closed without phase-scoped evidence", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("must not query a during-only namespace"); };
  try {
    const engine = new HydraDbGraphEngine("https://graph.example", "token");
    for (const phase of ["before", "after"] as const) {
      const result = await engine.analyze("during-only", phase);
      assert.equal(result.engineMode, "hydradb");
      assert(result.analyses.every((item) => item.state === "unknown" && item.unknownReason === "phase-unavailable"));
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
