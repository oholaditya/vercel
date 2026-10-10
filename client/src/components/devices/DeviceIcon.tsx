import { DoorClosed, DoorOpen, Flame, Lightbulb, Radar, ShieldCheck, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import type { DeviceKind } from '@shared/types';

export const kindIcon: Record<DeviceKind, LucideIcon> = {
  light: Lightbulb,
  thermostat: Thermometer,
  smoke: Flame,
  co: Wind,
  contact: DoorClosed,
  motion: Radar,
  security_panel: ShieldCheck,
};

export function DeviceIcon({ kind, open, className }: { kind: DeviceKind; open?: boolean; className?: string }) {
  const Icon = kind === 'contact' && open ? DoorOpen : kindIcon[kind];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
