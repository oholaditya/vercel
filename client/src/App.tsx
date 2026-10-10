import { Component, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './state/auth';
import { HubProvider, useHub } from './state/hub';
import { ToastProvider } from './state/toast';
import { ThemeProvider } from './theme/ThemeProvider';
import { AppShell } from './components/layout/AppShell';
import { BrandMark } from './components/layout/Brand';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DevicesPage } from './pages/DevicesPage';
import { AutomationPage } from './pages/AutomationPage';
import { SecurityPage } from './pages/SecurityPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg">
      <BrandMark className="size-10" />
      <div className="flex items-center gap-2 text-sm text-fg-3">
        <Loader2 className="size-4 animate-spin" /> {label}
      </div>
    </div>
  );
}

function Gate() {
  const { session, ready } = useAuth();
  if (!ready) return <Splash label="Restoring session…" />;
  if (!session) return <LoginPage />;
  return (
    <HubProvider>
      <Console />
    </HubProvider>
  );
}

function Console() {
  const { loaded } = useHub();
  if (!loaded) return <Splash label="Connecting to hub…" />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** Last-resort UI error boundary so a rendering bug never blanks the console. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-xl border border-crit/40 bg-surface p-6">
          <h1 className="font-semibold text-fg">The console hit an unexpected error</h1>
          <p className="mt-2 text-sm text-fg-2">{this.state.error.message}</p>
          <button onClick={() => location.reload()} className="mt-4 rounded-lg bg-accent-fill px-3 py-2 text-sm font-semibold text-accent-ink">
            Reload console
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Gate />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
