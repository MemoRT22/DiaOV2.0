import type { OperationsSummary } from '../../lib/operationsApi';

const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

function Ring({ value }: { value: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 -rotate-90" aria-hidden>
      <defs>
        <linearGradient id="pulse-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--c-primary-300))" />
          <stop offset="100%" stopColor="rgb(var(--c-primary-600))" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgb(var(--c-neutral-500) / 0.14)" strokeWidth="11" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke="url(#pulse-ring)" strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
      />
    </svg>
  );
}

function Meter({ label, value, detail, bar }: { label: string; value: number; detail: string; bar: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-ink-muted"><span className="font-display font-extrabold text-ink">{value}%</span> · {detail}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-500/15" aria-hidden>
        <div className={`h-full rounded-full bg-gradient-to-r ${bar}`} style={{ width: `${value}%`, transition: 'width 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }} />
      </div>
    </div>
  );
}

/** Quiet at-a-glance view of how full the programme is, built only from numbers the snapshot already carries. */
export default function ProgramPulse({ summary }: { summary: OperationsSummary }) {
  const fill = pct(summary.reserved_total, summary.capacity_total);
  return (
    <section aria-label="Pulso del programa" className="card admin-hero flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-7">
      <div className="relative flex shrink-0 items-center justify-center self-center">
        <Ring value={fill} />
        <div className="absolute text-center">
          <p className="font-display text-2xl font-extrabold leading-none tabular-nums sm:text-3xl">{fill}%</p>
          <p className="mt-1 text-[0.55rem] font-bold uppercase tracking-wider text-ink-muted sm:text-[0.65rem]">ocupación</p>
        </div>
      </div>
      <div className="relative z-10 min-w-0 flex-1 space-y-4">
        <div>
          <h2 className="font-display text-lg font-extrabold">Pulso del programa</h2>
          <p className="text-sm text-ink-muted">
            {summary.reserved_total} de {summary.capacity_total} lugares reservados en {summary.sessions_total} {summary.sessions_total === 1 ? 'sesión' : 'sesiones'}.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Meter
            label="Participantes con reservación"
            value={pct(summary.participants_with_reservations, summary.participants_total)}
            detail={`${summary.participants_with_reservations} de ${summary.participants_total}`}
            bar="from-primary-300 to-primary-500"
          />
          <Meter
            label="Participantes que ya asistieron"
            value={pct(summary.unique_attended_participants, summary.participants_total)}
            detail={`${summary.unique_attended_participants} de ${summary.participants_total}`}
            bar="from-accent-300 to-accent-600"
          />
        </div>
      </div>
    </section>
  );
}
