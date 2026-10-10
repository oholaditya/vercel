import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Alert, DeviceSnapshot, HubEvent } from '@shared/types';
import { DeviceCard } from '../src/components/devices/DeviceCard';
import { AlertItem } from '../src/components/alerts/AlertItem';
import { EventFeed } from '../src/components/events/EventFeed';
import { describeAction, describeTrigger } from '../src/pages/AutomationPage';

const light: DeviceSnapshot = {
  id: 'light-1', name: 'Desk Light', kind: 'light', room: 'Office', origin: 'simulated', adapterId: 'sim',
  online: true, health: 'ok', battery: null, lastSeen: new Date().toISOString(), state: { on: false, brightness: 60 },
};

const thermostat: DeviceSnapshot = {
  ...light, id: 'th-1', name: 'Office Thermostat', kind: 'thermostat',
  state: { currentC: 19.5, targetC: 21, mode: 'auto', heating: true, cooling: false },
};

describe('DeviceCard - device controls', () => {
  it('sends setPower when the light switch is toggled', async () => {
    const onCommand = vi.fn();
    render(<DeviceCard device={light} onCommand={onCommand} canControl />);
    await userEvent.click(screen.getByRole('switch', { name: 'Power Desk Light' }));
    expect(onCommand).toHaveBeenCalledWith({ action: 'setPower', on: true });
  });

  it('commits brightness when the slider is released', () => {
    const onCommand = vi.fn();
    render(<DeviceCard device={light} onCommand={onCommand} canControl />);
    const slider = screen.getByRole('slider', { name: 'Brightness Desk Light' });
    fireEvent.change(slider, { target: { value: '85' } });
    fireEvent.pointerUp(slider);
    expect(onCommand).toHaveBeenCalledWith({ action: 'setBrightness', level: 85 });
  });

  it('disables controls for read-only roles and offline devices', () => {
    const { rerender } = render(<DeviceCard device={light} onCommand={vi.fn()} canControl={false} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    rerender(<DeviceCard device={{ ...light, online: false }} onCommand={vi.fn()} canControl />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('steps the thermostat target by 0.5 °C and changes mode', async () => {
    const onCommand = vi.fn();
    render(<DeviceCard device={thermostat} onCommand={onCommand} canControl />);
    await userEvent.click(screen.getByRole('button', { name: 'Increase target temperature' }));
    expect(onCommand).toHaveBeenCalledWith({ action: 'setTarget', celsius: 21.5 });
    await userEvent.click(screen.getByRole('radio', { name: 'Cool' }));
    expect(onCommand).toHaveBeenCalledWith({ action: 'setMode', mode: 'cool' });
    expect(screen.getByText('Heating')).toBeInTheDocument();
  });

  it('labels simulated devices and shows alarm state for CO', () => {
    const co: DeviceSnapshot = { ...light, id: 'co-1', name: 'CO Sensor', kind: 'co', battery: 88, state: { ppm: 95, alarm: true } };
    render(<DeviceCard device={co} onCommand={vi.fn()} canControl />);
    expect(screen.getByTitle(/Simulated data/)).toBeInTheDocument();
    expect(screen.getByText('Alarm')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });
});

const alert: Alert = {
  id: 'a1', ts: new Date().toISOString(), severity: 'critical', category: 'smoke', title: 'Smoke detected',
  message: 'Smoke detected - Kitchen', deviceId: 'smoke-1', ruleId: null, status: 'active',
  acknowledgedBy: null, acknowledgedAt: null, resolvedAt: null, simulated: true,
};

describe('AlertItem - alert handling', () => {
  it('offers acknowledge and resolve for active alerts', async () => {
    const onAck = vi.fn();
    const onResolve = vi.fn();
    render(<ul><AlertItem alert={alert} canAct onAcknowledge={onAck} onResolve={onResolve} /></ul>);
    await userEvent.click(screen.getByRole('button', { name: /Acknowledge/ }));
    await userEvent.click(screen.getByRole('button', { name: /Resolve/ }));
    expect(onAck).toHaveBeenCalledOnce();
    expect(onResolve).toHaveBeenCalledOnce();
    expect(screen.getByText('Sim')).toBeInTheDocument();
  });

  it('hides acknowledge once acknowledged and all actions once resolved', () => {
    const { rerender } = render(<ul><AlertItem alert={{ ...alert, status: 'acknowledged', acknowledgedBy: 'op' }} canAct onAcknowledge={vi.fn()} onResolve={vi.fn()} /></ul>);
    expect(screen.queryByRole('button', { name: /Acknowledge/ })).toBeNull();
    expect(screen.getByText(/Ack: op/)).toBeInTheDocument();
    rerender(<ul><AlertItem alert={{ ...alert, status: 'resolved' }} canAct onAcknowledge={vi.fn()} onResolve={vi.fn()} /></ul>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no actions to viewers', () => {
    render(<ul><AlertItem alert={alert} canAct={false} onAcknowledge={vi.fn()} onResolve={vi.fn()} /></ul>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EventFeed', () => {
  const ev = (id: string, priority: HubEvent['priority'], message: string): HubEvent => ({
    id, ts: new Date().toISOString(), type: 'system', priority, source: 'system', deviceId: null, message, simulated: false,
  });

  it('filters by priority', async () => {
    render(<EventFeed events={[ev('1', 'critical', 'Fire!'), ev('2', 'normal', 'Light on')]} />);
    expect(screen.getByText('Light on')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Critical' }));
    expect(screen.getByText('Fire!')).toBeInTheDocument();
    expect(screen.queryByText('Light on')).toBeNull();
  });
});

describe('Rule descriptions', () => {
  it('renders human-readable triggers and actions', () => {
    const devices = { 'co-1': { ...light, id: 'co-1', name: 'Garage CO' } as DeviceSnapshot };
    expect(describeTrigger({ type: 'threshold', metric: 'co_ppm', op: '>', value: 35, deviceId: 'co-1' }, devices)).toBe('Carbon monoxide > 35 ppm at Garage CO');
    expect(describeTrigger({ type: 'intrusion', requireArmed: true }, devices)).toBe('Any door/window opens while armed');
    expect(describeAction({ type: 'lights', on: true, room: '*', brightness: 100 }, devices)).toBe('Lights on (100%) · all rooms');
  });
});
