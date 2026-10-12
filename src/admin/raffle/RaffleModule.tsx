import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoadError, Spinner } from '../../components/ui';
import { useEdition } from '../../edition/EditionProvider';
import { fetchOperatorView, fetchPrizes, fetchWinners, type RafflePrize, type RaffleWinner } from '../../lib/raffleApi';
import { OFFICIAL_CATALOG, officialCategory, planCatalog } from '../../lib/raffleCatalog';
import { pickDataSet, scopeOf, type RaffleScope } from '../../lib/raffleShow';
import { useLoad } from '../../lib/useLoad';
import { PageHeader, SectionTabs } from '../design/Primitives';
import RafflePrizes from './RafflePrizes';
import RaffleHistory from './RaffleHistory';
import RaffleRun from './RaffleRun';
import type { RaffleContext, RaffleSection } from './types';
import './raffle.css';

const DESCRIPTIONS: Record<RaffleSection, string> = {
  vivo: 'Elige un premio, inicia el sorteo, revela al ganador y confírmalo.',
  premios: 'Los premios oficiales de Día OV 2026, con lo que ya se entregó y lo que falta por sortear.',
  ganadores: 'Quién ganó cada premio, si ya lo recibió y cuándo.',
};

/** Links from before the simplification keep working. */
const LEGACY: Record<string, RaffleSection> = { ejecutar: 'vivo', preparacion: 'premios', historial: 'ganadores' };

/**
 * Sorteo final in three places: the live draw (where it opens), the official prizes (Coordinación) and the winners.
 * The operator never chooses between «real» and «demo» data: the edition's mode says whether this is the event rehearsal
 * or the official draw, and the matching set of server records is picked for them. Staff with only the «sorteo» role run
 * the draw and read the results; they cannot prepare prizes or invalidate.
 */
export default function RaffleModule({ canConfigure }: { canConfigure: boolean }) {
  const { edition } = useEdition();
  const rehearsal = edition?.mode === 'preparacion';
  const { data, error, loading, reload } = useLoad(fetchOperatorView, []);
  const [rawPrizes, setRawPrizes] = useState<Record<string, RafflePrize[]>>({});
  const [winnersAll, setWinnersAll] = useState<RaffleWinner[] | null>(null);
  const [prizesLoading, setPrizesLoading] = useState(false);
  // False until the first read of the prizes has finished: before that the screens must not mistake «not read yet» for «none».
  const [loaded, setLoaded] = useState(false);
  // True from the moment a refresh starts until the new pools AND prizes are in, so no screen reads half-updated numbers.
  const [stale, setStale] = useState(false);
  const [params, setParams] = useSearchParams();
  const chosen = useRef<RaffleScope | null>(null);
  if (data && chosen.current === null) chosen.current = pickDataSet({ rehearsal, canConfigure, categories: data.categories });
  const dataSet = chosen.current ?? (rehearsal ? 'demo' : 'real');

  const sections: { value: RaffleSection; label: string }[] = [
    { value: 'vivo', label: 'Sorteo en vivo' },
    ...(canConfigure ? [{ value: 'premios' as const, label: 'Premios' }] : []),
    { value: 'ganadores', label: 'Ganadores' },
  ];
  const asked = params.get('seccion') ?? '';
  const requested = (LEGACY[asked] ?? asked) as RaffleSection;
  const section = sections.find((item) => item.value === requested)?.value ?? 'vivo';
  const goTo = useCallback((next: RaffleSection) => setParams({ seccion: next }, { replace: true }), [setParams]);

  const allCategories = useMemo(() => (data?.categories ?? []).filter((category) => scopeOf(category) === dataSet), [data, dataSet]);
  const categories = useMemo(
    () => OFFICIAL_CATALOG.flatMap((official) => allCategories.filter((category) => officialCategory(category.name) === official)),
    [allCategories],
  );

  useEffect(() => {
    if (!data) return; // nothing to read yet: this is not «no prizes»
    if (categories.length === 0) { setRawPrizes({}); setWinnersAll(null); setStale(false); setLoaded(true); return; }
    let cancelled = false;
    setPrizesLoading(true);
    Promise.all([
      Promise.all(categories.map(async (category) => [category.id, await fetchPrizes(category.id)] as const)),
      fetchWinners().catch(() => null),
    ])
      .then(([entries, winners]) => { if (!cancelled) { setRawPrizes(Object.fromEntries(entries)); setWinnersAll(winners); } })
      .catch((cause) => { console.error('raffle prizes load failed', cause); if (!cancelled) setRawPrizes({}); })
      .finally(() => { if (!cancelled) { setPrizesLoading(false); setStale(false); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [data, categories]);

  const refresh = useCallback(async () => { setStale(true); await reload(); }, [reload]);
  const plan = useMemo(() => planCatalog(categories, rawPrizes), [categories, rawPrizes]);
  const prizes = useMemo(() => {
    const byCategory: Record<string, RafflePrize[]> = {};
    for (const entry of plan.entries) if (entry.prize && entry.categoryId) (byCategory[entry.categoryId] ??= []).push(entry.prize);
    for (const category of categories) byCategory[category.id] ??= [];
    return byCategory;
  }, [plan, categories]);
  const winners = useMemo(() => {
    if (!winnersAll) return null;
    const ids = new Set(allCategories.map((category) => category.id));
    return winnersAll.filter((winner) => ids.has(winner.category_id));
  }, [winnersAll, allCategories]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const context: RaffleContext = {
    rehearsal, dataSet, categories, allCategories, prizes, plan, winners, canConfigure, prizesLoading: !loaded || prizesLoading || stale, refresh, goTo,
  };

  return (
    <div className="ad-page rf-module">
      <PageHeader eyebrow="Operación / Sorteo" title="Sorteo final" description={DESCRIPTIONS[section]}
        action={<ModeBadge rehearsal={rehearsal} />} />
      <SectionTabs label="Secciones del sorteo" tabs={sections} value={section} onChange={goTo} />
      {section === 'vivo' && <RaffleRun ctx={context} />}
      {section === 'premios' && canConfigure && <RafflePrizes ctx={context} />}
      {section === 'ganadores' && <RaffleHistory ctx={context} />}
    </div>
  );
}

/** «Ensayo del evento» or «Sorteo oficial»: the edition's mode, in the words of the event. */
export function ModeBadge({ rehearsal }: { rehearsal: boolean }) {
  return (
    <p className="rf-mode" data-rehearsal={rehearsal || undefined} role="status">
      <i aria-hidden />
      <span><strong>{rehearsal ? 'Ensayo del evento' : 'Sorteo oficial'}</strong>
        <small>{rehearsal ? 'Pruebas: aún no cuenta como entrega' : 'Los resultados son definitivos'}</small></span>
    </p>
  );
}
