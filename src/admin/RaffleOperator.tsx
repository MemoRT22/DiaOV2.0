import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Alert, Button, LoadError, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { confirmWinner, drawWinner, fetchOperatorView, fetchPendingSelection, fetchPrizes, markNoShow, type DrawResult, type RaffleCategory, type RafflePrize } from '../lib/raffleApi';
import { useLoad } from '../lib/useLoad';

type Phase = 'idle' | 'spinning' | 'result' | 'confirmed';

export default function RaffleOperator() {
  const { data, error, loading, reload } = useLoad(fetchOperatorView, []);
  const [categories, setCategories] = useState<RaffleCategory[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('');
  const [prizes, setPrizes] = useState<RafflePrize[]>([]);
  const [prizesLoading, setPrizesLoading] = useState(false);
  const [selectedPrize, setSelectedPrize] = useState<RafflePrize | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [drawResult, setDrawResult] = useState<DrawResult | null>(null);
  const [displayMode, setDisplayMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => { if (data) { setCategories(data.categories); if (!selectedCat && data.categories.length) setSelectedCat(data.categories[0].id); } }, [data]);

  useEffect(() => {
    if (!selectedCat) return;
    setPrizesLoading(true); setSelectedPrize(null); setPhase('idle'); setDrawResult(null);
    fetchPrizes(selectedCat).then(setPrizes).catch((e) => setActionError(friendlyError(e))).finally(() => setPrizesLoading(false));
  }, [selectedCat]);

  const handleSelectPrize = useCallback(async (prize: RafflePrize) => {
    setSelectedPrize(prize);
    setPhase('idle');
    setDrawResult(null);
    setActionError('');
    try {
      const pending = await fetchPendingSelection(prize.id);
      if (pending.winner_id) {
        setDrawResult({
          winner_id: pending.winner_id,
          participant_id: '',
          display_name: pending.display_name ?? 'Participante',
          prize_id: prize.id,
          prize_name: pending.prize_name ?? prize.name,
          category_id: '',
          category_name: pending.category_name ?? '',
          status: 'seleccionado',
          pool_size: 0,
          idempotent: false,
        });
        setPhase('result');
      }
    } catch { /* premio sin seleccion pendente */ }
  }, []);

  const handleDraw = useCallback(async () => {
    if (!selectedPrize) return;
    const key = `${selectedPrize.id}-${Date.now()}`;
    setBusy(true); setActionError(''); setPhase('spinning');
    try { const result = await drawWinner(selectedPrize.id, key); setDrawResult(result); setPhase('result'); }
    catch (cause) { setActionError(friendlyError(cause)); setPhase('idle'); }
    finally { setBusy(false); }
  }, [selectedPrize]);

  const handleConfirm = useCallback(async () => {
    if (!drawResult) return;
    setBusy(true); setActionError('');
    try { await confirmWinner(drawResult.winner_id); setPhase('confirmed'); }
    catch (cause) { setActionError(friendlyError(cause)); }
    finally { setBusy(false); }
  }, [drawResult]);

  const handleNoShow = useCallback(async () => {
    if (!drawResult) return;
    setBusy(true); setActionError('');
    try { await markNoShow(drawResult.winner_id); setDrawResult(null); setPhase('idle'); if (selectedCat) fetchPrizes(selectedCat).then(setPrizes).catch(() => {}); }
    catch (cause) { setActionError(friendlyError(cause)); }
    finally { setBusy(false); }
  }, [drawResult, selectedCat]);

  const prepareNext = () => { setDrawResult(null); setPhase('idle'); setSelectedPrize(null); if (selectedCat) fetchPrizes(selectedCat).then(setPrizes).catch(() => {}); };

  if (loading && !data) return <Spinner />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  if (displayMode && drawResult) {
    return <PresentationRoulette result={drawResult} onExit={() => setDisplayMode(false)} />;
  }

  const poolCount = categories.find((c) => c.id === selectedCat)?.pool_count ?? 0;

  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-extrabold">Sorteo final</h1><p className="mt-1 text-sm text-ink-muted">Selecciona una categoría y un premio para sortear.</p></header>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Categorías</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button key={c.id} onClick={() => setSelectedCat(c.id)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${selectedCat === c.id ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted hover:text-ink'}`}>
              {c.name} <span className="opacity-70">· {c.pool_count} candidatos</span>
            </button>
          ))}
          {categories.length === 0 && <p className="text-sm text-ink-muted">Sin categorías.</p>}
        </div>
      </section>
      {prizesLoading ? <Spinner /> : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Premios de {categories.find((c) => c.id === selectedCat)?.name ?? ''}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {prizes.map((p) => (
              <button key={p.id} onClick={() => handleSelectPrize(p)} disabled={p.available <= 0 || !p.is_active}
                className={`card p-4 text-left transition-all disabled:opacity-50 ${selectedPrize?.id === p.id ? 'border-primary-500 ring-2 ring-primary-500/30' : 'hover:border-secondary-400'}`}>
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-ink-muted">{p.available} de {p.quantity} disponibles</p>
                {p.description && <p className="mt-1 text-xs text-ink-muted">{p.description}</p>}
              </button>
            ))}
            {prizes.length === 0 && <p className="text-sm text-ink-muted">Sin premios en esta categoría.</p>}
          </div>
        </section>
      )}
      {selectedPrize && phase === 'idle' && (
        <div className="card p-6 text-center">
          <p className="text-sm text-ink-muted">Listo para sortear</p>
          <p className="mt-2 text-xl font-extrabold">{selectedPrize.name}</p>
          <p className="text-sm text-ink-muted">{poolCount} candidatos en el pool</p>
          <Button onClick={handleDraw} loading={busy} className="mt-4">Sortear</Button>
        </div>
      )}
      {phase === 'spinning' && <div className="card p-6 text-center"><Spinner label="Sorteando…" /></div>}
      {phase === 'result' && drawResult && (
        <div className="card space-y-4 p-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Ganador seleccionado</p>
          <p className="text-3xl font-extrabold text-primary-400">{drawResult.display_name}</p>
          <p className="text-sm text-ink-muted">{drawResult.prize_name} · {drawResult.category_name}</p>
          <p className="text-xs text-ink-muted">Pool de {drawResult.pool_size} candidatos</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={handleConfirm} loading={busy} variant="secondary"><Check className="h-4 w-4" aria-hidden /> Confirmar entrega</Button>
            <Button onClick={handleNoShow} loading={busy} variant="ghost"><X className="h-4 w-4" aria-hidden /> No se presentó</Button>
            <Button onClick={() => setDisplayMode(true)} variant="ghost">Modo presentación</Button>
          </div>
        </div>
      )}
      {phase === 'confirmed' && (
        <div className="card space-y-4 p-6 text-center">
          <p className="text-2xl font-extrabold text-success-400">¡Premio confirmado!</p>
          <p className="text-sm text-ink-muted">{drawResult?.display_name} · {drawResult?.prize_name}</p>
          <Button onClick={prepareNext}>Preparar siguiente premio</Button>
        </div>
      )}
    </div>
  );
}

function PresentationRoulette({ result, onExit }: { result: DrawResult; onExit: () => void }) {
  const [spinning, setSpinning] = useState(true);
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) { setSpinning(false); return; }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden" style={{ background: 'radial-gradient(ellipse at center, #0a0e27 0%, #000 100%)' }}>
      <div className="pointer-events-none absolute inset-0 opacity-30">
        {Array.from({ length: 50 }).map((_, i) => (
          <div key={i} className="absolute rounded-full bg-white" style={{
            width: `${1 + Math.random() * 2}px`, height: `${1 + Math.random() * 2}px`,
            left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
            opacity: Math.random(), animation: `twinkle ${2 + Math.random() * 3}s infinite alternate`,
          }} />
        ))}
      </div>
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary-300">{result.category_name}</p>
        <p className="mt-4 text-2xl font-extrabold text-white/80">{result.prize_name}</p>
        <div className="mt-12 flex h-48 items-center justify-center">
          {spinning ? (
            <div className="flex flex-col items-center">
              <div className="h-16 w-16 animate-spin rounded-full border-4 border-white/20 border-t-primary-400" />
              <p className="mt-4 text-sm text-white/60">Sorteando…</p>
            </div>
          ) : (
            <p className="font-display text-5xl font-extrabold text-primary-400 drop-shadow-[0_0_30px_rgba(96,165,250,0.6)] sm:text-7xl"
              style={{ animation: 'winnerReveal 0.6s ease-out' }}>{result.display_name}</p>
          )}
        </div>
        {!spinning && <div className="mt-8 animate-fade-up"><p className="text-xl font-semibold text-white/90">¡Ganador!</p></div>}
        <button onClick={onExit} className="mt-12 rounded-full border border-white/20 px-6 py-2 text-sm font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white">Salir de presentación</button>
      </div>
      <style>{`@keyframes twinkle { 0% { opacity: 0.2; } 100% { opacity: 1; } } @keyframes winnerReveal { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.15); } 100% { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
}
