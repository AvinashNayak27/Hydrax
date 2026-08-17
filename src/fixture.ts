import type { DependencyEdge, GraphFixture, PackageNode, Service, TemporalSnapshot } from "./types.js";

const INCIDENT = {
  id: "tanstack-2026-05-11",
  advisory: "GHSA-g7cv-rxg3-hmpx" as const,
  detectedAt: "2026-05-11T19:20:00.000Z",
  window: { start: "2026-05-11T19:20:00.000Z", end: "2026-05-11T19:26:00.000Z" },
  maliciousPackages: 42,
  maliciousVersions: 84,
  target: { name: "tanstack-router", version: "1.120.7" },
};

const NAMES = [
  "checkout-api", "billing-worker", "account-sync", "web-storefront", "ledger-export", "risk-scorer",
  "profile-read", "catalog-api", "search-indexer", "fulfillment-api", "notification-worker", "auth-gateway",
  "orders-api", "inventory-worker", "shipping-api", "returns-api", "pricing-api", "promotions-api",
  "customer-api", "analytics-worker", "fraud-api", "tax-api", "reporting-api", "support-api", "media-api",
];
const OWNERS = ["Payments", "Revenue Systems", "Identity", "Commerce", "Finance Platform"];

function service(id: string, index: number): Service {
  return { id, owner: OWNERS[index % OWNERS.length]!, production: true, lockfile: index === 4 ? "missing" : index % 2 ? "v3" : "v2" };
}

function pkg(id: string, name: string, version: string, malicious = false): PackageNode {
  return { id, name, version, scope: name.startsWith("@") ? "private" : "public", malicious };
}

export function createDemoFixture(namespace = "blastcut-demo"): GraphFixture {
  const services = Array.from({ length: 25 }, (_, index) => service(NAMES[index]!, index));
  const packages: PackageNode[] = [
    pkg("pkg:tanstack-router:1.120.7", "tanstack-router", "1.120.7", true),
    pkg("pkg:tanstack-start:1.120.7", "tanstack-start", "1.120.7"),
    pkg("pkg:legacy-metrics:1.9.2", "legacy-metrics", "1.9.2"),
    pkg("pkg:web-runtime:4.2.0", "web-runtime", "4.2.0"),
  ];
  const edges: DependencyEdge[] = [];
  for (const [index, current] of services.entries()) {
    edges.push({ id: `deploy:${current.id}`, from: current.id, to: index < 18 ? "pkg:tanstack-start:1.120.7" : "pkg:web-runtime:4.2.0", kind: "DEPLOYS" });
  }
  edges.push(
    { id: "dep:tanstack-start:router", from: "pkg:tanstack-start:1.120.7", to: "pkg:tanstack-router:1.120.7", kind: "DEPENDS_ON", packageName: "tanstack-router", packageVersion: "1.120.7", lockOccurrence: "node_modules/tanstack-router" },
    { id: "dep:legacy-metrics:router", from: "pkg:legacy-metrics:1.9.2", to: "pkg:tanstack-router:1.120.7", kind: "DEPENDS_ON", packageName: "tanstack-router", packageVersion: "1.120.7", lockOccurrence: "node_modules/legacy-metrics/node_modules/tanstack-router" },
  );
  for (const index of [14, 15, 16, 17]) {
    edges.push({ id: `deploy-legacy:${services[index]!.id}`, from: services[index]!.id, to: "pkg:legacy-metrics:1.9.2", kind: "DEPLOYS" });
  }
  const snapshots: TemporalSnapshot[] = [
    snapshot("before", "2026-05-11T19:19:59.999Z", namespace),
    snapshot("during", "2026-05-11T19:23:00.000Z", namespace),
    snapshot("after", "2026-05-11T19:26:00.001Z", namespace),
  ];
  return { incident: INCIDENT, services, packages, edges, snapshots };
}

function snapshot(phase: TemporalSnapshot["phase"], capturedAt: string, namespace: string): TemporalSnapshot {
  return { phase, capturedAt, namespace, checksum: `sha256:blastcut-${phase}-20260511` };
}
