import assert from "node:assert/strict";
import test from "node:test";
import { action, planContainment } from "../src/planner.js";
import type { Witness } from "../src/types.js";

const path = (serviceId: string, edgeIds: string[]): Witness => ({ serviceId, edgeIds, nodeIds: [serviceId, "target"], reachesBound: false });

test("cost uses base + semver + scope + capped coordination", () => {
  const paths = Array.from({ length: 30 }, (_, index) => path(`svc-${index}`, ["edge"]));
  const candidate = action("cost", "patch", ["edge"], paths, 8, 2);
  assert.equal(candidate.coordinationCost, 2); assert.equal(candidate.cost, 13);
});
test("weighted ties are lexicographic by action id", () => {
  const paths = [path("s", ["edge"])];
  const z = action("z-action", "patch", ["edge"], paths, 0, 0);
  const a = action("a-action", "patch", ["edge"], paths, 0, 0);
  const plan = planContainment(paths, [z, a]);
  assert.deepEqual(plan.weighted.map((item) => item.id), ["a-action"]);
});
test("infeasible paths are surfaced and never marked exact", () => {
  const paths = [path("s", ["covered"]), path("other", ["uncovered"])];
  const plan = planContainment(paths, [action("only", "patch", ["covered"], paths, 0, 0)]);
  assert.equal(plan.feasible, false); assert.equal(plan.uncoveredPaths, 1); assert.equal(plan.exact, false);
  assert(plan.sensitivity.every((item) => item.feasible === false));
});
