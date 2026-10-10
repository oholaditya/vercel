import type { AlertSeverity, DeviceKind, EventPriority, SystemStatus } from '@shared/types';

/**
 * Semantic tone system. 'accent' is the coral brand colour (chrome only);
 * 'ok' is the healthy/active status colour. Every status-bearing element maps its domain value to a
 * Tone, and every Tone maps to fixed utility classes. Status colours are reserved
 * for status - they are never used as decoration - and always ship with an icon
 * or label so meaning is not carried by colour alone.
 */
export type Tone = 'accent' | 'ok' | 'warn' | 'crit' | 'info' | 'neutral';

export const toneText: Record<Tone, string> = {
  accent: 'text-accent-text',
  ok: 'text-ok',
  warn: 'text-warn',
  crit: 'text-crit',
  info: 'text-info',
  neutral: 'text-fg-2',
};

export const toneBg: Record<Tone, string> = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  crit: 'bg-crit',
  info: 'bg-info',
  neutral: 'bg-fg-3',
};

export const toneSoft: Record<Tone, string> = {
  accent: 'bg-accent/10 text-accent-text border-accent/30',
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  crit: 'bg-crit/10 text-crit border-crit/30',
  info: 'bg-info/10 text-info border-info/25',
  neutral: 'bg-surface-3 text-fg-2 border-line',
};

export const priorityTone: Record<EventPriority, Tone> = {
  critical: 'crit',
  high: 'warn',
  normal: 'info',
  low: 'neutral',
};

export const severityTone: Record<AlertSeverity, Tone> = {
  critical: 'crit',
  warning: 'warn',
};

export const systemTone: Record<SystemStatus, Tone> = {
  nominal: 'ok',
  degraded: 'warn',
  critical: 'crit',
};

export const systemLabel: Record<SystemStatus, string> = {
  nominal: 'All systems nominal',
  degraded: 'Degraded',
  critical: 'Critical alert',
};

export const kindLabel: Record<DeviceKind, string> = {
  light: 'Light',
  thermostat: 'Thermostat',
  smoke: 'Smoke sensor',
  co: 'CO sensor',
  contact: 'Door / window',
  motion: 'Motion sensor',
  security_panel: 'Security panel',
};

export type DeviceGroup = 'lighting' | 'climate' | 'safety' | 'security';
export const kindGroup: Record<DeviceKind, DeviceGroup> = {
  light: 'lighting',
  thermostat: 'climate',
  smoke: 'safety',
  co: 'safety',
  contact: 'security',
  motion: 'security',
  security_panel: 'security',
};

/** Thresholds mirrored from the default automation rules (for chart reference lines). */
export const METRIC_META = {
  temperature: { label: 'Temperature', unit: '°C', warn: 28, crit: undefined as number | undefined, digits: 1 },
  obscuration: { label: 'Smoke obscuration', unit: '%/m', warn: undefined as number | undefined, crit: 10, digits: 1 },
  co_ppm: { label: 'Carbon monoxide', unit: 'ppm', warn: 35, crit: 70, digits: 0 },
} as const;
