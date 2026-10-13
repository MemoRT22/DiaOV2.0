import { PartyPopper, Trophy } from 'lucide-react';
import type { MyRafflePrize } from '../lib/raffleWinner';
import './winner.css';

/**
 * Tarjeta de premio de la Bitácora. Es la comprobación visual: el operador compara premio y folio con su panel.
 * «seleccionado» = pendiente de entrega; «confirmado» = entregado (queda como recuerdo, sin pedir que se recoja).
 */
export default function PrizeCard({ prize }: { prize: MyRafflePrize }) {
  const delivered = prize.status === 'confirmado';
  return (
    <article className="pz-card" data-state={prize.status} aria-label={delivered ? 'Premio entregado' : 'Premio pendiente de entrega'}>
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
          <p className="mt-1 text-sm font-semibold">Presenta esta pantalla para reclamar tu premio.</p>
        </>
      )}
      <dl>
        <div><dt>Ganador</dt><dd>{prize.displayName}</dd></div>
        <div><dt>Folio</dt><dd className="pz-folio">{prize.folio}</dd></div>
        {prize.categoryName && <div><dt>Categoría</dt><dd>{prize.categoryName}</dd></div>}
        <div><dt>Estado</dt><dd>{delivered ? 'Entregado' : 'Pendiente de entrega'}</dd></div>
      </dl>
    </article>
  );
}
