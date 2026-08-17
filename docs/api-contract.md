# BlastCut API contract

All API routes use `GET`, return JSON, and require a non-empty `X-Graph-Namespace` except `/health`. Browser clients may use the same origin or the documented CORS preflight (`OPTIONS`); CORS permits `X-Graph-Namespace`.

## Route behavior

| Route | Purpose |
|---|---|
| `/health` | Liveness and engine mode; it does not analyze the graph. |
| `/v1/analysis` | Per-service typed, bounded analysis. |
| `/v1/witness?serviceId=…` | Evidence for one analyzed service. |
| `/v1/containment` | Weighted greedy and unweighted greedy containment candidates. |
| `/v1/verify` | Re-analyzes the **same requested phase** with selected edges removed. |
| `/v1/incident` | Unified UI contract derived from analysis, witness, plan, and verification. |

Unknown routes return `404` before namespace validation; invalid methods return `405`. Invalid input returns `400`; direct live query/verification failures return `503` rather than masquerading as fixture output. `/v1/incident` is the exception for a failed counterfactual: it preserves successful source analysis and reports verification as unknown.

## Bounded analysis and taxonomy

`phase` is `before`, `during` (default), or `after`. `maxLen`, `pathBudget`, and `deadlineMs` are positive finite integers; `maxLen` is capped at 16. `admission=allow|deny`; `deny` returns fail-closed unknown results.

`ServiceAnalysis.state` is `exposed`, `unaffected`, or `unknown`. `unknownReason` may be: `missing-inventory`, `phase-unavailable`, `unsupported`, `malformed`, `admission`, `deadline`, `budget`, `saturated`, `depth-truncated`, or `witness-at-bound`. A missing lockfile remains `missing-inventory` in every phase. `pathCount` is emitted only for completed, unsaturated service work; aggregate saturation clears unsafe path counts.

The live HydraDB adapter currently supports only a phase-authorized `during` namespace. It returns `phase-unavailable` for `before` and `after` without querying the live graph, because a during-seeded namespace is not temporal evidence for a different phase.

`/v1/verify` is `verified` only if before and after are both trusted (not saturated, no unknowns), the candidate plan covers every trusted witness path, and the same-phase counterfactual has zero residual exposure. The deterministic fixture intentionally has missing inventory, so it does not verify.

## Unified incident contract

`/v1/incident` responds with `contractVersion: 1` and fields used by the UI: incident metadata, inventory totals, service rows, an available witness (if any), plan, verification, and evidence. In fixture mode evidence is honestly `{ availability: "unavailable", integrity: "unavailable", timing: "unavailable", proof: "unavailable" }`; consumers must not invent timings, integrity, or proof identifiers. Counts are null where not trusted/exact.

If source analysis succeeds but counterfactual setup/query fails (for example, the `<namespace>-verification` namespace is unauthorized), `/v1/incident` still returns `200` with source analysis and plan. Its verification is `status: "unknown"`, `complete: false`, and an unavailable-evidence reason. Direct `/v1/verify` preserves the failure as `503` for operator visibility.

## HydraDB boundary

The adapter's exact request body is a JSON `POST /v1/graphs/blastcut/query` request with `cell_id: "cell-0"`, `consistency: "strong"`, and the actual `query` text. It sends `Authorization`, `Content-Type`, and `X-Graph-Namespace`. Query text uses valid `algo.SPpaths` syntax with literal integer `sourceNode`/`targetNode`, no unresolved Cypher parameters, and a bounded `maxLen`.

`npm run seed:hydradb` ingests the deterministic fixture with idempotent `MERGE` writes and stable numeric vertex ids. The adapter decodes only tagged `path` rows by mapping vertex ids and typed endpoints back to fixture identities, and never falls back to fixture traversal data. `/v1/verify` uses a distinct `<namespace>-verification` namespace seeded from the same requested phase before it removes selected evidence edges.

**Docker retest status:** the Docker build succeeded and a live `during` analysis was exercised: 17 exposed services, 7 unaffected services, 1 missing-inventory unknown service, and 21 bounded paths. The counterfactual verification namespace was unauthorized. These results do not establish live `before` or `after` evidence; those phases fail closed as `phase-unavailable`.

## Graph schema

- `Service { id, owner, production, lockfile }`
- `Package { id, name, version, scope, malicious }`
- `(:Service)-[:DEPLOYS]->(:Package)`
- `(:Package)-[:DEPENDS_ON { lockOccurrence, packageName, packageVersion }]->(:Package)`
- `(:Service)-[:REACHES]->(:Package)` is optional normalized ingestion-time reachability.

HydraDB property indexes are automatic. BlastCut has no `CREATE INDEX` statement and never invokes client `EXPLAIN`.
