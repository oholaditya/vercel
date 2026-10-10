import { useEffect, useState } from 'react';
import { BellOff, History, Loader2 } from 'lucide-react';
import type { Alert, EventPriority, HubEvent } from '@shared/types';
import { api } from '../lib/api';
import { useNow } from '../hooks/useNow';
import { useAuth } from '../state/auth';
import { useAlertList, useHub } from '../state/hub';
import { AlertItem } from '../components/alerts/AlertItem';
import { EmergencyPanel } from '../components/alerts/EmergencyPanel';
import { EventRow } from '../components/events/EventFeed';
import { Button, Card, CardHeader, EmptyState, PageHeader, Segmented } from '../components/ui/primitives';

type Tab = 'open' | Alert['status'] | 'all';

export function AlertsPage() {
  const hub = useHub();
  const { can } = useAuth();
  const now = useNow(10_000);
  const all = useAlertList();
  const [tab, setTab] = useState<Tab>('open');
  const shown = all.filter((a) => (tab === 'all' ? true : tab === 'open' ? a.status !== 'resolved' : a.status === tab));
  const count = (t: Tab) => all.filter((a) => (t === 'open' ? a.status !== 'resolved' : a.status === t)).length;

  return (
    <>
      <PageHeader title="Alerts" description="Acknowledge alerts to confirm a person has seen them; resolve once the condition is handled. Connectivity alerts auto-resolve when a device reconnects." />

      <EmergencyPanel />

      <Card className="mt-4">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-fg">All alerts</h2>
          <div className="w-full sm:w-auto sm:min-w-[420px]">
            <Segmented<Tab>
              label="Alert status"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'open', label: `Open (${count('open')})` },
                { value: 'active', label: `Active (${count('active')})` },
                { value: 'acknowledged', label: `Ack'd (${count('acknowledged')})` },
                { value: 'resolved', label: 'Resolved' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<BellOff className="size-6" />} title="Nothing here" hint="Alerts raised by automation rules appear in real time." />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((a) => (
              <AlertItem
                key={a.id}
                alert={a}
                now={now}
                deviceName={a.deviceId ? hub.devices[a.deviceId]?.name : undefined}
                canAct={can('operator')}
                onAcknowledge={() => void hub.acknowledge(a.id)}
                onResolve={() => void hub.resolve(a.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      <EventHistory />
    </>
  );
}

/** Paginated, persisted event history (SQLite) with a priority filter. */
function EventHistory() {
  const [priority, setPriority] = useState<EventPriority | 'all'>('all');
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const before = reset ? undefined : events[events.length - 1]?.ts;
      const r = await api.events({ limit: 50, priority: priority === 'all' ? undefined : priority, before });
      setEvents(reset ? r.events : [...events, ...r.events]);
      setDone(r.events.length < 50);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priority]);

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader
        icon={<History className="size-4" />}
        eyebrow="Storage"
        title="Event history"
        actions={
          <div className="w-[300px] max-w-[60vw]">
            <Segmented<EventPriority | 'all'>
              size="sm"
              label="Priority"
              value={priority}
              onChange={setPriority}
              options={[
                { value: 'all', label: 'All' },
                { value: 'critical', label: 'Critical', tone: 'crit' },
                { value: 'high', label: 'High', tone: 'warn' },
                { value: 'normal', label: 'Normal' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </div>
        }
      />
      {events.length === 0 && !loading ? (
        <EmptyState icon={<History className="size-6" />} title="No events for this filter" />
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </ul>
      )}
      <div className="flex justify-center border-t border-line p-3">
        {loading ? (
          <Loader2 className="size-4 animate-spin text-fg-3" />
        ) : (
          !done && (
            <Button size="sm" variant="ghost" onClick={() => void load(false)}>
              Load older events
            </Button>
          )
        )}
      </div>
    </Card>
  );
}
