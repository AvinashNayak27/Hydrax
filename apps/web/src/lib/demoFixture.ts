import type { IncidentUiContract } from './contracts';

/**
 * Preview-only fallback aligned to the backend's deterministic fixture graph.
 * It deliberately contains no query text, proof, duration, integrity, or exact
 * aggregate path claim; those values belong to the unified API response.
 */
export const demoFixture: IncidentUiContract = {
  contractVersion: 1,
  engineMode: 'fixture',
  incident: {
    id: 'tanstack-2026-05-11',
    title: 'TanStack npm compromise',
    severity: 'SEV-1',
    ecosystem: 'npm',
    advisory: 'GHSA-g7cv-rxg3-hmpx',
    affectedPackageCount: 42,
    affectedVersionCount: 84,
    windowStart: '2026-05-11T19:20:00.000Z',
    windowEnd: '2026-05-11T19:26:00.000Z',
    detectedAt: '2026-05-11T19:20:00.000Z',
    source: 'Deterministic local preview fixture — not live HydraDB analysis',
  },
  inventory: {
    totalServices: 25,
    confirmedServices: 17,
    unknownServices: 1,
    unaffectedServices: 7,
    historicalPathCount: null,
    currentPathCount: null,
    exactPathCounts: false,
  },
  services: [
    { id: 'checkout-api', name: 'checkout-api', owner: 'Payments', deployedPackage: 'tanstack-start@1.120.7', classification: 'confirmed', historicalPaths: null, currentPaths: null, lockPath: 'node_modules/tanstack-start' },
    { id: 'billing-worker', name: 'billing-worker', owner: 'Revenue Systems', deployedPackage: 'tanstack-start@1.120.7', classification: 'confirmed', historicalPaths: null, currentPaths: null, lockPath: 'node_modules/tanstack-start' },
    { id: 'account-sync', name: 'account-sync', owner: 'Identity', deployedPackage: 'tanstack-start@1.120.7', classification: 'confirmed', historicalPaths: null, currentPaths: null, lockPath: 'node_modules/tanstack-start' },
    { id: 'web-storefront', name: 'web-storefront', owner: 'Commerce', deployedPackage: 'tanstack-start@1.120.7', classification: 'confirmed', historicalPaths: null, currentPaths: null, lockPath: 'node_modules/tanstack-start' },
    { id: 'ledger-export', name: 'ledger-export', owner: 'Finance Platform', classification: 'unknown', historicalPaths: null, currentPaths: null, inventoryReason: 'lockfile inventory is missing; exposure cannot be safely classified' },
    { id: 'risk-scorer', name: 'risk-scorer', owner: 'Payments', deployedPackage: 'web-runtime@4.2.0', classification: 'unaffected', historicalPaths: null, currentPaths: null },
    { id: 'profile-read', name: 'profile-read', owner: 'Revenue Systems', deployedPackage: 'web-runtime@4.2.0', classification: 'unaffected', historicalPaths: null, currentPaths: null },
  ],
  evidence: { availability: 'unavailable' },
};
