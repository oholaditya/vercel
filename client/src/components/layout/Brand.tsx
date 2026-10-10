/** Original Vertex mark: a hexagonal node with three spokes (not a third-party logo). */
export function BrandMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--surface-2)" stroke="var(--line-strong)" />
      <path d="M16 5.5 25.1 10.75v10.5L16 26.5l-9.1-5.25v-10.5z" fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      <circle cx="16" cy="16" r="2.8" fill="var(--accent)" />
      <path d="M16 13V8.6M18.5 17.4l3.8 2.2M13.5 17.4l-3.8 2.2" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BrandWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-none">
        <div className="text-[13px] font-bold tracking-[0.18em] text-fg">VERTEX</div>
        <div className="mt-1 text-[10px] font-medium tracking-[0.12em] text-fg-3 uppercase">Home Hub Console</div>
      </div>
    </div>
  );
}
