import { Check, Ticket, Trophy } from 'lucide-react';
import { describeRules, nextTierHint, type MyRaffleStatus } from '../lib/raffleRules';
import type { MyRafflePrize } from '../lib/raffleWinner';
import PrizeCard from './PrizeCard';

/**
 * «Sorteo» in the logbook: the stamps that count (académicos / Vida Universitaria — a 60-minute mission grants 2),
 * the category reached (always the highest one), the closest step up and how each category is unlocked.
 * Everything shown comes from the server; this card never decides the category.
 */
export default function RaffleStatusCard({ raffle, prizes = [], verified = true, onRetry }: { raffle: MyRaffleStatus | null; prizes?: MyRafflePrize[]; verified?: boolean; onRetry?: () => void }) {
  const hint = raffle && !raffle.has_won ? nextTierHint(raffle) : null;
  return (
    <section id="premio" className="space-card scroll-mt-20 p-5" aria-label="Sorteo">
      <div className="flex items-center gap-2">
        <Ticket className="h-5 w-5 text-fg-accent" aria-hidden />
        <h2 className="text-base font-extrabold">Sorteo</h2>
      </div>
      {prizes.length > 0 ? (
        // El resultado vigente que el servidor tiene de esta persona manda sobre el progreso: ya ganó.
        <div className="mt-4 space-y-3">{prizes.map((prize) => <PrizeCard key={prize.winnerId} prize={prize} verified={verified} onRetry={onRetry} />)}</div>
      ) : !raffle ? (
        <p className="mt-4 text-sm text-ink-muted">Acepta el Aviso de Privacidad para ver tu progreso en el sorteo.</p>
      ) : raffle.has_won ? (
        <div className="mt-4 rounded-theme border border-success-500/40 bg-success-500/10 p-4 text-center">
          <Trophy className="mx-auto h-8 w-8 text-fg-success" aria-hidden />
          <p className="mt-2 font-semibold">¡Ganaste un premio!</p>
          <p className="mt-1 text-sm text-ink-muted">Ya participaste en el sorteo final.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {raffle.raffle_category_name ? (
            <div className="rounded-theme border border-accent-500/40 bg-accent-500/10 p-4 text-center">
              <p className="text-sm font-semibold text-ink-muted">Tu categoría del sorteo</p>
              <p className="mt-1 text-xl font-extrabold text-fg-accent">{raffle.raffle_category_name}</p>
            </div>
          ) : (
            <p className="text-sm font-semibold">Aún no entras al sorteo.</p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-center">
            <div className="flex flex-col-reverse justify-end rounded-theme border border-line bg-surface-raised p-3">
              <dt className="text-xs text-ink-muted">Sellos académicos</dt>
              <dd className="font-display text-2xl font-extrabold text-fg-brand">{raffle.academic_stamps}</dd>
            </div>
            <div className="flex flex-col-reverse justify-end rounded-theme border border-line bg-surface-raised p-3">
              <dt className="text-xs text-ink-muted">Sellos de Vida Universitaria</dt>
              <dd className="font-display text-2xl font-extrabold text-fg-info">{raffle.university_life_stamps}</dd>
            </div>
          </dl>
          {hint ? (
            <p className="text-center text-sm text-ink-muted">{hint.text}</p>
          ) : (
            raffle.raffle_category_name && raffle.categories.length > 0 && (
              <p className="text-center text-sm text-ink-muted">Estás en la categoría más alta.</p>
            )
          )}
          {raffle.categories.length > 0 && (
            <ul className="space-y-1.5 border-t border-line pt-3 text-sm" aria-label="Categorías del sorteo">
              {[...raffle.categories].reverse().map((tier) => {
                const mine = tier.id === raffle.raffle_category;
                return (
                  <li key={tier.id} className={`flex items-start gap-2 rounded-xl px-2 py-1.5 ${mine ? 'bg-accent-500/10' : ''}`}>
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${mine ? 'bg-accent-500 text-on-accent' : 'border border-line'}`} aria-hidden>
                      {mine && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <strong className={mine ? 'text-fg-accent' : ''}>{tier.name}</strong>
                      {mine && <span className="sr-only"> (tu categoría)</span>}
                      <span className="block text-xs text-ink-muted">{describeRules(tier.rules)}</span>
                    </span>
                  </li>
                );
              })}
              <li className="px-2 pt-1 text-xs text-ink-muted">Una misión de 60 minutos otorga 2 sellos; las demás, 1.</li>
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
