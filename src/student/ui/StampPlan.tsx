import { Stamp } from 'lucide-react';
import { stampSlots, type StampProjection } from '../../lib/stampProjection';
import { MAX_RANK_STAMPS } from '../progressText';

/** La proyección más lo que hace falta para nombrarla con los términos del tema. */
export type StampPlanView = StampProjection & {
  /** «sello» / «sellos» con el vocabulario del evento. */
  noun: (count: number) => string;
  /** Rango que se alcanzaría SI se asiste a todo lo reservado (solo se menciona en condicional). */
  potentialRank?: string;
};

/**
 * Progresión de sellos hacia el último rango: una posición por sello (4). Sólido = obtenido (asistencia confirmada); con borde
 * punteado = posible (reservado, aún no ganado); vacío = pendiente. Si hubiera más de cuatro, no se agregan posiciones ni rangos:
 * se indica «+N» y el texto conserva el total real.
 */
export function StampPlan({ plan, compact = false }: { plan: StampPlanView; compact?: boolean }) {
  const { slots, overflow } = stampSlots(plan, MAX_RANK_STAMPS);
  const parts = [
    `${plan.earned} ${plan.noun(plan.earned)} obtenido${plan.earned === 1 ? '' : 's'}`,
    `${plan.planned} ${plan.noun(plan.planned)} posible${plan.planned === 1 ? '' : 's'} si asistes`,
  ];
  const sr = `${parts.join(', ')}. Los ${plan.noun(2)} se ganan al confirmar tu asistencia.`;
  return (
    <div className="stamp-plan" role="img" aria-label={sr}>
      <div className="flex items-center justify-center gap-2" aria-hidden>
        {slots.map((slot, i) => (
          <span
            key={i}
            data-stamp={slot}
            className={`flex shrink-0 items-center justify-center rounded-full ${compact ? 'h-7 w-7' : 'h-9 w-9'} ${
              slot === 'earned'
                ? 'bg-primary-500 text-on-primary shadow-[0_0_14px_rgb(var(--c-primary-500)/0.8)]'
                : slot === 'planned'
                  ? 'border-2 border-dashed border-primary-400 bg-primary-500/10 text-primary-300'
                  : 'border border-line text-ink-muted/40'
            }`}
          >
            <Stamp className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </span>
        ))}
        {overflow > 0 && <span className="text-xs font-extrabold text-fg-brand">+{overflow}</span>}
      </div>
      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs font-semibold" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
          <span className="text-ink">{plan.earned}</span> <span className="text-ink-muted">obtenido{plan.earned === 1 ? '' : 's'}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-primary-400" />
          <span className="text-ink">{plan.planned}</span> <span className="text-ink-muted">posible{plan.planned === 1 ? '' : 's'}</span>
        </span>
      </p>
      {!compact && (
        <p className="mt-1.5 text-[11px] leading-snug text-ink-muted" aria-hidden>
          {plan.potentialRank && plan.planned > 0 ? `Si asistes, podrías llegar a ${plan.potentialRank}. ` : ''}
          Los {plan.noun(2)} se ganan al confirmar tu asistencia.
        </p>
      )}
    </div>
  );
}
