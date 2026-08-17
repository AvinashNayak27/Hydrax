import type { DependencyEdge, PackageNode } from "./types.js";

export interface ParsedLockfile {
  lockfileVersion: 2 | 3;
  packages: PackageNode[];
  edges: DependencyEdge[];
}

type LockPackage = { version?: string; dependencies?: Record<string, string> };
type Lockfile = { lockfileVersion: number; name?: string; packages?: Record<string, LockPackage> };

/**
 * Parses npm package-lock v2/v3 `packages` entries rather than collapsing by
 * name/version. The absolute package location is retained as `lockOccurrence`,
 * so duplicate nested copies remain distinct graph edges.
 */
export function parsePackageLock(lock: unknown, serviceId: string): ParsedLockfile {
  const file = lock as Lockfile;
  if ((file.lockfileVersion !== 2 && file.lockfileVersion !== 3) || !file.packages) {
    throw new Error("Only npm package-lock v2/v3 with a packages map is supported");
  }
  const entries = Object.entries(file.packages).filter(([path]) => path !== "");
  const packages: PackageNode[] = [];
  const byPath = new Map<string, PackageNode>();

  for (const [path, data] of entries) {
    if (!data.version) continue;
    const name = packageNameFromPath(path);
    const node: PackageNode = {
      id: `${serviceId}:pkg:${path}`,
      name,
      version: data.version,
      scope: name.startsWith("@") ? "private" : "public",
    };
    packages.push(node);
    byPath.set(path, node);
  }

  const edges: DependencyEdge[] = [];
  for (const [path, data] of entries) {
    const from = byPath.get(path);
    if (!from) continue;
    for (const dependencyName of Object.keys(data.dependencies ?? {}).sort()) {
      const targetPath = resolveDependencyPath(path, dependencyName, byPath);
      const target = targetPath ? byPath.get(targetPath) : undefined;
      if (!target) continue;
      edges.push({
        id: `${serviceId}:depends:${path}->${targetPath}`,
        from: from.id,
        to: target.id,
        kind: "DEPENDS_ON",
        packageName: target.name,
        packageVersion: target.version,
        lockOccurrence: targetPath,
      });
    }
  }
  return { lockfileVersion: file.lockfileVersion, packages, edges };
}

function packageNameFromPath(path: string): string {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return path;
  return path.slice(index + marker.length);
}

function resolveDependencyPath(fromPath: string, name: string, candidates: Map<string, PackageNode>): string | undefined {
  let current = fromPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
    if (candidates.has(candidate)) return candidate;
    const marker = "/node_modules/";
    const parent = current.lastIndexOf(marker);
    if (parent < 0) break;
    current = current.slice(0, parent);
  }
  return candidates.has(`node_modules/${name}`) ? `node_modules/${name}` : undefined;
}
