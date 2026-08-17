import { demoFixture } from './demoFixture';
import type {
  BlastCutApi,
  Classification,
  IncidentUiContract,
  QueryEvidence,
} from './contracts';

const namespace = import.meta.env.VITE_BLASTCUT_NAMESPACE ?? 'blastcut-production';
const apiBase = import.meta.env.VITE_BLASTCUT_API_URL?.replace(/\/$/, '') ?? '';

export class UiContractError extends Error {}

async function fetchApi(): Promise<IncidentUiContract> {
  const response = await fetch(`${apiBase}/v1/incident`, {
    headers: {
      Accept: 'application/json',
      'X-Graph-Namespace': namespace,
    },
  });
  if (!response.ok) {
    throw new Error(`Incident API returned ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isIncidentUiContract(payload)) {
    throw new UiContractError('Incident API returned an invalid unified UI contract');
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isString(value: unknown): value is string { return typeof value === 'string'; }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function isNullableNonNegativeInteger(value: unknown): value is number | null { return value === null || isNonNegativeInteger(value); }
function isClassification(value: unknown): value is Classification { return value === 'confirmed' || value === 'unknown' || value === 'unaffected'; }
function isEvidence(value: unknown): value is QueryEvidence {
  if (!isRecord(value) || (value.availability !== 'available' && value.availability !== 'unavailable')) return false;
  if (value.availability === 'unavailable') return value.queryText === undefined && value.durationMs === undefined && (value.integrity === undefined || value.integrity === 'unavailable');
  return isString(value.queryText) && isString(value.snapshot) && typeof value.durationMs === 'number' && value.durationMs >= 0 && value.integrity === 'verified';
}

/** Reject partial/legacy payloads instead of presenting them as trusted UI state. */
export function isIncidentUiContract(value: unknown): value is IncidentUiContract {
  if (!isRecord(value) || value.contractVersion !== 1 || (value.engineMode !== 'hydradb' && value.engineMode !== 'fixture')) return false;
  if (!isRecord(value.incident) || !isRecord(value.inventory) || !Array.isArray(value.services) || !isEvidence(value.evidence)) return false;
  const incident = value.incident;
  const inventory = value.inventory;
  if (![incident.id, incident.title, incident.severity, incident.ecosystem, incident.advisory, incident.windowStart, incident.windowEnd, incident.detectedAt, incident.source].every(isString)) return false;
  if (!isNonNegativeInteger(incident.affectedPackageCount) || !isNonNegativeInteger(incident.affectedVersionCount)) return false;
  if (![inventory.totalServices, inventory.confirmedServices, inventory.unknownServices, inventory.unaffectedServices].every(isNonNegativeInteger)) return false;
  if (!isNullableNonNegativeInteger(inventory.historicalPathCount) || !isNullableNonNegativeInteger(inventory.currentPathCount) || typeof inventory.exactPathCounts !== 'boolean') return false;
  const totalServices = inventory.totalServices;
  const confirmedServices = inventory.confirmedServices;
  const unknownServices = inventory.unknownServices;
  const unaffectedServices = inventory.unaffectedServices;
  if (!isNonNegativeInteger(totalServices) || !isNonNegativeInteger(confirmedServices) || !isNonNegativeInteger(unknownServices) || !isNonNegativeInteger(unaffectedServices)) return false;
  if (totalServices !== confirmedServices + unknownServices + unaffectedServices) return false;
  if (!value.services.every((service) => isRecord(service)
    && isString(service.id) && isString(service.name) && isString(service.owner)
    && isClassification(service.classification)
    && isNullableNonNegativeInteger(service.historicalPaths)
    && isNullableNonNegativeInteger(service.currentPaths))) return false;
  return true;
}

export const api: BlastCutApi = { getIncident: fetchApi };

export async function loadIncident(): Promise<{ analysis: IncidentUiContract; mode: 'api' | 'demo' }> {
  try {
    return { analysis: await api.getIncident(), mode: 'api' };
  } catch (error) {
    if (import.meta.env.VITE_BLASTCUT_DISABLE_DEMO_FIXTURE === 'true') throw error;
    return { analysis: demoFixture, mode: 'demo' };
  }
}
