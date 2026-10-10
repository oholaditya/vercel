import type {
  ActivityBucket,
  Alert,
  AutomationRule,
  DeviceCommand,
  DeviceSnapshot,
  EventPriority,
  HubEvent,
  NumericMetric,
  PublicUser,
  SimulationScenario,
  SystemOverview,
  TelemetryPoint,
} from '@shared/types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: Array<{ path: string; message: string }>) {
    super(message);
  }
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  outcome: 'success' | 'denied' | 'failed';
  ip: string | null;
  detail: string | null;
}

export interface AdapterStatus {
  id: string;
  origin: string;
  connected: boolean;
  detail: string;
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Hub unreachable - check that the server is running');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: PublicUser }>('POST', '/auth/login', { username, password }),
  me: () => request<{ user: PublicUser }>('GET', '/auth/me'),

  devices: () => request<{ devices: DeviceSnapshot[] }>('GET', '/devices'),
  command: (id: string, command: DeviceCommand) =>
    request<{ device: DeviceSnapshot }>('POST', `/devices/${encodeURIComponent(id)}/commands`, command),
  history: (id: string, limit = 120) =>
    request<{ metric: NumericMetric; points: TelemetryPoint[] }>('GET', `/devices/${encodeURIComponent(id)}/history?limit=${limit}`),

  rules: () => request<{ rules: AutomationRule[] }>('GET', '/rules'),
  createRule: (rule: unknown) => request<{ rule: AutomationRule }>('POST', '/rules', rule),
  updateRule: (id: string, patch: Partial<AutomationRule>) => request<{ rule: AutomationRule }>('PATCH', `/rules/${id}`, patch),
  deleteRule: (id: string) => request<void>('DELETE', `/rules/${id}`),

  alerts: (status?: Alert['status'] | 'open', limit = 200) =>
    request<{ alerts: Alert[] }>('GET', `/alerts?limit=${limit}${status ? `&status=${status}` : ''}`),
  acknowledge: (id: string) => request<{ alert: Alert }>('POST', `/alerts/${id}/acknowledge`),
  resolve: (id: string) => request<{ alert: Alert }>('POST', `/alerts/${id}/resolve`),

  events: (q: { limit?: number; priority?: EventPriority; before?: string; deviceId?: string } = {}) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && p.set(k, String(v)));
    return request<{ events: HubEvent[] }>('GET', `/events?${p}`);
  },

  overview: () => request<{ overview: SystemOverview; adapters: AdapterStatus[] }>('GET', '/system/overview'),
  activity: (minutes = 30) => request<{ buckets: ActivityBucket[] }>('GET', `/system/activity?minutes=${minutes}`),
  audit: (limit = 100) => request<{ entries: AuditEntry[] }>('GET', `/system/audit?limit=${limit}`),

  scenario: (scenario: SimulationScenario, deviceId?: string) =>
    request<{ simulated: true; description: string }>('POST', '/simulation/scenario', { scenario, deviceId }),
  setSimulation: (running: boolean) => request<{ running: boolean }>('POST', '/simulation/state', { running }),
};
