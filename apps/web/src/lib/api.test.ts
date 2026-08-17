import { describe, expect, it, vi } from 'vitest';
import { api, isIncidentUiContract, loadIncident } from './api';
import { demoFixture } from './demoFixture';

const apiPayload = {
  contractVersion: 1,
  engineMode: 'hydradb',
  incident: {
    id: 'incident-1', title: 'Backend title', severity: 'SEV-2', ecosystem: 'npm', advisory: 'GHSA-test',
    affectedPackageCount: 3, affectedVersionCount: 4, windowStart: '2026-05-11T19:20:00.000Z', windowEnd: '2026-05-11T19:26:00.000Z', detectedAt: '2026-05-11T19:27:00.000Z', source: 'backend',
  },
  inventory: { totalServices: 2, confirmedServices: 1, unknownServices: 1, unaffectedServices: 0, historicalPathCount: null, currentPathCount: null, exactPathCounts: false },
  services: [
    { id: 'service-1', name: 'service-1', owner: 'Backend owner', classification: 'confirmed', historicalPaths: null, currentPaths: null },
    { id: 'service-2', name: 'service-2', owner: 'Backend owner', classification: 'unknown', historicalPaths: null, currentPaths: null },
  ],
  evidence: { availability: 'available', queryText: 'CALL algo.SSpaths($bounded)', snapshot: '2026-05-11T19:27:00.000Z', durationMs: 1.2, integrity: 'verified' },
};

describe('unified incident API', () => {
  it('accepts the unified /v1/incident shape and sends the scenario namespace', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(apiPayload), { status: 200 }));
    await expect(api.getIncident()).resolves.toMatchObject({ incident: { id: 'incident-1' }, inventory: { totalServices: 2 } });
    expect(fetchMock).toHaveBeenCalledWith('/v1/incident', expect.objectContaining({ headers: expect.objectContaining({ 'X-Graph-Namespace': 'blastcut-production' }) }));
    fetchMock.mockRestore();
  });

  it('rejects legacy/partial payloads and keeps fixture fallback explicitly unavailable', async () => {
    expect(isIncidentUiContract({ analyses: [] })).toBe(false);
    expect(demoFixture.evidence.availability).toBe('unavailable');
    expect(demoFixture.inventory.exactPathCounts).toBe(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ analyses: [] }), { status: 200 }));
    await expect(loadIncident()).resolves.toEqual({ analysis: demoFixture, mode: 'demo' });
    fetchMock.mockRestore();
  });
});
