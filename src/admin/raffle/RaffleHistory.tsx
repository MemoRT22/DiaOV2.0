import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { fetchWinners, type RaffleWinner, type WinnerStatus } from '../../lib/raffleApi';
import { WINNER_STATUS } from '../../lib/raffleShow';
import { DataPanel, EmptyState, RowAction, SectionHeading } from '../design/Primitives';
import { InvalidateModal } from './RaffleModals';
import type { RaffleContext } from './types';

type Filter = 'all' | WinnerStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' }, { value: 'confirmado', label: 'Confirmados' }, { value: 'seleccionado', label: 'Pendientes' },
  { value: 'no_presentado', label: 'No se presentó' }, { value: 'invalidado', label: 'Invalidados' },
];

/** Results only: nothing here draws or configures. Coordinación can still invalidate a confirmed prize. */
export default function RaffleHistory({ ctx }: { ctx: RaffleContext }) {
  const [winners, setWinners] = useState<RaffleWinner[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [invalidating, setInvalidating] = useState<RaffleWinner | null>(null);

  const load = useCallback(() => {
    setError('');
    return fetchWinners().then(setWinners).catch((cause) => { setError(friendlyError(cause)); setWinners((current) => current ?? []); });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const scoped = useMemo(() => {
    const ids = new Set(ctx.categories.map((category) => category.id));
    return (winners ?? []).filter((winner) => ids.has(winner.category_id));
  }, [winners, ctx.categories]);
  const count = (status: WinnerStatus) => scoped.filter((winner) => winner.status === status).length;
  const shown = filter === 'all' ? scoped : scoped.filter((winner) => winner.status === filter);

  return (
    <div className="ad-page">
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {winners === null ? <Spinner /> : (
        <>
          <div className="rf-stats" aria-label="Resumen de resultados">
            <div><strong>{count('confirmado')}</strong><span>{count('confirmado') === 1 ? 'premio confirmado' : 'premios confirmados'}</span></div>
            <div><strong>{count('seleccionado')}</strong><span>{count('seleccionado') === 1 ? 'pendiente' : 'pendientes'} de confirmar</span></div>
            <div><strong>{count('no_presentado') + count('invalidado')}</strong><span>no se presentaron o se invalidaron</span></div>
          </div>
          <SectionHeading title="Historial de ganadores"
            detail={`${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'} · ${ctx.scope === 'demo' ? 'datos de prueba' : 'edición real'}`} />
          <div className="rf-chips" role="group" aria-label="Filtrar por estado">
            {FILTERS.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}
          </div>
          <DataPanel>
            {shown.map((winner) => {
              const status = WINNER_STATUS[winner.status];
              return (
                <div key={winner.id} className="ad-data-row rf-history-row">
                  <div className="ad-row-main">
                    <p className="ad-row-title">{winner.display_name}</p>
                    <p className="ad-row-meta">{winner.prize_name} · {winner.category_name}</p>
                    <p className="ad-row-meta">{formatDateTime(winner.drawn_at)}{winner.confirmed_at && ` · confirmado ${formatDateTime(winner.confirmed_at)}`}</p>
                    {winner.invalidation_reason && <p className="rf-reason">Motivo de invalidación: {winner.invalidation_reason}</p>}
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {ctx.canConfigure && winner.status === 'confirmado' && (
                    <RowAction danger onClick={() => { setInvalidating(winner); setNotice(''); }} label={`Invalidar a ${winner.display_name}`}>Invalidar</RowAction>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && (scoped.length === 0
              ? <EmptyState title="Sin ganadores registrados." description="Cuando se sortee y se confirme un premio, aparecerá aquí." />
              : <EmptyState title="Ningún resultado con este estado." description="Cambia el filtro para ver el resto." />)}
          </DataPanel>
        </>
      )}
      {invalidating && <InvalidateModal winner={invalidating} onClose={() => setInvalidating(null)}
        onDone={() => { setInvalidating(null); void load(); void ctx.refresh(); setNotice('Ganador invalidado. El premio volvió al inventario y la persona al pool.'); }} />}
    </div>
  );
}
