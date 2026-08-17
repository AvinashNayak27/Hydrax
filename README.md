# BlastCut

BlastCut is a single TypeScript containment API for the **May 11, 2026 TanStack incident** (`GHSA-g7cv-rxg3-hmpx`): 42 affected packages / 84 malicious versions, with the incident window modelled from **19:20 through 19:26 UTC**.

It prioritizes a reproducible, bounded containment demonstration. It runs in explicit `fixture` mode by default; this is **not represented as HydraDB execution**. The checked-in HydraDB adapter has a real idempotent seed path, literal integer-node bounded queries, and a strict tagged-path response decoder; it never substitutes fixture rows for a live response. Docker-backed **during** analysis has been exercised; live temporal and counterfactual claims remain deliberately constrained as described below.

## Run

```bash
npm install
npm --prefix apps/web install
npm run check
npm test
npm --prefix apps/web test
npm run dev                         # API on :3000
npm --prefix apps/web run dev -- --host 0.0.0.0  # UI on :5173
```

The Vite development server proxies `/v1` to the API. Set `VITE_BLASTCUT_NAMESPACE` to the authorized HydraDB namespace (for the local seeded demo, `blastcut-evidence`).

Each API request must isolate its scenario with `X-Graph-Namespace`:

```bash
curl -s localhost:3000/v1/analysis?phase=during\&maxLen=16 \
  -H 'X-Graph-Namespace: demo-a'
curl -s localhost:3000/v1/containment -H 'X-Graph-Namespace: demo-a'
curl -s localhost:3000/v1/verify -H 'X-Graph-Namespace: demo-a'
```

## API

| Route | Result |
|---|---|
| `GET /v1/analysis` | Per-service state and bounded witnesses. `phase=before|during|after`; default is during. |
| `GET /v1/witness?serviceId=checkout-api` | One service's typed witness evidence. |
| `GET /v1/containment` | Weighted and unweighted-greedy action sets. |
| `GET /v1/verify` | Re-analyzes the same requested phase with selected counterfactual edge removals. |
| `GET /v1/incident` | Unified UI contract with backend-derived incident counts, witness, plan, verification, and evidence availability. |

Every analysis response returns `engineMode`, the temporal snapshot, and the **actual bounded query text**. There is no client `EXPLAIN`, and no `CREATE INDEX`: HydraDB automatic property indexes are relied upon. The generated query uses HydraDB's valid integer-node `algo.SPpaths` syntax, a hard `maxLen` ceiling of **16**, and relationship types.

## Safety contract

- An unknown result is fail-closed: admission rejection, deadline exhaustion, budget exhaustion, saturation, and a witness that reaches the length bound all produce `state: "unknown"` rather than a negative claim.
- Exact `pathCount` exists only on unsaturated, completed service traversals. Unknown taxonomy includes missing-inventory, unsupported, malformed, admission, deadline, budget, saturation, depth truncation, and bound-reaching witnesses.
- Package-lock v2/v3 parsing uses the `packages` map and keeps the package path in edge identity (`lockOccurrence`), preserving repeated nested package occurrences.
- The fixture is deterministic: 25 production services, v2/v3/missing-lockfile cases, three temporal locks, two reachability cut edges, and `fixtures/public-tanstack-package-lock-v3.json`, a public-package-lock fixture.

## Containment optimization

Candidate actions cut typed dependency edges. Weighted greedy set cover selects the action with the lowest `cost / newly-covered-paths`, then lexicographically by action id. Cost is:

```
1 + semver risk (0 / 2 / 8) + scope risk (0 / 2) + min(2, 0.1 × affected services)
```

The response also includes an unweighted greedy baseline and sensitivity at 0.5×, 1×, and 1.5× costs. Greedy output is not an optimality certificate (`exact: false`). Counterfactual verification re-analyzes the requested snapshot phase with selected edges removed. It is marked verified only when both analyses are trusted and unsaturated, neither has unknown inventory, the plan covers all trusted witnesses, and no exposure remains. The seed deliberately includes missing inventory, so its verification remains unverified.

## HydraDB adapter

HydraDB source was reviewed at `/code/hydradb` commit `6a2fbb1`. Its HTTP contract is `POST /v1/graphs/{graph}/query` with `Authorization`, `Content-Type`, and `X-Graph-Namespace`; the adapter uses that contract, `strong` consistency, and fixed `cell-0`. `algo.SPpaths` requires integer `sourceNode` and `targetNode`, so BlastCut assigns stable ids (services 1–25, packages 1001–1004) and issues one bounded single-pair traversal per service. It decodes only HydraDB's tagged `path` HTTP values by mapping vertex ids and typed endpoints back to fixture identities, and fails closed on malformed or unknown data.

Seed a namespace with idempotent OpenCypher `MERGE` writes (automatic id-property indexing; no index DDL):

```bash
HYDRADB_URL=http://127.0.0.1:18443 \
HYDRADB_TOKEN=local-dev-auth-token-32-characters-long \
HYDRADB_NAMESPACE=blastcut-evidence \
BLASTCUT_PHASE=during \
npm run seed:hydradb
```

The seed writes the selected temporal phase. `/v1/verify` uses a separate `<namespace>-verification` namespace, seeds it from the same requested phase, and removes only chosen relationship evidence. In fixture mode no HydraDB request is made.

**Execution status (Docker retest):** the HydraDB Docker build succeeded and live `during` analysis was exercised against the seeded authorized namespace. It returned **17 exposed, 7 unaffected, 1 missing-inventory unknown**, and **21 bounded paths**. This is evidence for `during` only.

Live `before` and `after` are currently fail-closed as `phase-unavailable`: the authorized live namespace contains the during-seeded graph and is not accepted as evidence for either other phase. No query is sent for those phases, preventing a during graph from being misreported as historical or post-incident state. Verification requires the separate `<namespace>-verification` counterfactual namespace; that namespace remained unauthorized in the retest. `/v1/incident` therefore preserves live analysis and returns verification `unknown`/`complete: false` with an honest unavailable-evidence reason, while direct `/v1/verify` remains `503` so operators see the authorization failure.

The graph schema is represented in `src/types.ts`: `Service`, `Package`, typed `DEPLOYS`/`DEPENDS_ON` relationships, plus a reserved normalized `REACHES` relationship for ingestion-time reachability materialization where desired.
