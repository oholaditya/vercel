import { useState, type FormEvent } from 'react';
import { FlaskConical, Loader2, Lock } from 'lucide-react';
import { useAuth } from '../state/auth';
import { BrandMark } from '../components/layout/Brand';
import { Field, inputClass } from '../components/ui/primitives';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[1.1fr_1fr]">
      {/* Left: identity panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-brand-tint p-10 lg:flex">
        {/* Square-dot field fading in from the right edge (original motif). */}
        <div
          aria-hidden
          className="square-dots absolute inset-y-0 right-0 w-2/3 opacity-60"
          style={{ maskImage: 'linear-gradient(to left, #000 0%, transparent 85%)', WebkitMaskImage: 'linear-gradient(to left, #000 0%, transparent 85%)' }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-9" />
          <div>
            <div className="text-sm font-bold tracking-[0.2em] text-fg">VERTEX</div>
            <div className="text-2xs tracking-[0.14em] text-fg-3 uppercase">Home Hub Console</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <div className="eyebrow mb-3 text-accent-text">Real-time coordination</div>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-fg">
            Deterministic thinking for the <span className="text-accent-text">connected home.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-fg-2">
            A priority-driven event engine coordinating lighting, climate, safety sensors and security - designed with a QNX-style microkernel architecture in mind.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6">
            {[
              ['4', 'priority lanes'],
              ['7', 'device classes'],
              ['<1 ms', 'typical dispatch*'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="num text-xl font-semibold text-accent-text">{v}</dt>
                <dd className="mt-1 text-2xs tracking-wide text-fg-3 uppercase">{l}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[10px] text-fg-3">*Measured on the Node.js prototype; not a hard real-time guarantee.</p>
        </div>
        <div className="relative text-2xs text-fg-3">QNX-inspired design. Not an official QNX or BlackBerry product.</div>
      </div>

      {/* Right: sign-in */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-9" />
            <div className="text-sm font-bold tracking-[0.2em] text-fg">VERTEX</div>
          </div>
          <h2 className="text-xl font-semibold text-fg">Sign in to the hub</h2>
          <p className="mt-1 text-sm text-fg-2">Use the credentials configured in <code className="num text-xs text-fg">server/.env</code>.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Username">
              <input className={inputClass} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && (
              <div role="alert" className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent-fill text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-fill-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              Sign in
            </button>
          </form>

          <div className="mt-8 flex gap-2.5 rounded-lg border border-warn/30 bg-warn/[0.07] p-3 text-xs leading-relaxed text-fg-2">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-warn" />
            <span>
              <strong className="text-warn">Simulation prototype.</strong> Sensor readings are generated by software. This system does not replace certified smoke detectors, CO alarms or professional security systems.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
