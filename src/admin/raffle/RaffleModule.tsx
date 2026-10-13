import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, LoadError, Spinner } from '../../components/ui';
import { useEdition } from '../../edition/EditionProvider';
import { fetchOperatorView, fetchPrizes, fetchWinners, type RafflePrize, type RaffleWinner } from '../../lib/raffleApi';
import { OFFICIAL_CATALOG, officialCategory, planCatalog } from '../../lib/raffleCatalog';
import { readSetChoice, writeSetChoice } from '../../lib/raffleSetChoice';
import { resolveDataSet, scopeOf, type RaffleScope } from '../../lib/raffleShow';
import { useLoad } from '../../lib/useLoad';
import { PageHeader, SectionTabs } from '../design/Primitives';
import RaffleHistory from './RaffleHistory';
import RafflePrizes from './RafflePrizes';
import RaffleRun from './RaffleRun';
import RaffleSetChooser, { SET_LABEL } from './RaffleSetChooser';
import type { RaffleContext, RaffleSection } from './types';
import './raffle.css';

const DESCRIPTIONS: Record<RaffleSection, string> = {
  vivo: 'Elige un premio, inicia el sorteo, revela al ganador y confírmalo.',
  premios: 'Los premios oficiales de Día OV 2026, con lo que ya se entregó y lo que falta por sortear.',
  ganadores: 'Quién ganó cada premio, si ya lo recibió y cuándo.',
};

/** Links from before the simplification keep working. */
const LEGACY: Record<string, RaffleSection> = { ejecutar: 'vivo', preparacion: 'premios', historial: 'ganadores' };

type Snapshot = { key: string; prizes: Record<string, RafflePrize[]>; winners: RaffleWinner[] | null };

/**
 * Sorteo final in three places: the live draw (where it opens), the official prizes (Coordinación) and the winners.
 * The edition's mode says whether this is the event rehearsal or the official draw. Which set of server records is used
 * is decided by that mode (and, in rehearsal, by Coordinación's explicit choice), never by counting participants, and it
 * is derived on every render so a change of mode cannot leave the previous set behind.
 *
 * Reads are all-or-nothing: the inventory shown is always ONE complete read. If a refresh fails the last complete read
 * stays on screen, marked as possibly out of date, and only NEW draws are held back; a round already in progress keeps
 * working. A failed first read is shown as such, never as an empty catalog.
 */
export default function RaffleModule({ canConfigure }: { canConfigure: boolean }) {
  const { edition } = useEdition();
  const editionId = edition?.id ?? 'edition';
  const rehearsal = edition?.mode === 'preparacion';
  const { data, error, reload } = useLoad(fetchOperatorView, []);
  const [choice, setChoice] = useState<RaffleScope | null>(() => readSetChoice(editionId));
  const [choosing, setChoosing] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => { setChoice(readSetChoice(editionId)); }, [editionId]);
  const dataSet = resolveDataSet({ rehearsal, canConfigure, choice });

  const sections: { value: RaffleSection; label: string }[] = [
    { value: 'vivo', label: 'Sorteo en vivo' },
    ...(canConfigure ? [{ value: 'premios' as const, label: 'Premios' }] : []),
    { value: 'ganadores', label: 'Ganadores' },
  ];
  const asked = params.get('seccion') ?? '';
  const requested = (LEGACY[asked] ?? asked) as RaffleSection;
  const section = sections.find((item) => item.value === requested)?.value ?? 'vivo';
  const goTo = useCallback((next: RaffleSection) => setParams({ seccion: next }, { replace: true }), [setParams]);

  const allCategories = useMemo(() => (dataSet === null ? [] : (data?.categories ?? []).filter((category) => scopeOf(category) === dataSet)), [data, dataSet]);
  const categories = useMemo(
    () => OFFICIAL_CATALOG.flatMap((official) => allCategories.filter((category) => officialCategory(category.name) === official)),
    [allCategories],
  );
  const key = `${dataSet}:${categories.map((category) => category.id).join(',')}`;

  useEffect(() => {
    if (!data || dataSet === null) return;
    if (categories.length === 0) { setSnapshot({ key, prizes: {}, winners: [] }); setFailedKey(null); return; }
    let cancelled = false;
    setReading(true);
    Promise.all([Promise.allSettled(categories.map((category) => fetchPrizes(category.id))), fetchWinners().catch(() => null)])
      .then(([settled, winners]) => {
        if (cancelled) return;
        if (settled.every((result) => result.status === 'fulfilled')) {
          // publishes ONE complete read: never a mix of new and old inventory
          setSnapshot({ key, prizes: Object.fromEntries(categories.map((category, index) => [category.id, (settled[index] as PromiseFulfilledResult<RafflePrize[]>).value])), winners });
          setFailedKey(null);
        } else {
          console.error('raffle prizes read failed', settled.filter((result) => result.status === 'rejected'));
          setFailedKey(key);
        }
      })
      .finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [data, dataSet, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => { setRefreshing(true); try { await reload(); } finally { setRefreshing(false); } }, [reload]);
  const current = snapshot && snapshot.key === key ? snapshot : null;
  const plan = useMemo(() => planCatalog(categories, current?.prizes ?? {}), [categories, current]);
  const prizes = useMemo(() => {
    if (!current) return {} as Record<string, RafflePrize[]>;
    const byCategory: Record<string, RafflePrize[]> = {};
    for (const entry of plan.entries) if (entry.prize && entry.categoryId) (byCategory[entry.categoryId] ??= []).push(entry.prize);
    for (const category of categories) byCategory[category.id] ??= [];
    return byCategory;
  }, [plan, categories, current]);
  const winners = useMemo(() => {
    if (!current?.winners) return null;
    const ids = new Set(allCategories.map((category) => category.id));
    return current.winners.filter((winner) => ids.has(winner.category_id));
  }, [current, allCategories]);

  if (!data) return error ? <LoadError error={error} onRetry={reload} /> : <Spinner />;

  const needsChoice = dataSet === null;
  const initialFailure = !needsChoice && failedKey === key && !current;
  const stale = !needsChoice && !!current && (failedKey === key || !!error);
  const chooseSet = (set: RaffleScope) => { writeSetChoice(editionId, set); setChoice(set); setChoosing(false); setSnapshot(null); setFailedKey(null); };
  const pendingResult = !!winners?.some((winner) => winner.status === 'seleccionado');

  const context: RaffleContext | null = needsChoice ? null : {
    rehearsal, dataSet, categories, allCategories, prizes, plan, winners, loaded: !!current, stale, canConfigure,
    prizesLoading: !current && !initialFailure ? true : reading || refreshing, refresh, goTo, setRoundActive,
  };

  return (
    <div className="ad-page rf-module">
      <PageHeader eyebrow="Operación / Sorteo" title="Sorteo final" description={DESCRIPTIONS[section]} action={<ModeBadge rehearsal={rehearsal} />} />
      <SectionTabs label="Secciones del sorteo" tabs={sections} value={section} onChange={goTo} />
      {(needsChoice || choosing) ? (
        <RaffleSetChooser categories={data.categories} current={dataSet} onChoose={chooseSet} onCancel={needsChoice ? undefined : () => setChoosing(false)} />
      ) : initialFailure ? (
        <Alert tone="error">
          <div className="rf-alert-row">
            <span>No se pudieron consultar los premios. No significa que no existan: no hay conexión con el servidor o respondió con un error.</span>
            <Button variant="secondary" onClick={() => void refresh()} loading={refreshing || reading}>Reintentar</Button>
          </div>
        </Alert>
      ) : context && (
        <>
          {stale && (
            <Alert tone="warning">
              <div className="rf-alert-row">
                <span>No se pudo actualizar la información del servidor. Se muestran los últimos datos conocidos y pueden estar desactualizados; hasta actualizar no se inician sorteos nuevos. Lo que ya está en curso se puede resolver con normalidad.</span>
                <Button variant="secondary" onClick={() => void refresh()} loading={refreshing || reading}>Reintentar</Button>
              </div>
            </Alert>
          )}
          {rehearsal && canConfigure && section === 'vivo' && dataSet && (
            <p className="rf-setline">Ensayo con: <strong>{SET_LABEL[dataSet]}</strong>
              <button type="button" className="rf-link" disabled={roundActive || pendingResult} onClick={() => setChoosing(true)}
                title={roundActive || pendingResult ? 'Termina la ronda en curso para cambiar los registros.' : undefined}>Cambiar</button></p>
          )}
          {section === 'vivo' && <RaffleRun key={context.dataSet} ctx={context} />}
          {section === 'premios' && canConfigure && <RafflePrizes ctx={context} changeSet={rehearsal ? () => setChoosing(true) : undefined} locked={roundActive || pendingResult} />}
          {section === 'ganadores' && <RaffleHistory ctx={context} />}
        </>
      )}
    </div>
  );
}

/** «Ensayo del evento» or «Sorteo oficial»: the edition's mode, in the words of the event. */
export function ModeBadge({ rehearsal }: { rehearsal: boolean }) {
  return (
    <p className="rf-mode" data-rehearsal={rehearsal || undefined} role="status">
      <i aria-hidden />
      <span><strong>{rehearsal ? 'Ensayo del evento' : 'Sorteo oficial'}</strong>
        <small>{rehearsal ? 'Las selecciones se guardan como pruebas y deberán limpiarse antes del evento.' : 'Los resultados son definitivos'}</small></span>
    </p>
  );
}
