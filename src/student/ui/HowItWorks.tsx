import { QrCode, Rocket, Stamp } from 'lucide-react';

const STEPS = [
  { icon: Rocket, title: 'Elige tus misiones', body: `Son los talleres de Día OV. Reserva un horario.` },
  { icon: QrCode, title: 'Vívela y escanea', body: 'Al terminar, escanea el QR que te muestra el facilitador.' },
  { icon: Stamp, title: 'Gana sellos', body: 'Cada misión completada suma a tu bitácora.' },
];

/** The whole event in three steps, for someone who has never seen the platform. Shown only before the first booking. */
export function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <section aria-label="Cómo funciona" className={compact ? '' : 'space-card p-4'}>
      {!compact && <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">Así funciona tu día</h2>}
      <ol className="grid gap-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex items-start gap-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary-500/50 bg-primary-500/10 text-fg-brand" aria-hidden>
              <Icon className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-[10px] font-extrabold text-on-primary">{i + 1}</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{title}</p>
              <p className="text-xs text-ink-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
