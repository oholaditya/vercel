import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { toneBg, toneSoft, type Tone } from '../../theme/tokens';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Card

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('rounded-xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, eyebrow, icon, actions, className }: { title: ReactNode; eyebrow?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex items-center justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="text-fg-3">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------- Badge / dots

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-semibold tracking-wide uppercase', toneSoft[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Explicit marker on everything that originates from the simulator. */
export function SimBadge({ className }: { className?: string }) {
  return (
    <span
      title="Simulated data - not a real sensor measurement"
      className={cx('inline-flex items-center gap-1 rounded border border-dashed border-warn/50 px-1 py-px font-mono text-[10px] font-semibold tracking-wider text-warn uppercase', className)}
    >
      <FlaskConical className="size-2.5" aria-hidden />
      Sim
    </span>
  );
}

export function StatusDot({ tone, pulse, label }: { tone: Tone; pulse?: boolean; label?: string }) {
  return (
    <span className="relative inline-flex size-2 shrink-0" role={label ? 'img' : undefined} aria-label={label}>
      {pulse && <span className={cx('absolute inline-flex size-full animate-ping rounded-full opacity-60', toneBg[tone])} />}
      <span className={cx('relative inline-flex size-2 rounded-full', toneBg[tone])} />
    </span>
  );
}

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn';
const variants: Record<Variant, string> = {
  primary: 'bg-accent-fill text-accent-ink hover:bg-accent-fill-hover border-transparent font-semibold',
  secondary: 'bg-surface-2 text-fg border-line hover:border-line-strong hover:bg-surface-3',
  ghost: 'bg-transparent text-fg-2 border-transparent hover:bg-surface-2 hover:text-fg',
  danger: 'bg-crit text-white border-transparent hover:brightness-110 font-semibold',
  warn: 'bg-warn/10 text-warn border-warn/30 hover:bg-warn/20',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Toggle

export function Toggle({ checked, onChange, disabled, label, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'h-4.5 w-8' : 'h-6 w-11';
  const knob = size === 'sm' ? 'size-3.5' : 'size-5';
  const shift = size === 'sm' ? 'translate-x-3.5' : 'translate-x-5';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full border p-px transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        dims,
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3',
      )}
    >
      <span className={cx('inline-block rounded-full bg-white shadow transition-transform duration-200', knob, checked ? shift : 'translate-x-0')} />
    </button>
  );
}

// ---------------------------------------------------------------- Segmented control

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
  size = 'md',
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; tone?: Tone }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(o.value)}
            className={cx(
              'flex-1 rounded-md px-2 font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed',
              size === 'sm' ? 'h-6 text-2xs' : 'h-7 text-xs',
              active ? 'bg-surface text-fg shadow-sm ring-1 ring-line-strong' : 'text-fg-3 hover:text-fg',
              active && o.tone === 'accent' && 'text-accent-text',
              active && o.tone === 'ok' && 'text-ok',
              active && o.tone === 'warn' && 'text-warn',
              active && o.tone === 'crit' && 'text-crit',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Misc

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-fg-3">{icon}</div>
      <div className="text-sm font-medium text-fg-2">{title}</div>
      {hint && <div className="max-w-xs text-xs text-fg-3">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-fg">
          <span aria-hidden className="size-2 shrink-0 bg-accent" />
          {title}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-2xs text-fg-3">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-fg-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none';
