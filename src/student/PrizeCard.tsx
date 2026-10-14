import { PartyPopper, Trophy } from 'lucide-react';
import type { MyRafflePrize } from '../lib/raffleWinner';
import './winner.css';

/**
 * Tarjeta de premio de la Bitácora. Es la comprobación visual: el operador compara premio y folio con su panel.
 * «seleccionado» = pendiente de entrega; «confirmado» = entregado (queda como recuerdo, sin pedir que se recoja).
 * Solo se presenta como reclamable si el servidor lo confirmó hace poco (`verified`); si la última consulta falló o ya es vieja,
 * la tarjeta lo dice y no pide presentar la pantalla: lo que se ve podría estar desactualizado.
 */
export default function PrizeCard({ prize, verified = true, onRetry }: { prize: MyRafflePrize; verified?: boolean; onRetry?: () => void }) {
  const delivered = prize.status === 'confirmado';
  return (
    <article className="pz-card" data-state={verified ? prize.status : 'sin-verificar'} aria-label={!verified ? 'Premio sin verificar' : delivered ? 'Premio entregado' : 'Premio pendiente de entrega'}>
      {delivered ? <PartyPopper className="mx-auto h-9 w-9 text-fg-success" aria-hidden /> : <Trophy className="mx-auto h-9 w-9 text-fg-accent" aria-hidden />}
      {delivered ? (
        <>
          <h3 className="mt-2 text-xl font-extrabold">¡Premio entregado!</h3>
          <p className="mt-1 text-sm text-ink-muted">Tu premio {prize.prizeName} fue entregado correctamente.</p>
        </>
      ) : (
        <>
          <h3 className="mt-2 text-xl font-extrabold">¡Ganaste!</h3>
          <p className="pz-prize" data-testid="prize-name">{prize.prizeName}</p>
          {verified
            ? <p className="mt-1 text-sm font-semibold">Presenta esta pantalla para reclamar tu premio.</p>
            : <p className="mt-1 text-sm font-semibold" role="status">Estamos verificando tu premio con el servidor. Cuando se confirme podrás presentar esta pantalla.</p>}
        </>
      )}
      <dl>
        <div><dt>Ganador</dt><dd>{prize.displayName}</dd></div>
        <div><dt>Folio</dt><dd className="pz-folio">{prize.folio}</dd></div>
        {prize.categoryName && <div><dt>Categoría</dt><dd>{prize.categoryName}</dd></div>}
        <div><dt>Estado</dt><dd>{!verified ? 'Por verificar' : delivered ? 'Entregado' : 'Pendiente de entrega'}</dd></div>
      </dl>
      {!verified && (
        <div className="mt-3 text-sm text-ink-muted" role="status">
          {delivered && <p>Sin conexión reciente: este estado puede estar desactualizado.</p>}
          {onRetry && <button type="button" className="mt-2 inline-flex min-h-10 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-raised" onClick={onRetry}>Verificar ahora</button>}
        </div>
      )}
    </article>
  );
}
