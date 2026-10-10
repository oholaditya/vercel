import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Cpu,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Shield,
  Sun,
  User,
  Workflow,
  X,
} from 'lucide-react';
import { systemLabel, systemTone, toneText } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAuth } from '../../state/auth';
import { useHub, type Connection } from '../../state/hub';
import { cx, StatusDot } from '../ui/primitives';
import { BrandWordmark } from './Brand';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/automation', label: 'Automation', icon: Workflow },
  { to: '/security', label: 'Security', icon: Shield },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const connLabel: Record<Connection, string> = { live: 'Live', connecting: 'Connecting', offline: 'Reconnecting' };

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh bg-bg">
      <SimulationBanner />
      <TopBar onMenu={() => setNavOpen(true)} />
      <div className="flex">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SimulationBanner() {
  const { devices } = useHub();
  const values = Object.values(devices);
  // Shown whenever any simulated device exists (default) - hidden only for an all-bridge deployment.
  if (values.length > 0 && !values.some((d) => d.origin === 'simulated')) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-warn/25 bg-warn/[0.07] px-4 py-1.5 text-center text-2xs text-warn">
      <FlaskConical className="size-3 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold tracking-wide uppercase">Simulation mode</strong>
        <span className="hidden sm:inline"> - sensor data is simulated. Not a substitute for certified smoke/CO alarms or professional security monitoring.</span>
        <span className="sm:hidden"> - not a certified safety device.</span>
      </span>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { overview, connection } = useHub();
  const { theme, toggle } = useTheme();
  const status = overview?.status ?? 'nominal';
  const tone = connection === 'live' ? systemTone[status] : 'neutral';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg-elev/95 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="-ml-1 rounded-md p-1.5 text-fg-2 hover:bg-surface-2 hover:text-fg lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <BrandWordmark />

      <div className="ml-2 hidden h-6 w-px bg-line md:block" />
      <div className="hidden items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 md:flex" role="status" aria-label="System status">
        <StatusDot tone={tone} pulse={status === 'critical'} />
        <span className={cx('text-xs font-semibold', toneText[tone])}>{connection === 'live' ? systemLabel[status] : 'Hub link down'}</span>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <div className="hidden items-center gap-1.5 px-2 text-2xs font-semibold tracking-wider text-fg-3 uppercase sm:flex" title="Real-time link to the hub">
          <StatusDot tone={connection === 'live' ? 'ok' : connection === 'connecting' ? 'info' : 'warn'} pulse={connection === 'live'} />
          {connLabel[connection]}
        </div>
        <button onClick={toggle} className="rounded-lg p-2 text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu() {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!session) return null;
  const { user } = session;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pr-2.5 pl-1 transition-colors hover:border-line-strong"
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-accent/15 text-xs font-bold text-accent-text uppercase">{user.username[0]}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-xs font-semibold text-fg">{user.username}</span>
          <span className="block text-[10px] tracking-wide text-fg-3 uppercase">{user.role}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-52 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <div className="border-b border-line px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <User className="size-3.5 text-fg-3" /> {user.username}
            </div>
            <div className="mt-0.5 text-2xs text-fg-3">Role: {user.role}</div>
          </div>
          <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { overview, alerts } = useHub();
  const openAlerts = Object.values(alerts).filter((a) => a.status === 'active').length;
  const critical = Object.values(alerts).some((a) => a.status !== 'resolved' && a.severity === 'critical');

  const nav = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2 lg:hidden">
        <BrandWordmark />
        <button onClick={onClose} className="rounded-md p-1.5 text-fg-2 hover:bg-surface-2" aria-label="Close navigation">
          <X className="size-5" />
        </button>
      </div>
      <div className="eyebrow px-5 pt-5 pb-2">Console</div>
      <ul className="space-y-0.5 px-2.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-accent/10 font-semibold text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span aria-hidden className={cx('absolute top-2 bottom-2 left-0 w-0.5 rounded-r bg-accent transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                  <Icon className={cx('size-[18px]', isActive ? 'text-accent' : 'text-fg-3')} strokeWidth={1.75} />
                  <span className="flex-1">{label}</span>
                  {label === 'Alerts' && openAlerts > 0 && (
                    <span className={cx('num min-w-5 rounded-md px-1.5 py-px text-center text-[10px] font-bold', critical ? 'bg-crit text-white' : 'bg-warn/15 text-warn')}>{openAlerts}</span>
                  )}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3 p-4">
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="eyebrow mb-2">Coordination engine</div>
          <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
            <dt className="text-fg-3">Queue</dt>
            <dd className="num text-right text-fg-2">{overview?.engine.queueDepth ?? '-'}</dd>
            <dt className="text-fg-3">Processed</dt>
            <dd className="num text-right text-fg-2">{overview?.engine.processed.toLocaleString() ?? '-'}</dd>
            <dt className="text-fg-3">Avg latency</dt>
            <dd className="num text-right text-fg-2">{overview ? `${overview.engine.avgLatencyMs.toFixed(2)} ms` : '-'}</dd>
          </dl>
        </div>
        <div className="px-1 text-[10px] leading-relaxed text-fg-3">
          v{overview?.version ?? '1.0.0'} · QNX-inspired prototype
          <br />
          Not affiliated with BlackBerry QNX.
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 border-r border-line bg-bg-elev lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-bg-elev shadow-card">{nav}</aside>
        </div>
      )}
    </>
  );
}
