import { io } from 'socket.io-client';
import { ApiError, getToken, notifyUnauthorized, type HubApi, type HubSocket } from '../lib/api-core';

/** Real backend: REST over fetch + Socket.IO to the Node.js hub server. */
export const IS_DEMO = false;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
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
    if (res.status === 401 && path !== '/auth/login') notifyUnauthorized();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

export const api: HubApi = {
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),

  devices: () => request('GET', '/devices'),
  command: (id, command) => request('POST', `/devices/${encodeURIComponent(id)}/commands`, command),
  history: (id, limit = 120) => request('GET', `/devices/${encodeURIComponent(id)}/history?limit=${limit}`),

  rules: () => request('GET', '/rules'),
  createRule: (rule) => request('POST', '/rules', rule),
  updateRule: (id, patch) => request('PATCH', `/rules/${id}`, patch),
  deleteRule: (id) => request('DELETE', `/rules/${id}`),

  alerts: (status, limit = 200) => request('GET', `/alerts?limit=${limit}${status ? `&status=${status}` : ''}`),
  acknowledge: (id) => request('POST', `/alerts/${id}/acknowledge`),
  resolve: (id) => request('POST', `/alerts/${id}/resolve`),

  events: (q = {}) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && p.set(k, String(v)));
    return request('GET', `/events?${p}`);
  },

  overview: () => request('GET', '/system/overview'),
  activity: (minutes = 30) => request('GET', `/system/activity?minutes=${minutes}`),
  audit: (limit = 100) => request('GET', `/system/audit?limit=${limit}`),

  scenario: (scenario, deviceId) => request('POST', '/simulation/scenario', { scenario, deviceId }),
  setSimulation: (running) => request('POST', '/simulation/state', { running }),
};

export function createHubSocket(token: string): HubSocket {
  return io({ auth: { token }, transports: ['websocket', 'polling'] }) as unknown as HubSocket;
}
