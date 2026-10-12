import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, LoadError, Spinner } from '../../components/ui';
import { useEdition } from '../../edition/EditionProvider';
import { friendlyError } from '../../lib/errors';
import { fetchOperatorView, fetchPrizes, type RafflePrize } from '../../lib/raffleApi';
import { scopeOf, type RaffleScope } from '../../lib/raffleShow';
import { useLoad } from '../../lib/useLoad';
import { PageHeader, ScopeSwitch, SectionTabs } from '../design/Primitives';
import RaffleHistory from './RaffleHistory';
import RafflePreparation from './RafflePreparation';
import RaffleRun from './RaffleRun';
import type { RaffleContext, RaffleSection } from './types';
import './raffle.css';

const DESCRIPTIONS: Record<RaffleSection, string> = {
  preparacion: 'Define categorías y premios y revisa cuántos participantes entran al sorteo de cada una.',
  ejecutar: 'Elige categoría y premio, lanza el sorteo y proyéctalo en pantalla para el público.',
  historial: 'Consulta cada ganador con su premio, su estado y, si aplica, el motivo de la invalidación.',
};

/**
 * The raffle in three separate places: Preparación (configure), Ejecutar (operate and project) and Historial (results).
 * Staff with only the «sorteo» role operate the environment of the current mode and cannot configure anything.
 */
export default function RaffleModule({ canConfigure }: { canConfigure: boolean }) {
  const { edition } = useEdition();
  const modeScope: RaffleScope = edition?.mode === 'preparacion' ? 'demo' : 'real';
  const [pickedScope, setPickedScope] = useState<RaffleScope>(modeScope);
  const scope = canConfigure ? pickedScope : modeScope;
  const { data, error, loading, reload } = useLoad(fetchOperatorView, []);
  const [prizes, setPrizes] = useState<Record<string, RafflePrize[]>>({});
  const [prizesLoading, setPrizesLoading] = useState(false);
  const [prizesError, setPrizesError] = useState('');
  // True from the moment a refresh starts until the new pools AND prizes are in, so no screen reads half-updated numbers.
  const [stale, setStale] = useState(false);
  const [params, setParams] = useSearchParams();

  const sections: { value: RaffleSection; label: string }[] = [
    ...(canConfigure ? [{ value: 'preparacion' as const, label: 'Preparación' }] : []),
    { value: 'ejecutar', label: 'Ejecutar sorteo' },
    { value: 'historial', label: 'Historial' },
  ];
  const requested = params.get('seccion') as RaffleSection | null;
  const section = sections.find((item) => item.value === requested)?.value ?? sections[0].value;
  const goTo = useCallback((next: RaffleSection) => setParams({ seccion: next }, { replace: true }), [setParams]);

  const categories = useMemo(
    () => (data?.categories ?? []).filter((category) => scopeOf(category) === scope),
    [data, scope],
  );

  useEffect(() => {
    if (categories.length === 0) { setPrizes({}); setPrizesError(''); setStale(false); return; }
    let cancelled = false;
    setPrizesLoading(true); setPrizesError('');
    Promise.all(categories.map(async (category) => [category.id, await fetchPrizes(category.id)] as const))
      .then((entries) => { if (!cancelled) setPrizes(Object.fromEntries(entries)); })
      .catch((cause) => { if (!cancelled) setPrizesError(friendlyError(cause)); })
      .finally(() => { if (!cancelled) { setPrizesLoading(false); setStale(false); } });
    return () => { cancelled = true; };
  }, [categories]);

  const refresh = useCallback(async () => { setStale(true); await reload(); }, [reload]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const context: RaffleContext = {
    scope, categories, prizes, canConfigure, prizesLoading: prizesLoading || stale, refresh, goTo,
    unassigned: data.unassigned_combinations,
    unassignedVisible: canConfigure && scope === modeScope && data.unassigned_combinations.length > 0,
  };

  return (
    <div className="ad-page rf-module">
      <PageHeader eyebrow="Operación / Sorteo" title="Sorteo final" description={DESCRIPTIONS[section]} />
      <SectionTabs label="Secciones del sorteo" tabs={sections} value={section} onChange={goTo} />
      <div className="rf-env" data-scope={scope}>
        <div className="rf-env-text">
          <span className="rf-env-dot" aria-hidden />
          <div>
            <p className="rf-env-title">{scope === 'demo' ? 'Datos de prueba' : 'Datos reales'}</p>
            <p className="rf-env-help">{scope === 'demo'
              ? 'Ensayo con participantes de prueba: nada de esto cuenta para el evento.'
              : 'Participantes y resultados de la edición real.'}</p>
          </div>
        </div>
        {canConfigure && (
          <ScopeSwitch label="Entorno del sorteo" value={scope} onChange={setPickedScope}
            options={[{ value: 'real', label: 'Datos reales' }, { value: 'demo', label: 'Datos de prueba' }]} />
        )}
      </div>
      {prizesError && <Alert tone="error">{prizesError}</Alert>}
      {section === 'preparacion' && canConfigure && <RafflePreparation ctx={context} />}
      {section === 'ejecutar' && <RaffleRun key={scope} ctx={context} />}
      {section === 'historial' && <RaffleHistory ctx={context} />}
    </div>
  );
}
