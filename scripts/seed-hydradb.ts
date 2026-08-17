import { seedHydraDbFixture } from "../src/hydradb.js";
import type { SnapshotPhase } from "../src/types.js";

const baseUrl = process.env.HYDRADB_URL;
const token = process.env.HYDRADB_TOKEN;
const namespace = process.env.HYDRADB_NAMESPACE ?? "blastcut-evidence";
const phase = (process.env.BLASTCUT_PHASE ?? "during") as SnapshotPhase;

if (!baseUrl || !token) throw new Error("HYDRADB_URL and HYDRADB_TOKEN are required");
if (phase !== "before" && phase !== "during" && phase !== "after") throw new Error("BLASTCUT_PHASE must be before, during, or after");

await seedHydraDbFixture({ baseUrl, token }, namespace, phase);
console.log(`seeded BlastCut ${phase} evidence into HydraDB namespace ${namespace}`);
