import type { Action, ContainmentPlan, Witness } from "./types.js";

export function candidateActions(paths: Witness[]): Action[] {
  const first = paths.filter((path) => path.edgeIds.includes("dep:tanstack-start:router"));
  const second = paths.filter((path) => path.edgeIds.includes("dep:legacy-metrics:router"));
  return [
    action("override-tanstack-start-router", "override", ["dep:tanstack-start:router"], first, 2, 0),
    action("patch-legacy-metrics-router", "patch", ["dep:legacy-metrics:router"], second, 0, 0),
  ];
}

export function action(id: string, kind: Action["kind"], edgeIds: string[], paths: Witness[], semverRisk: 0 | 2 | 8, scopeRisk: 0 | 2): Action {
  const affectedServices = [...new Set(paths.filter((path) => edgeIds.some((edge) => path.edgeIds.includes(edge))).map((path) => path.serviceId))].sort();
  const coordinationCost = Math.min(2, affectedServices.length * 0.1);
  return { id, kind, edgeIds, affectedServices, semverRisk, scopeRisk, coordinationCost, cost: 1 + semverRisk + scopeRisk + coordinationCost };
}

/** Weighted greedy set cover with deterministic action-id ties and infeasibility reporting. */
export function planContainment(paths: Witness[], actions = candidateActions(paths)): ContainmentPlan {
  const weightedResult = choose(paths, actions, true);
  const baselineResult = choose(paths, actions, false);
  const coveredPaths = paths.length - weightedResult.remaining.size;
  return {
    weighted: weightedResult.chosen,
    unweightedBaseline: baselineResult.chosen,
    coveredPaths,
    totalPaths: paths.length,
    exact: false, // Greedy is transparent; it does not certify a minimum cut.
    feasible: weightedResult.remaining.size === 0,
    uncoveredPaths: weightedResult.remaining.size,
    sensitivity: [0.5, 1, 1.5].map((multiplier) => {
      const result = choose(paths, actions.map((item) => ({ ...item, cost: item.cost * multiplier })), true);
      return { multiplier, actions: result.chosen.map((item) => item.id), totalCost: Number(result.chosen.reduce((sum, item) => sum + item.cost, 0).toFixed(2)), feasible: result.remaining.size === 0 };
    }),
  };
}

function choose(paths: Witness[], actions: Action[], weighted: boolean): { chosen: Action[]; remaining: Set<string> } {
  const remaining = new Set(paths.map(pathKey));
  const chosen: Action[] = [];
  while (remaining.size) {
    const candidates = actions.map((action) => ({ action, cover: paths.filter((path) => remaining.has(pathKey(path)) && covers(action, path)).length }))
      .filter((item) => item.cover > 0)
      .sort((a, b) => weighted
        ? (a.action.cost / a.cover) - (b.action.cost / b.cover) || a.action.id.localeCompare(b.action.id)
        : b.cover - a.cover || a.action.id.localeCompare(b.action.id));
    const next = candidates[0];
    if (!next) break;
    chosen.push(next.action);
    for (const path of paths) if (covers(next.action, path)) remaining.delete(pathKey(path));
  }
  return { chosen, remaining };
}

export function covers(action: Action, path: Witness): boolean { return action.edgeIds.some((edge) => path.edgeIds.includes(edge)); }
export function pathKey(path: Witness): string { return path.edgeIds.join(">"); }
