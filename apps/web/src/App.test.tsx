import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./lib/api', () => ({ loadIncident: vi.fn() }));

import { loadIncident } from './lib/api';
import { demoFixture } from './lib/demoFixture';
import type { IncidentUiContract } from './lib/contracts';

const mockLoadIncident = vi.mocked(loadIncident);
const apiContract: IncidentUiContract = {
  contractVersion: 1,
  engineMode: 'hydradb',
  incident: {
    id: 'incident-api-01', title: 'API-supplied incident', severity: 'SEV-2', ecosystem: 'npm', advisory: 'GHSA-test',
    affectedPackageCount: 3, affectedVersionCount: 4, windowStart: '2026-05-11T19:20:00.000Z', windowEnd: '2026-05-11T19:26:00.000Z', detectedAt: '2026-05-11T19:27:00.000Z', source: 'API test fixture',
  },
  inventory: { totalServices: 4, confirmedServices: 2, unknownServices: 1, unaffectedServices: 1, historicalPathCount: null, currentPathCount: null, exactPathCounts: false },
  services: [
    { id: 'api-service', name: 'api-service', owner: 'API Team', deployedPackage: 'api-package@1.0.0', classification: 'confirmed', historicalPaths: null, currentPaths: null, lockPath: 'node_modules/api-package' },
    { id: 'api-unknown', name: 'api-unknown', owner: 'API Team', classification: 'unknown', historicalPaths: null, currentPaths: null, inventoryReason: 'truncated upstream response' },
    { id: 'api-clear', name: 'api-clear', owner: 'Platform', classification: 'unaffected', historicalPaths: null, currentPaths: null },
  ],
  evidence: { availability: 'available', queryText: 'CALL algo.SSpaths($bounded)', snapshot: '2026-05-11T19:27:00.000Z', durationMs: 12.5, integrity: 'verified', truncated: true },
};

describe('BlastCut console', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the unified API contract without substituting metrics, services, or owners', async () => {
    mockLoadIncident.mockResolvedValue({ analysis: apiContract, mode: 'api' });
    render(<App />);
    expect(await screen.findByText('live API analysis')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /API-supplied incident containment review/i })).toBeInTheDocument();
    expect(screen.getByText('api-service')).toBeInTheDocument();
    expect(screen.getAllByText('API Team')).toHaveLength(2);
    expect(screen.getByText('4 production services')).toBeInTheDocument();
    expect(screen.getByText('3 packages · 4 malicious versions', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText(/Truncated result — exact path counts and verified containment are unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Containment unavailable/i })).toBeDisabled();
  });

  it('labels deterministic fallback and withholds fake proof, duration, integrity, and exact path counts', async () => {
    mockLoadIncident.mockResolvedValue({ analysis: demoFixture, mode: 'demo' });
    render(<App />);
    expect(await screen.findByText('demo fixture mode')).toBeInTheDocument();
    expect(screen.getByText(/Verification evidence is unavailable for this analysis/i)).toBeInTheDocument();
    expect(screen.queryByText('Integrity')).not.toBeInTheDocument();
    expect(screen.queryByText('Query duration')).not.toBeInTheDocument();
    expect(screen.queryByText(/VERIFIED/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows current exposure separately from the historical live window', async () => {
    mockLoadIncident.mockResolvedValue({ analysis: demoFixture, mode: 'demo' });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Live window');
    await user.click(screen.getByRole('button', { name: 'Current' }));
    expect(screen.getByText('Current deployed exposure')).toBeInTheDocument();
  });
});
