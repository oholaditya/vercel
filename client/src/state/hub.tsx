import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Alert,
  AutomationRule,
  DeviceCommand,
  DeviceSnapshot,
  HubEvent,
  ServerToClientEvents,
  SystemOverview,
  TelemetryPoint,
} from '@shared/types';
import { api, ApiError, type AdapterStatus } from '../lib/api';
import { useAuth } from './auth';
import { useToast } from './toast';

const MAX_EVENTS = 250;
const MAX_POINTS = 150;
const TELEMETRY_KINDS = new Set(['thermostat', 'smoke', 'co']);

export type Connection = 'connecting' | 'live' | 'offline';

interface State {
  loaded: boolean;
  connection: Connection;
  devices: Record<string, DeviceSnapshot>;
  alerts: Record<string, Alert>;
  events: HubEvent[];
  rules: Record<string, AutomationRule>;
  overview: SystemOverview | null;
  adapters: AdapterStatus[];
  telemetry: Record<string, TelemetryPoint[]>;
  pending: Record<string, boolean>;
}

type Action =
  | { t: 'init'; devices: DeviceSnapshot[]; alerts: Alert[]; events: HubEvent[]; rules: AutomationRule[]; overview: SystemOverview; adapters: AdapterStatus[] }
  | { t: 'telemetryInit'; deviceId: string; points: TelemetryPoint[] }
  | { t: 'device'; device: DeviceSnapshot }
  | { t: 'alert'; alert: Alert }
  | { t: 'event'; event: HubEvent }
  | { t: 'rule'; rule: AutomationRule }
  | { t: 'ruleDelete'; id: string }
  | { t: 'overview'; overview: SystemOverview }
  | { t: 'point'; deviceId: string; point: TelemetryPoint }
  | { t: 'connection'; connection: Connection }
  | { t: 'pending'; id: string; on: boolean }
  | { t: 'reset' };

const initial: State = {
  loaded: false, connection: 'connecting', devices: {}, alerts: {}, events: [], rules: {},
  overview: null, adapters: [], telemetry: {}, pending: {},
};

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'init':
      return {
        ...s, loaded: true, devices: byId(a.devices), alerts: byId(a.alerts), events: a.events,
        rules: byId(a.rules), overview: a.overview, adapters: a.adapters,
      };
    case 'telemetryInit':
      return { ...s, telemetry: { ...s.telemetry, [a.deviceId]: a.points.slice(-MAX_POINTS) } };
    case 'device':
      return { ...s, devices: { ...s.devices, [a.device.id]: a.device } };
    case 'alert':
      return { ...s, alerts: { ...s.alerts, [a.alert.id]: a.alert } };
    case 'event':
      if (s.events.some((e) => e.id === a.event.id)) return s;
      return { ...s, events: [a.event, ...s.events].slice(0, MAX_EVENTS) };
    case 'rule':
      return { ...s, rules: { ...s.rules, [a.rule.id]: a.rule } };
    case 'ruleDelete': {
      const { [a.id]: _gone, ...rest } = s.rules;
      return { ...s, rules: rest };
    }
    case 'overview':
      return { ...s, overview: a.overview };
    case 'point': {
      const prev = s.telemetry[a.deviceId] ?? [];
      return { ...s, telemetry: { ...s.telemetry, [a.deviceId]: [...prev, a.point].slice(-MAX_POINTS) } };
    }
    case 'connection':
      return { ...s, connection: a.connection };
    case 'pending':
      return { ...s, pending: { ...s.pending, [a.id]: a.on } };
    case 'reset':
      return initial;
  }
}

interface HubCtx extends State {
  sendCommand(deviceId: string, command: DeviceCommand): Promise<boolean>;
  acknowledge(alertId: string): Promise<void>;
  resolve(alertId: string): Promise<void>;
  upsertRule(rule: AutomationRule): void;
  removeRule(id: string): void;
}

const Ctx = createContext<HubCtx | null>(null);

export function HubProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const notify = useToast();
  const [state, dispatch] = useReducer(reducer, initial);
  const socketRef = useRef<Socket<ServerToClientEvents> | null>(null);

  useEffect(() => {
    if (!session) {
      dispatch({ t: 'reset' });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const [d, al, ev, r, ov] = await Promise.all([api.devices(), api.alerts(undefined, 200), api.events({ limit: 150 }), api.rules(), api.overview()]);
        if (cancelled) return;
        dispatch({ t: 'init', devices: d.devices, alerts: al.alerts, events: ev.events, rules: r.rules, overview: ov.overview, adapters: ov.adapters });
        await Promise.all(
          d.devices
            .filter((x) => TELEMETRY_KINDS.has(x.kind))
            .map((x) => api.history(x.id, MAX_POINTS).then((h) => !cancelled && dispatch({ t: 'telemetryInit', deviceId: x.id, points: h.points })).catch(() => undefined)),
        );
      } catch (err) {
        if (!cancelled) notify('error', err instanceof Error ? err.message : 'Failed to load hub state');
      }
    })();

    const socket: Socket<ServerToClientEvents> = io({ auth: { token: session.token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => dispatch({ t: 'connection', connection: 'live' }));
    socket.on('disconnect', () => dispatch({ t: 'connection', connection: 'offline' }));
    socket.on('connect_error', () => dispatch({ t: 'connection', connection: 'offline' }));
    socket.on('device:update', (device) => dispatch({ t: 'device', device }));
    socket.on('alert:upsert', (alert) => dispatch({ t: 'alert', alert }));
    socket.on('event:new', (event) => dispatch({ t: 'event', event }));
    socket.on('rule:upsert', (rule) => dispatch({ t: 'rule', rule }));
    socket.on('rule:delete', (id) => dispatch({ t: 'ruleDelete', id }));
    socket.on('system:overview', (overview) => dispatch({ t: 'overview', overview }));
    socket.on('telemetry:point', ({ deviceId, point }) => dispatch({ t: 'point', deviceId, point }));

    return () => {
      cancelled = true;
      socket.close();
      socketRef.current = null;
    };
  }, [session, notify]);

  const sendCommand = useCallback(
    async (deviceId: string, command: DeviceCommand) => {
      dispatch({ t: 'pending', id: deviceId, on: true });
      try {
        const { device } = await api.command(deviceId, command);
        dispatch({ t: 'device', device });
        return true;
      } catch (err) {
        notify('error', err instanceof ApiError ? err.message : 'Command failed');
        return false;
      } finally {
        dispatch({ t: 'pending', id: deviceId, on: false });
      }
    },
    [notify],
  );

  const acknowledge = useCallback(
    async (id: string) => {
      try {
        const { alert } = await api.acknowledge(id);
        dispatch({ t: 'alert', alert });
        notify('success', 'Alert acknowledged');
      } catch (err) {
        notify('error', (err as Error).message);
      }
    },
    [notify],
  );

  const resolve = useCallback(
    async (id: string) => {
      try {
        const { alert } = await api.resolve(id);
        dispatch({ t: 'alert', alert });
        notify('success', 'Alert resolved');
      } catch (err) {
        notify('error', (err as Error).message);
      }
    },
    [notify],
  );

  const upsertRule = useCallback((rule: AutomationRule) => dispatch({ t: 'rule', rule }), []);
  const removeRule = useCallback((id: string) => dispatch({ t: 'ruleDelete', id }), []);

  const value = useMemo(
    () => ({ ...state, sendCommand, acknowledge, resolve, upsertRule, removeRule }),
    [state, sendCommand, acknowledge, resolve, upsertRule, removeRule],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHub() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useHub outside HubProvider');
  return c;
}

/** Sorted helpers derived from hub state. */
export function useDeviceList() {
  const { devices } = useHub();
  return useMemo(() => Object.values(devices).sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name)), [devices]);
}

export function useAlertList() {
  const { alerts } = useHub();
  return useMemo(() => Object.values(alerts).sort((a, b) => b.ts.localeCompare(a.ts)), [alerts]);
}
