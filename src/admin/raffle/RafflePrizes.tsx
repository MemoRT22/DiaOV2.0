import { Check, Gift } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Modal, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { categoryRules, fetchPrizes, savePrize } from '../../lib/raffleApi';
import { OFFICIAL_CATALOG, OFFICIAL_UNITS, officialCategory, prepareOfficialCatalog, type CatalogPlan, type PlanEntry, type PrepareResult } from '../../lib/raffleCatalog';
import { describeRules } from '../../lib/raffleRules';
import { deliveredText, plural, PrizeIcon, prizeTally, StockDots, toneOf } from './PrizeParts';
import type { RaffleContext } from './types';

/**
 * The official prizes by category, as the server holds them. Coordinación does not create categories or prizes here:
 * the catalog is fixed, and when it is not (completely) registered there is ONE action to prepare it.
 */
export default function RafflePrizes({ ctx }: { ctx: RaffleContext }) {
  const { plan, categories, prizesLoading, winners } = ctx;
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState('');

  const registered = plan.entries.filter((entry) => entry.prize);
  const delivered = registered.reduce((sum, entry) => sum + prizeTally(entry.prize!, winners).confirmed, 0);
  const left = registered.reduce((sum, entry) => sum + prizeTally(entry.prize!, winners).left, 0);
  const firstLoad = prizesLoading && registered.length === 0 && plan.status !== 'blocked';

  return (
    <div className="ad-page">
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="rf-stats" aria-label="Resumen de premios">
        <div><strong>{OFFICIAL_UNITS}</strong><span>premios oficiales en {OFFICIAL_CATALOG.length} categorías</span></div>
        <div><strong>{firstLoad ? '·' : delivered}</strong><span>{delivered === 1 ? 'entregado' : 'entregados'}</span></div>
        <div><strong>{firstLoad ? '·' : left}</strong><span>por sortear</span></div>
      </div>

      {firstLoad ? <Spinner label="Consultando los premios" /> : <CatalogStatus plan={plan} onPrepare={() => setPreparing(true)} />}

      <div className="rf-catlist">
        {OFFICIAL_CATALOG.map((official) => {
          const category = categories.find((candidate) => officialCategory(candidate.name) === official);
          const entries = plan.entries.filter((entry) => entry.categoryName === official.name);
          const units = official.items.reduce((sum, item) => sum + item.quantity, 0);
          return (
            <article key={official.name} className="rf-cat" data-tone={toneOf(official.name)} aria-label={`Categoría ${official.name}`}>
              <header className="rf-cat-head">
                <div className="rf-cat-title">
                  <h3>{official.name}</h3>
                  <p>{plural(units, 'premio', 'premios')} · {plural(official.items.length, 'tipo', 'tipos')}</p>
                </div>
                {category && <div className="ad-metric"><strong>{category.pool_count ?? 0}</strong><span>{(category.pool_count ?? 0) === 1 ? 'elegible' : 'elegibles'}</span></div>}
              </header>
              <div className="rf-cat-prizes">
                {entries.map((entry) => <PrizeLine key={entry.item.key} entry={entry} winners={winners} loading={prizesLoading && !entry.prize} />)}
              </div>
              {category && <p className="rf-cat-rule"><strong>Quién participa:</strong> {describeRules(categoryRules(category))}</p>}
            </article>
          );
        })}
      </div>

      {plan.extras.length > 0 && (
        <details className="ad-inline-note rf-extras">
          <summary>Premios anteriores que no forman parte del catálogo oficial · {plan.extras.length}</summary>
          <p>Siguen en el servidor, pero no se ofrecen en el sorteo ni se modifican desde aquí. Nada se elimina automáticamente.</p>
          <ul>
            {plan.extras.map(({ prize, categoryName, reason }) => (
              <li key={prize.id}><strong>{prize.name}</strong> · {categoryName} · {plural(prize.quantity, 'unidad', 'unidades')}, {plural(prize.delivered, 'comprometida', 'comprometidas')}
                {reason === 'duplicate' ? ' · repite un premio oficial' : ''}{prize.is_active ? '' : ' · inactivo'}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="ad-inline-note rf-tech">
        <summary>Detalles técnicos</summary>
        <p>El sorteo trabaja con el conjunto de registros {ctx.dataSet === 'demo' ? 'de prueba (is_demo)' : 'reales (no is_demo)'} que corresponde a {ctx.rehearsal ? 'este ensayo' : 'la operación oficial'}. Sus premios, participantes y ganadores no se mezclan con los del otro conjunto.</p>
      </details>

      {preparing && <PrepareModal ctx={ctx} onClose={() => setPreparing(false)} onDone={(message) => { setNotice(message); setPreparing(false); }} />}
    </div>
  );
}

function CatalogStatus({ plan, onPrepare }: { plan: CatalogPlan; onPrepare: () => void }) {
  if (plan.status === 'ready') {
    return <p className="rf-ready"><Check size={16} aria-hidden /> Los premios oficiales están registrados.{plan.conflicts > 0 && ` ${plural(plan.conflicts, 'premio tiene', 'premios tienen')} más entregas que la cantidad oficial y no se modifica.`}</p>;
  }
  if (plan.status === 'blocked') {
    return (
      <Alert tone="warning">
        No se pueden preparar los premios: {plan.missingCategories.length === 1 ? `falta la categoría ${plan.missingCategories[0]}` : `faltan las categorías ${plan.missingCategories.join(' y ')}`} en
        los registros de este sorteo. Las categorías y sus requisitos no se crean desde esta pantalla; hay que restablecerlas en el servidor.
      </Alert>
    );
  }
  const pending = plan.status === 'pending';
  return (
    <section className="rf-prepare" aria-label="Preparar premios oficiales">
      <span className="rf-prepare-icon" aria-hidden><Gift size={26} /></span>
      <div className="rf-prepare-text">
        <h3>{pending ? 'Los premios oficiales todavía no están registrados' : 'Faltan premios oficiales por registrar'}</h3>
        <p>{pending
          ? `Registra los ${OFFICIAL_UNITS} premios de Día OV 2026 para poder sortearlos. Es un solo paso y se puede repetir sin duplicar nada.`
          : `${plan.toCreate > 0 ? `Faltan ${plural(plan.toCreate, 'premio', 'premios')} por registrar` : ''}${plan.toCreate > 0 && plan.toAdjust > 0 ? ' y ' : ''}${plan.toAdjust > 0 ? `${plural(plan.toAdjust, 'premio', 'premios')} por corregir` : ''}. Los que ya están no se duplican.`}
          {plan.conflicts > 0 && ` ${plural(plan.conflicts, 'premio tiene', 'premios tienen')} más entregas que la cantidad oficial y se dejará como está.`}</p>
      </div>
      <Button onClick={onPrepare}>{pending ? 'Preparar premios oficiales' : 'Completar premios oficiales'}</Button>
    </section>
  );
}

function PrizeLine({ entry, winners, loading }: { entry: PlanEntry<import('../../lib/raffleApi').RafflePrize>; winners: RaffleContext['winners']; loading: boolean }) {
  const { item, prize } = entry;
  const tally = prize ? prizeTally(prize, winners) : null;
  return (
    <div className="rf-prize-row" data-state={!prize ? 'unregistered' : tally && tally.left === 0 && tally.waiting === 0 ? 'done' : undefined}>
      <span className="rf-prize-icon"><PrizeIcon kind={item.kind} /></span>
      <div className="ad-row-main">
        <p className="ad-row-title">{item.name}</p>
        {tally ? (
          <p className="ad-row-meta">
            {deliveredText(tally.confirmed, tally.quantity)}{tally.waiting > 0 && ` · ${plural(tally.waiting, 'pendiente de confirmar', 'pendientes de confirmar')}`}
            {entry.state === 'adjust' && ' · cantidad o estado distintos al oficial'}
          </p>
        ) : <p className="ad-row-meta">{loading ? 'Consultando…' : `${plural(item.quantity, 'unidad', 'unidades')} · por registrar`}</p>}
      </div>
      {tally ? (
        <div className="rf-prize-stock" aria-label={`${tally.left} por sortear de ${tally.quantity}`}>
          <strong>{tally.left}<small> por sortear</small></strong>
          <StockDots confirmed={tally.confirmed} waiting={tally.waiting} quantity={tally.quantity} />
        </div>
      ) : <Badge tone="neutral">Pendiente</Badge>}
    </div>
  );
}

function PrepareModal({ ctx, onClose, onDone }: { ctx: RaffleContext; onClose: () => void; onDone: (message: string) => void }) {
  const { plan } = ctx;
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PrepareResult | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const outcome = await prepareOfficialCatalog(ctx.categories, { fetchPrizes, savePrize });
      setResult(outcome);
      await ctx.refresh();
      if (!outcome.error) {
        const done = [outcome.created > 0 && plural(outcome.created, 'registrado', 'registrados'), outcome.adjusted > 0 && plural(outcome.adjusted, 'corregido', 'corregidos')].filter(Boolean).join(' y ');
        const left = outcome.plan.conflicts > 0 ? ` ${plural(outcome.plan.conflicts, 'premio se dejó', 'premios se dejaron')} como estaba por tener más entregas que la cantidad oficial.` : '';
        onDone(outcome.plan.status === 'ready'
          ? (done ? `Premios oficiales listos: ${done}.` : 'Los premios oficiales ya estaban registrados.')
          : `Premios oficiales preparados: ${done || 'sin cambios'}.${left}`);
      }
    } catch (cause) {
      setResult({ created: 0, adjusted: 0, error: cause, plan });
    } finally { setRunning(false); }
  };

  const todo = plan.entries.filter((entry) => entry.state === 'missing' || entry.state === 'adjust');
  return (
    <Modal title="Preparar premios oficiales" onClose={running ? () => undefined : onClose}>
      <div className="space-y-4">
        <p className="text-sm">Se registrarán en el servidor los premios que faltan de Día OV 2026. No se borra nada, no se tocan ganadores ni selecciones pendientes y, si se repite, no se duplica nada.</p>
        <ul className="rf-plan-list">
          {todo.map((entry) => (
            <li key={entry.item.key}><PrizeIcon kind={entry.item.kind} size={16} /> <span><strong>{entry.item.name}</strong> · {entry.categoryName} · {plural(entry.item.quantity, 'unidad', 'unidades')}
              <em>{entry.state === 'missing' ? 'se registra' : 'se corrige'}</em></span></li>
          ))}
          {todo.length === 0 && <li>No hay nada que registrar.</li>}
        </ul>
        {result?.error ? (
          <Alert tone="error">
            No se pudo terminar ({friendlyError(result.error)}). {result.created + result.adjusted > 0 ? `Ya quedaron ${plural(result.created + result.adjusted, 'premio', 'premios')}. ` : ''}Puedes volver a intentarlo: continúa donde se quedó, sin duplicar.
          </Alert>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={running}>Cancelar</Button>
          <Button type="button" onClick={() => void run()} loading={running} disabled={todo.length === 0 && !result?.error}>{result?.error ? 'Reintentar' : 'Preparar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
