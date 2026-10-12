import { Check, EyeOff, Maximize2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Badge, Button } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import {
  confirmWinner, drawWinner, fetchPendingSelection, markNoShow,
  type RaffleCategory, type RafflePrize,
} from '../../lib/raffleApi';
import { drawBlocker, initialCategory, initialPrize, isDrawable, nextTarget, SPIN_MS, unitsLeft } from '../../lib/raffleShow';
import { DataPanel, EmptyState } from '../design/Primitives';
import { InvalidateModal } from './RaffleModals';
import RaffleStage, { useReducedMotion, type StagePhase, type StageResult } from './RaffleStage';
import type { RaffleContext } from './types';

const EMPTY: RafflePrize[] = [];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorCode = (cause: unknown) => (cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : '');
const newKey = (prizeId: string) => `${prizeId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * The operating console: pick category and prize, draw, reveal and decide, round after round. The same stage can be
 * taken to full screen (projection mode) with the operator's controls reduced to a discreet dock.
 */
export default function RaffleRun({ ctx }: { ctx: RaffleContext }) {
  const { categories, prizes, scope, canConfigure, prizesLoading } = ctx;
  const reduced = useReducedMotion();
  const [categoryId, setCategoryId] = useState('');
  const [prizeId, setPrizeId] = useState('');
  const [phase, setPhase] = useState<StagePhase>('idle');
  const [result, setResult] = useState<StageResult | null>(null);
  const [revealDone, setRevealDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Record<string, StageResult>>({});
  const [projecting, setProjecting] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const token = useRef(0);
  const started = useRef(false);
  const latest = useRef({ prizes, categories });
  latest.current = { prizes, categories };

  const category = categories.find((item) => item.id === categoryId);
  const categoryPrizes = prizes[categoryId] ?? EMPTY;
  const prize = categoryPrizes.find((item) => item.id === prizeId);
  const poolCount = category?.pool_count ?? 0;
  const blocker = prizesLoading ? null : drawBlocker(category, categoryPrizes, prize, poolCount);
  const locked = busy || phase === 'drawing';

  /** Winners left pending (a reload, another operator) among the given prizes, by prize. */
  const findPending = useCallback(async (list: RafflePrize[]) => {
    const found: Record<string, StageResult> = {};
    await Promise.all(list.map(async (item) => {
      try {
        const current = await fetchPendingSelection(item.id);
        if (current.winner_id) found[item.id] = {
          winnerId: current.winner_id, name: current.display_name ?? 'Participante', prizeName: current.prize_name ?? item.name,
          categoryName: current.category_name ?? '', poolSize: 0, fresh: false,
        };
      } catch { /* without pending information the prize is simply drawn from scratch */ }
    }));
    return found;
  }, []);

  /** Selects a category and, within it, the prize that deserves attention first (a pending winner, else one with units). */
  const enter = useCallback(async (nextCategory: string, preferred?: string) => {
    const mine = ++token.current;
    setCategoryId(nextCategory); setPhase('idle'); setResult(null); setRevealDone(false); setError(''); setNotice('');
    const list = latest.current.prizes[nextCategory] ?? EMPTY;
    const found = await findPending(list);
    if (token.current !== mine) return;
    setPending(found);
    const pick = preferred && list.some((item) => item.id === preferred) ? preferred : initialPrize(list, Object.fromEntries(Object.keys(found).map((id) => [id, true])));
    setPrizeId(pick);
    if (found[pick]) { setResult(found[pick]); setRevealDone(true); setPhase('revealed'); }
  }, [findPending]);

  // First visit: go straight to a winner that is waiting for a decision, otherwise to the first category that can be drawn.
  useEffect(() => {
    if (started.current || categories.length === 0 || prizesLoading || !categories.every((item) => prizes[item.id])) return;
    started.current = true;
    void (async () => {
      const waiting = await findPending(categories.flatMap((item) => prizes[item.id] ?? EMPTY));
      const hit = categories.map((item) => ({ categoryId: item.id, prize: (prizes[item.id] ?? EMPTY).find((candidate) => waiting[candidate.id]) })).find((entry) => entry.prize);
      await enter(hit?.categoryId ?? initialCategory(categories, prizes), hit?.prize?.id);
    })();
  }, [categories, prizes, prizesLoading, enter, findPending]);

  // The burst has played: from here on the result is shown as is, so toggling the projection never replays it.
  useEffect(() => {
    if (!revealDone || !result?.fresh) return;
    const timer = setTimeout(() => setResult((current) => (current && current.winnerId === result.winnerId ? { ...current, fresh: false } : current)), 2000);
    return () => clearTimeout(timer);
  }, [revealDone, result?.winnerId, result?.fresh]);

  const choosePrize = (id: string) => {
    token.current += 1;
    setPrizeId(id); setError(''); setNotice('');
    const resume = pending[id];
    setResult(resume ?? null); setRevealDone(!!resume); setPhase(resume ? 'revealed' : 'idle');
  };

  const draw = async () => {
    if (!category || !prize || blocker || locked || prizesLoading) return;
    const mine = ++token.current;
    setBusy(true); setError(''); setNotice(''); setResult(null); setRevealDone(false); setPhase('drawing');
    try {
      const [drawn] = await Promise.all([drawWinner(prize.id, newKey(prize.id)), wait(reduced ? 600 : SPIN_MS)]);
      const next: StageResult = {
        winnerId: drawn.winner_id, name: drawn.display_name, prizeName: drawn.prize_name ?? prize.name,
        categoryName: drawn.category_name ?? category.name, poolSize: drawn.pool_size ?? poolCount, fresh: true,
      };
      if (token.current !== mine) return;
      setResult(next); setPending((current) => ({ ...current, [prize.id]: { ...next, fresh: false } })); setPhase('revealed');
      void ctx.refresh();
    } catch (cause) {
      if (token.current !== mine) return;
      setPhase('idle'); setError(friendlyError(cause));
      if (errorCode(cause) === 'PENDING_SELECTION') await enter(category.id, prize.id);
    } finally { setBusy(false); }
  };

  const settle = async (action: () => Promise<unknown>, after: () => void) => {
    if (!result) return;
    setBusy(true); setError('');
    try { await action(); setPending((current) => { const { [prizeId]: _gone, ...rest } = current; return rest; }); after(); await ctx.refresh(); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const confirm = () => settle(() => confirmWinner(result!.winnerId), () => setPhase('confirmed'));
  const noShow = () => settle(() => markNoShow(result!.winnerId), () => {
    setNotice(`${result!.name} no se presentó. El premio sigue disponible: puedes volver a sortear.`);
    setResult(null); setRevealDone(false); setPhase('idle');
  });

  const nextRound = () => {
    const target = nextTarget(categories, prizes, { categoryId, prizeId });
    if (!target) { setPhase('idle'); setResult(null); setNotice('Ya no quedan premios por sortear en este entorno.'); return; }
    void enter(target.categoryId, target.prizeId);
  };

  // On a wide screen the console should open with the stage fully in view (the environment banner stays visible above it).
  useEffect(() => {
    if (window.innerWidth < 1000) return;
    document.querySelector('.rf-module .rf-env')?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exitProjection = useCallback(() => setProjecting(false), []);

  if (categories.length === 0) {
    return (
      <DataPanel><EmptyState title={`Sin categorías ${scope === 'demo' ? 'de prueba' : 'reales'}.`}
        description="Para sortear hace falta al menos una categoría con premios."
        action={canConfigure ? <Button className="mt-4" onClick={() => ctx.goTo('preparacion')}>Ir a Preparación</Button> : undefined} /></DataPanel>
    );
  }

  const actions = (variant: 'panel' | 'projection') => (
    <RoundActions variant={variant} phase={phase} revealDone={revealDone} busy={busy} refreshing={prizesLoading}
      canDraw={!blocker && !!prize} redraw={!!notice && phase === 'idle' && !!prize}
      onDraw={draw} onConfirm={confirm} onNoShow={noShow} onNext={nextRound}
      onInvalidate={variant === 'panel' && canConfigure ? () => setInvalidating(true) : undefined} />
  );
  const stageProps = {
    scope, phase, prize, poolCount, result, blocker, notice, categoryName: category?.name,
    onRevealDone: () => setRevealDone(true), alreadyRevealed: revealDone,
  };

  return (
    <div className="rf-run">
      <div className="rf-pick">
        <section aria-label="Categoría del sorteo">
          <h2 className="rf-step"><span>1</span> Categoría</h2>
          <div className="rf-choices" role="radiogroup" aria-label="Categoría">
            {categories.map((item) => <CategoryChoice key={item.id} category={item} prizes={prizes[item.id] ?? EMPTY} checked={item.id === categoryId}
              disabled={locked} onSelect={() => void enter(item.id)} />)}
          </div>
        </section>
        <section aria-label="Premio del sorteo">
          <h2 className="rf-step"><span>2</span> Premio</h2>
          {categoryPrizes.length === 0 ? (
            <div className="rf-choice-empty">
              <p><strong>Esta categoría no tiene premios.</strong></p>
              <p>{canConfigure ? 'Agrégalos en Preparación para poder sortearla.' : 'Pide a Coordinación que los configure.'}</p>
              {canConfigure && <Button variant="secondary" onClick={() => ctx.goTo('preparacion')}>Ir a Preparación</Button>}
            </div>
          ) : (
            <div className="rf-choices" role="radiogroup" aria-label="Premio">
              {categoryPrizes.map((item) => <PrizeChoice key={item.id} prize={item} pending={!!pending[item.id]} checked={item.id === prizeId}
                disabled={locked} onSelect={() => choosePrize(item.id)} />)}
            </div>
          )}
        </section>
      </div>

      <div className="rf-live">
        {error && <Alert tone="error">{error}</Alert>}
        {projecting ? (
          <div className="rf-projecting"><p>El sorteo se está proyectando en pantalla completa.</p><Button variant="secondary" onClick={exitProjection}>Salir de la proyección</Button></div>
        ) : (
          <RaffleStage {...stageProps} variant="panel"
            corner={<Button variant="secondary" className="rf-corner-btn" onClick={() => setProjecting(true)}><Maximize2 size={15} aria-hidden /> Modo proyección</Button>}>
            {actions('panel')}
          </RaffleStage>
        )}
        <p className="rf-live-help">Los participantes y el ganador los decide el servidor al sortear; esta pantalla solo los muestra. {phase === 'revealed' && 'Confirma la entrega cuando la persona se presente.'}</p>
      </div>

      {projecting && (
        <ProjectionLayer onExit={exitProjection}>
          {(controlsHidden, tools) => <RaffleStage {...stageProps} variant="projection" controlsHidden={controlsHidden} corner={tools}>{actions('projection')}</RaffleStage>}
        </ProjectionLayer>
      )}
      {invalidating && result && (
        <InvalidateModal winner={{ id: result.winnerId, prize_name: result.prizeName, display_name: result.name }} onClose={() => setInvalidating(false)}
          onDone={() => { setInvalidating(false); setResult(null); setPhase('idle'); setNotice('Ganador invalidado. El premio volvió al inventario: puedes volver a sortear.'); void ctx.refresh(); }} />
      )}
    </div>
  );
}

function CategoryChoice({ category, prizes, checked, disabled, onSelect }: { category: RaffleCategory; prizes: RafflePrize[]; checked: boolean; disabled: boolean; onSelect: () => void }) {
  const pool = category.pool_count ?? 0;
  const left = unitsLeft(prizes);
  const flag = !category.is_active ? 'Inactiva' : prizes.length === 0 ? 'Sin premios' : left === 0 ? 'Agotada' : pool === 0 ? 'Sin elegibles' : null;
  return (
    <label className="rf-choice" data-checked={checked || undefined} data-muted={flag ? true : undefined}>
      <input type="radio" name="rf-category" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="rf-choice-body">
        <span className="rf-choice-title">{category.name}{flag && <Badge tone="neutral">{flag}</Badge>}</span>
        <span className="rf-choice-meta">{pool} {pool === 1 ? 'elegible' : 'elegibles'} · {left} {left === 1 ? 'premio' : 'premios'} por entregar</span>
      </span>
    </label>
  );
}

function PrizeChoice({ prize, pending, checked, disabled, onSelect }: { prize: RafflePrize; pending: boolean; checked: boolean; disabled: boolean; onSelect: () => void }) {
  const flag = pending ? 'Ganador pendiente' : !prize.is_active ? 'Inactivo' : !isDrawable(prize) ? 'Agotado' : null;
  return (
    <label className="rf-choice" data-checked={checked || undefined} data-muted={flag && !pending ? true : undefined}>
      <input type="radio" name="rf-prize" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="rf-choice-body">
        <span className="rf-choice-title">{prize.name}{flag && <Badge tone={pending ? 'warning' : 'neutral'}>{flag}</Badge>}</span>
        <span className="rf-choice-meta">{prize.available} de {prize.quantity} disponibles{prize.description && ` · ${prize.description}`}</span>
      </span>
    </label>
  );
}

type ActionsProps = {
  variant: 'panel' | 'projection'; phase: StagePhase; revealDone: boolean; busy: boolean; refreshing: boolean; canDraw: boolean; redraw: boolean;
  onDraw: () => void; onConfirm: () => void; onNoShow: () => void; onNext: () => void; onInvalidate?: () => void;
};

function RoundActions({ variant, phase, revealDone, busy, refreshing, canDraw, redraw, onDraw, onConfirm, onNoShow, onNext, onInvalidate }: ActionsProps) {
  const [askNoShow, setAskNoShow] = useState(false);
  useEffect(() => setAskNoShow(false), [phase]);
  const big = variant === 'projection' ? 'rf-draw-btn rf-draw-btn-compact' : 'rf-draw-btn';

  if (phase === 'drawing') return <Button className={big} disabled loading>Sorteando…</Button>;
  if (phase === 'idle') return <Button className={big} onClick={onDraw} disabled={!canDraw || refreshing} loading={busy}>{redraw ? 'Sortear de nuevo' : 'Sortear'}</Button>;
  if (phase === 'confirmed') {
    return (
      <>
        <Button className={big} onClick={onNext} disabled={refreshing}>Siguiente ronda</Button>
        {onInvalidate && <Button variant="ghost" className="rf-ghost" onClick={onInvalidate}>Invalidar y volver a sortear</Button>}
      </>
    );
  }
  if (askNoShow) {
    return (
      <div className="rf-ask" role="group" aria-label="Confirmar que no se presentó">
        <p>¿Confirmas que no se presentó? El premio queda disponible para volver a sortearlo.</p>
        <Button onClick={onNoShow} loading={busy}>Sí, no se presentó</Button>
        <Button variant="ghost" className="rf-ghost" onClick={() => setAskNoShow(false)} disabled={busy}>Cancelar</Button>
      </div>
    );
  }
  return (
    <>
      <Button className={big} onClick={onConfirm} loading={busy} disabled={!revealDone}><Check size={18} aria-hidden /> Confirmar ganador</Button>
      <Button variant="secondary" className="rf-secondary" onClick={() => setAskNoShow(true)} disabled={!revealDone || busy}>No se presentó</Button>
    </>
  );
}

/**
 * Full-screen layer for the projector: Esc leaves, H hides the operator's controls (hover or focus brings them back).
 * It asks the browser for real full screen as well, and leaves projection if the browser leaves it.
 */
function ProjectionLayer({ onExit, children }: { onExit: () => void; children: (controlsHidden: boolean, tools: ReactNode) => ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitRef.current();
      else if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey && !(event.target instanceof HTMLInputElement)) setHidden((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let entered = false;
    const root = document.documentElement;
    if (typeof root.requestFullscreen === 'function' && !document.fullscreenElement) {
      root.requestFullscreen().then(() => { entered = true; }).catch(() => undefined);
    }
    const onFullscreen = () => { if (entered && !document.fullscreenElement) exitRef.current(); };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.body.style.overflow = previous;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  const tools = (
    <div className="rf-tools">
      <button type="button" onClick={() => setHidden((value) => !value)} aria-pressed={hidden} title="Ocultar controles (H)"><EyeOff size={16} aria-hidden /><span>{hidden ? 'Mostrar controles' : 'Ocultar controles'}</span></button>
      <button type="button" onClick={onExit} title="Salir (Esc)"><X size={16} aria-hidden /><span>Salir</span></button>
    </div>
  );
  return createPortal(
    <div className="rf-projection" role="dialog" aria-modal="true" aria-label="Proyección del sorteo">{children(hidden, tools)}</div>,
    document.body,
  );
}
