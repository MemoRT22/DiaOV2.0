import { useMemo, useState } from 'react';
import { Alert, Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../../lib/catalog';
import type { RaffleWinner, WinnerStatus } from '../../lib/raffleApi';
import { DataPanel, EmptyState, RowAction } from '../design/Primitives';
import { kindOf, plural, PrizeIcon, toneOf } from './PrizeParts';
import { InvalidateModal } from './RaffleModals';
import type { RaffleContext } from './types';

/** The technical states, in the words of someone handing over a prize. */
const STATUS: Record<WinnerStatus, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral'; help: string }> = {
  confirmado: { label: 'Entregado', tone: 'success', help: 'Ya recibió el premio.' },
  seleccionado: { label: 'Por confirmar', tone: 'warning', help: 'Salió en el sorteo; falta confirmar que se presentó.' },
  no_presentado: { label: 'No se presentó', tone: 'neutral', help: 'No se presentó; el premio volvió a quedar disponible.' },
  invalidado: { label: 'Invalidado', tone: 'error', help: 'Se anuló el resultado y el premio volvió a quedar disponible.' },
};

type Filter = 'all' | 'delivered' | 'waiting' | 'other';
const FILTERS: { value: Filter; label: string; match: (status: WinnerStatus) => boolean }[] = [
  { value: 'all', label: 'Todos', match: () => true },
  { value: 'delivered', label: 'Entregados', match: (status) => status === 'confirmado' },
  { value: 'waiting', label: 'Por confirmar', match: (status) => status === 'seleccionado' },
  { value: 'other', label: 'No entregados', match: (status) => status === 'no_presentado' || status === 'invalidado' },
];

/** Results only: nothing here draws or prepares anything. Coordinación can still invalidate a delivered prize, with a reason. */
export default function RaffleHistory({ ctx }: { ctx: RaffleContext }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [invalidating, setInvalidating] = useState<RaffleWinner | null>(null);
  const [notice, setNotice] = useState('');
  const winners = ctx.winners;

  const shown = useMemo(() => {
    const rule = FILTERS.find((item) => item.value === filter)!;
    return (winners ?? []).filter((winner) => rule.match(winner.status));
  }, [winners, filter]);
  const delivered = (winners ?? []).filter((winner) => winner.status === 'confirmado').length;
  const waiting = (winners ?? []).filter((winner) => winner.status === 'seleccionado').length;

  if (winners === null) return ctx.prizesLoading ? <Spinner /> : <Alert tone="error">No se pudieron consultar los resultados. Actualiza la página e inténtalo de nuevo.</Alert>;

  return (
    <div className="ad-page">
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="rf-stats" aria-label="Resumen de resultados">
        <div><strong>{delivered}</strong><span>{delivered === 1 ? 'premio entregado' : 'premios entregados'}</span></div>
        <div><strong>{waiting}</strong><span>{waiting === 1 ? 'por confirmar' : 'por confirmar'}</span></div>
        <div><strong>{winners.length}</strong><span>{winners.length === 1 ? 'resultado en total' : 'resultados en total'}</span></div>
      </div>
      <div className="rf-chips" role="group" aria-label="Filtrar resultados">
        {FILTERS.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
      </div>
      <DataPanel>
        {shown.map((winner) => {
          const status = STATUS[winner.status];
          return (
            <div key={winner.id} className="ad-data-row rf-history-row" data-tone={toneOf(winner.category_name)}>
              <span className="rf-prize-icon"><PrizeIcon kind={kindOf(winner.category_name, winner.prize_name)} /></span>
              <div className="ad-row-main">
                <p className="ad-row-title">{winner.display_name}</p>
                <p className="ad-row-meta">{winner.prize_name} · {winner.category_name}</p>
                <p className="ad-row-meta">{formatDateTime(winner.drawn_at)}{winner.confirmed_at && ` · entregado ${formatDateTime(winner.confirmed_at)}`}</p>
                {winner.invalidation_reason && <p className="rf-reason">Motivo: {winner.invalidation_reason}</p>}
              </div>
              <span title={status.help}><Badge tone={status.tone}>{status.label}</Badge></span>
              {ctx.canConfigure && winner.status === 'confirmado' && (
                <RowAction danger onClick={() => { setInvalidating(winner); setNotice(''); }} label={`Invalidar a ${winner.display_name}`}>Invalidar</RowAction>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (winners.length === 0
          ? <EmptyState title="Todavía no hay ganadores." description="Cuando se sortee y se confirme un premio, aparecerá aquí." />
          : <EmptyState title="Ningún resultado con este filtro." description="Cambia el filtro para ver el resto." />)}
      </DataPanel>
      <p className="rf-count">{plural(shown.length, 'resultado', 'resultados')}</p>
      {invalidating && <InvalidateModal winner={invalidating} onClose={() => setInvalidating(null)}
        onDone={() => { setInvalidating(null); void ctx.refresh(); setNotice('Resultado invalidado. El premio volvió a quedar disponible y la persona puede participar de nuevo.'); }} />}
    </div>
  );
}
