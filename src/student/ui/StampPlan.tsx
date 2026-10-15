import { Stamp } from 'lucide-react';
import { stampSlots, type StampProjection } from '../../lib/stampProjection';
import { LOGBOOK } from '../copy';
import { MAX_RANK_STAMPS } from '../progressText';

/** La proyección más lo que hace falta para nombrarla con los términos del tema. */
export type StampPlanView = StampProjection & {
  /** «sello» / «sellos» con el vocabulario del evento. */
  noun: (count: number) => string;
  /**
   * Rango que se alcanzaría SI se asiste a todo lo reservado. Solo debe venir del total OFICIAL (`my_progress`) y nunca por debajo del
   * rango actual (`projectedRankLevel`); sin ese total, se omite y queda solo el indicador de sellos posibles.
   */
  potentialRank?: string;
};

/**
 * Progresión de sellos de la ruta: una posición por sello hasta el último rango (4). Sólido = obtenido en las misiones de la ruta (asistencia
 * confirmada); punteado = posible (reservado, aún no ganado); vacío = pendiente. Con más de cuatro no se agregan posiciones ni rangos: «+N».
 *
 * Lo que se ve y lo que lee un lector de pantalla sale de las MISMAS frases (`sentences`), rango proyectado incluido. Aquí solo se cuentan
 * los sellos de las misiones de la ruta: el total oficial vive en la Bitácora y puede ser mayor.
 */
export function StampPlan({ plan, compact = false }: { plan: StampPlanView; compact?: boolean }) {
  const { slots, overflow } = stampSlots(plan, MAX_RANK_STAMPS);
  const earnedText = `${plan.earned} ${plan.noun(plan.earned)} obtenido${plan.earned === 1 ? '' : 's'} en tu ruta`;
  const plannedText = `${plan.planned} ${plan.noun(plan.planned)} posible${plan.planned === 1 ? '' : 's'} si asistes`;
  const rankText = plan.potentialRank && plan.planned > 0 ? `Si asistes, podrías llegar a ${plan.potentialRank}.` : '';
  const scopeText = `Aquí ves solo los ${plan.noun(2)} de las misiones de tu ruta; tu total oficial está en ${LOGBOOK.yours}. Los ${plan.noun(2)} se ganan al confirmar tu asistencia.`;
  const sentences = [`${earnedText}, ${plannedText}.`, rankText, scopeText].filter(Boolean);
  return (
    <div className="stamp-plan" role="img" aria-label={sentences.join(' ')}>
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
          <span className="text-ink">{plan.earned}</span> <span className="text-ink-muted">obtenido{plan.earned === 1 ? '' : 's'} en tu ruta</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-primary-400" />
          <span className="text-ink">{plan.planned}</span> <span className="text-ink-muted">posible{plan.planned === 1 ? '' : 's'}</span>
        </span>
      </p>
      <p className={`mt-1.5 leading-snug text-ink-muted ${compact ? 'text-[10px]' : 'text-[11px]'}`} aria-hidden>
        {[rankText, scopeText].filter(Boolean).join(' ')}
      </p>
    </div>
  );
}
