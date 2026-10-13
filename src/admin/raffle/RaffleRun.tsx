import { Check, ExternalLink, Monitor } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Badge, Button } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import {
  confirmWinner, drawWinner, fetchPendingSelection, markNoShow,
  type DrawResult, type RaffleCategory, type RafflePrize,
} from '../../lib/raffleApi';
import { toPublicState, type PublicState } from '../../lib/rafflePublic';
import {
  drawBlocker, initialCategory, initialPrize, isDefinitiveDrawError, isDrawable, nextTarget, SPIN_MS,
} from '../../lib/raffleShow';
import { useRafflePublicScreen } from '../../lib/useRafflePublicScreen';
import { DataPanel, EmptyState } from '../design/Primitives';
import { deliveryText, kindOf, plural, PrizeIcon, prizeTally, StockDots, toneOf, verified } from './PrizeParts';
import { InvalidateModal } from './RaffleModals';
import { useWinnerFolios } from './useWinnerFolios';
import RaffleStage, { PublicStage, useReducedMotion, type StagePhase, type StageResult } from './RaffleStage';
import type { RaffleContext } from './types';

const EMPTY: RafflePrize[] = [];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorCode = (cause: unknown) => (cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message: unknown }).message) : '');
const newKey = (prizeId: string) => `${prizeId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const NOT_REGISTERED = 'No pudimos confirmar la respuesta del servidor y no hay ningún ganador registrado para este premio. Puedes reintentar: se reutiliza la misma operación, así que no se duplica la selección.';
const UNCERTAIN = 'No pudimos confirmar si el servidor ya eligió un ganador (conexión o error temporal). El premio queda bloqueado para no duplicar la selección: comprueba de nuevo.';

type Pending = Record<string, StageResult>;
type PendingCheck = { found: Pending; unknown: string[] };

/** What `raffle_pending_selection` answered, as a result to show; the pool size is not part of that answer. */
const recovered = (current: { winner_id: string | null; display_name?: string; prize_name?: string; category_name?: string }, prize: RafflePrize, fresh = false): StageResult => ({
  winnerId: current.winner_id as string, name: current.display_name ?? 'Participante', prizeName: current.prize_name ?? prize.name,
  categoryName: current.category_name ?? '', poolSize: null, fresh,
});

/**
 * The operating console: pick category and prize, draw, reveal and decide, round after round. What the audience sees
 * goes to a separate public window (or to the on-screen rehearsal) that has no controls; every decision, error and
 * notice stays here.
 */
export default function RaffleRun({ ctx }: { ctx: RaffleContext }) {
  const { categories, prizes, rehearsal, canConfigure, prizesLoading, winners, stale } = ctx;
  // The suggested order of the event: from the smaller prizes to the big ones. Any prize can be picked at any time.
  const drawOrder = useMemo(() => [...categories].reverse(), [categories]);
  const reduced = useReducedMotion();
  const [categoryId, setCategoryId] = useState('');
  const [prizeId, setPrizeId] = useState('');
  const [phase, setPhase] = useState<StagePhase>('idle');
  const [result, setResult] = useState<StageResult | null>(null);
  const { folioOf } = useWinnerFolios(result ? [result.winnerId] : []);
  const [revealDone, setRevealDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [redraw, setRedraw] = useState<null | 'again' | 'retry'>(null);
  const [pending, setPending] = useState<Pending>({});
  const [unverified, setUnverified] = useState<Record<string, true>>({});
  const [checking, setChecking] = useState(false);
  const [serverEmpty, setServerEmpty] = useState<{ prizeId: string; pool: number; available: number } | null>(null);
  const [rehearsing, setRehearsing] = useState(false);
  const [invalidating, setInvalidating] = useState(false);
  const token = useRef(0);
  const started = useRef(false);
  const latest = useRef({ prizes, categories });
  latest.current = { prizes, categories };
  // A draw in flight and the key of the operation being attempted: a second click, or a retry after an uncertain
  // answer, is the same logical operation and must never become a second draw.
  const drawing = useRef(false);
  const attempt = useRef<{ prizeId: string; key: string } | null>(null);

  const category = categories.find((item) => item.id === categoryId);
  const categoryPrizes = prizes[categoryId] ?? EMPTY;
  const prize = categoryPrizes.find((item) => item.id === prizeId);
  const poolCount = category?.pool_count ?? 0;
  const serverEmptyHere = !!serverEmpty && serverEmpty.prizeId === prizeId && serverEmpty.pool === poolCount && serverEmpty.available === prize?.available;
  const blocker = prizesLoading ? null : drawBlocker(category, categoryPrizes, prize, poolCount, { unverified: !!prize && !!unverified[prize.id], serverEmpty: serverEmptyHere, stale });
  const unverifiedHere = categoryPrizes.filter((item) => unverified[item.id]);
  const locked = busy || phase === 'drawing' || phase === 'uncertain';

  const recordChecks = useCallback((list: RafflePrize[], check: PendingCheck) => {
    setPending((current) => { const next = { ...current }; for (const item of list) delete next[item.id]; return { ...next, ...check.found }; });
    setUnverified((current) => { const next = { ...current }; for (const item of list) delete next[item.id]; for (const id of check.unknown) next[id] = true; return next; });
  }, []);

  /**
   * Asks the server about every prize. Three outcomes per prize, never mixed: a winner is waiting, none is waiting, or
   * the server could not be asked (`unknown`): that last one must not be read as «none».
   */
  const findPending = useCallback(async (list: RafflePrize[]): Promise<PendingCheck> => {
    const found: Pending = {};
    const unknown: string[] = [];
    await Promise.all(list.map(async (item) => {
      try {
        const current = await fetchPendingSelection(item.id);
        if (!current || typeof current !== 'object' || !('winner_id' in current)) throw new Error('UNREADABLE');
        if (current.winner_id) found[item.id] = recovered(current, item);
      } catch (cause) { console.error('pending selection check failed', cause); unknown.push(item.id); }
    }));
    return { found, unknown };
  }, []);

  /** Selects a category and, within it, the prize that deserves attention first (a pending winner, else one with units). */
  const enter = useCallback(async (nextCategory: string, preferred?: string, known?: PendingCheck) => {
    const mine = ++token.current;
    attempt.current = null;
    setCategoryId(nextCategory); setPhase('idle'); setResult(null); setRevealDone(false); setError(''); setNotice(''); setRedraw(null); setServerEmpty(null);
    const list = latest.current.prizes[nextCategory] ?? EMPTY;
    const check = known ?? await findPending(list);
    if (token.current !== mine) return;
    recordChecks(list, check);
    const pick = preferred && list.some((item) => item.id === preferred) ? preferred : initialPrize(list, Object.fromEntries(Object.keys(check.found).map((id) => [id, true])));
    setPrizeId(pick);
    if (check.found[pick]) { setResult(check.found[pick]); setRevealDone(true); setPhase('revealed'); }
  }, [findPending, recordChecks]);

  // First visit: go straight to a winner that is waiting for a decision, otherwise to the first category that can be drawn.
  useEffect(() => {
    if (started.current || categories.length === 0 || prizesLoading || !categories.every((item) => prizes[item.id])) return;
    started.current = true;
    void (async () => {
      const all = categories.flatMap((item) => prizes[item.id] ?? EMPTY);
      const check = await findPending(all);
      const hit = categories.map((item) => ({ categoryId: item.id, prize: (prizes[item.id] ?? EMPTY).find((candidate) => check.found[candidate.id]) })).find((entry) => entry.prize);
      const target = hit?.categoryId ?? initialCategory(drawOrder, prizes);
      const own = new Set((prizes[target] ?? EMPTY).map((item) => item.id));
      const split = (inside: boolean): PendingCheck => ({
        found: Object.fromEntries(Object.entries(check.found).filter(([id]) => own.has(id) === inside)),
        unknown: check.unknown.filter((id) => own.has(id) === inside),
      });
      recordChecks(all.filter((item) => !own.has(item.id)), split(false));
      await enter(target, hit?.prize?.id, split(true));
    })();
  }, [categories, drawOrder, prizes, prizesLoading, enter, findPending, recordChecks]);

  // The burst has played: from here on the result is shown as is, so toggling the rehearsal never replays it.
  useEffect(() => {
    if (!revealDone || !result?.fresh) return;
    const timer = setTimeout(() => setResult((current) => (current && current.winnerId === result.winnerId ? { ...current, fresh: false } : current)), 2000);
    return () => clearTimeout(timer);
  }, [revealDone, result?.winnerId, result?.fresh]);

  const choosePrize = (id: string) => {
    token.current += 1;
    attempt.current = null;
    setPrizeId(id); setError(''); setNotice(''); setRedraw(null); setServerEmpty(null);
    const resume = pending[id];
    setResult(resume ?? null); setRevealDone(!!resume); setPhase(resume ? 'revealed' : 'idle');
  };

  /** Re-asks about the prizes of this category that could not be checked; a waiting winner appears as soon as it is found. */
  const recheck = async () => {
    if (checking || unverifiedHere.length === 0) return;
    setChecking(true);
    try {
      const list = unverifiedHere;
      const check = await findPending(list);
      recordChecks(list, check);
      const resume = check.found[prizeId];
      if (resume && phase === 'idle') { setResult(resume); setRevealDone(true); setPhase('revealed'); setNotice(''); }
    } finally { setChecking(false); }
  };

  const showDrawn = (drawn: DrawResult, from: RafflePrize, to: RaffleCategory) => {
    const next: StageResult = {
      winnerId: drawn.winner_id, name: drawn.display_name, prizeName: drawn.prize_name ?? from.name, categoryName: drawn.category_name ?? to.name,
      // Only the server's own figure for this draw; a replayed answer does not carry it and stays unknown (never zero).
      poolSize: typeof drawn.pool_size === 'number' && drawn.pool_size > 0 ? drawn.pool_size : null, fresh: true,
    };
    attempt.current = null;
    setResult(next); setPending((current) => ({ ...current, [from.id]: { ...next, fresh: false } })); setPhase('revealed'); setRevealDone(false);
    void ctx.refresh();
  };

  /**
   * The server may or may not have recorded the draw. Ask for the pending selection with the existing contract:
   * found → show that very winner; none → nothing was recorded (a retry reuses the same key, so it cannot duplicate);
   * could not ask → stay blocked and let the operator check again. Nothing is invented and nothing new is drawn here.
   */
  const verify = async (target: RafflePrize, to: RaffleCategory) => {
    setBusy(true); setPhase('uncertain'); setError('');
    try {
      const current = await fetchPendingSelection(target.id);
      if (!current || typeof current !== 'object' || !('winner_id' in current)) throw new Error('UNREADABLE');
      if (current.winner_id) {
        const found = recovered(current, target, true);
        attempt.current = null;
        setResult({ ...found, categoryName: found.categoryName || to.name }); setPending((value) => ({ ...value, [target.id]: { ...found, fresh: false } }));
        setPhase('revealed'); setRevealDone(false); setNotice(''); void ctx.refresh();
      } else { setPhase('idle'); setRedraw('retry'); setNotice(NOT_REGISTERED); }
    } catch (cause) {
      console.error('draw verification failed', cause);
      setPhase('uncertain'); setNotice(UNCERTAIN);
    } finally { setBusy(false); }
  };

  const draw = async () => {
    // A synchronous guard: a double click arrives before React has re-rendered the disabled button.
    if (drawing.current || !category || !prize || blocker || locked || prizesLoading) return;
    drawing.current = true;
    const mine = ++token.current;
    if (attempt.current?.prizeId !== prize.id) attempt.current = { prizeId: prize.id, key: newKey(prize.id) };
    const { key } = attempt.current;
    setBusy(true); setError(''); setNotice(''); setRedraw(null); setResult(null); setRevealDone(false); setPhase('drawing');
    try {
      const [drawn] = await Promise.all([drawWinner(prize.id, key), wait(reduced ? 600 : SPIN_MS)]);
      if (token.current !== mine) return;
      showDrawn(drawn, prize, category);
    } catch (cause) {
      if (token.current !== mine) return;
      const code = errorCode(cause);
      if (!isDefinitiveDrawError(code)) { console.error('draw outcome unknown', cause); await verify(prize, category); return; }
      attempt.current = null;
      setPhase('idle');
      if (code === 'POOL_EMPTY') setServerEmpty({ prizeId: prize.id, pool: poolCount, available: prize.available });
      else setError(friendlyError(cause));
      if (code === 'PENDING_SELECTION') await enter(category.id, prize.id);
      else if (code === 'PRIZE_EXHAUSTED' || code === 'POOL_EMPTY') void ctx.refresh();
    } finally { drawing.current = false; setBusy(false); }
  };

  const settle = async (action: () => Promise<unknown>, after: () => void) => {
    if (!result) return;
    setBusy(true); setError('');
    try {
      await action();
      attempt.current = null; setServerEmpty(null);
      setPending((current) => { const { [prizeId]: _gone, ...rest } = current; return rest; });
      after(); await ctx.refresh();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };
  const confirm = () => settle(() => confirmWinner(result!.winnerId), () => setPhase('confirmed'));
  const noShow = () => settle(() => markNoShow(result!.winnerId), () => {
    setNotice(`${result!.name} no se presentó. El premio sigue disponible: puedes volver a sortear.`); setRedraw('again');
    setResult(null); setRevealDone(false); setPhase('idle');
  });

  const nextRound = () => {
    const target = nextTarget(drawOrder, prizes, { categoryId, prizeId });
    if (!target) { setPhase('idle'); setResult(null); setNotice('Ya no quedan premios por sortear en este entorno.'); return; }
    void enter(target.categoryId, target.prizeId);
  };

  // On a wide screen the console should open with the stage fully in view (the environment banner stays visible above it).
  useEffect(() => {
    if (window.innerWidth < 1000) return;
    document.querySelector('.rf-module .rf-stats')?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tells the module a round is in progress, so the records of the rehearsal cannot be changed under it.
  useEffect(() => { ctx.setRoundActive(phase !== 'idle' || busy); }, [phase, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctx.setRoundActive(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // What the audience may see: no blockers, no notices, no errors, no controls.
  const publicState: PublicState = useMemo(() => toPublicState({
    rehearsal, phase, ready: !blocker && !!prize, categoryName: category?.name, poolCount,
    prize: prize && { name: prize.name, available: prize.available, quantity: prize.quantity },
    result: result && { winnerId: result.winnerId, name: result.name, prizeName: result.prizeName, poolSize: result.poolSize, fresh: result.fresh },
  }), [rehearsal, phase, blocker, prize, category?.name, poolCount, result]);
  const screen = useRafflePublicScreen(publicState);

  // Space/Enter in the rehearsal: the one obvious next step of the round.
  const primary = () => {
    if (phase === 'idle' && !blocker && prize && !prizesLoading) void draw();
    else if (phase === 'revealed' && revealDone && !busy) void confirm();
    else if (phase === 'confirmed' && !prizesLoading && !busy) nextRound();
  };

  // The rehearsal has no way to show a problem, so a problem takes the operator back to the console.
  const problem = !!error || phase === 'uncertain' || blocker?.code === 'unverified' || blocker?.code === 'server-empty' || blocker?.code === 'stale';
  useEffect(() => { if (rehearsing && problem) setRehearsing(false); }, [rehearsing, problem]);

  const registeredPrizes = categories.flatMap((item) => prizes[item.id] ?? EMPTY);
  if (registeredPrizes.length === 0 && !prizesLoading && ctx.loaded) {
    return (
      <DataPanel><EmptyState title="Los premios todavía no están preparados."
        description={canConfigure ? 'Registra los premios oficiales de Día OV 2026 para poder sortearlos. Es un solo paso.' : 'Avisa a Coordinación: hay que preparar los premios oficiales antes de sortear.'}
        action={canConfigure ? <Button className="mt-4" onClick={() => ctx.goTo('premios')}>Ir a Premios</Button> : undefined} /></DataPanel>
    );
  }

  const drawLabel = redraw === 'retry' ? 'Reintentar sorteo' : redraw === 'again' ? 'Sortear de nuevo' : 'Sortear';
  const totalLeft = registeredPrizes.reduce((sum, item) => sum + prizeTally(item, winners).left, 0);
  const totalUnits = registeredPrizes.reduce((sum, item) => sum + item.quantity, 0);
  const eligible = categories.reduce((sum, item) => sum + (item.pool_count ?? 0), 0);
  const openCategories = categories.filter((item) => (prizes[item.id] ?? EMPTY).some(isDrawable)).length;
  const pick = (item: RaffleCategory, target: RafflePrize) => { if (item.id === categoryId) choosePrize(target.id); else void enter(item.id, target.id); };

  return (
    <>
      <div className="rf-stats" aria-label="Resumen del sorteo">
        <div><strong>{totalLeft}</strong><span>{totalLeft === 1 ? 'premio por sortear' : 'premios por sortear'} de {totalUnits}</span></div>
        <div><strong>{eligible}</strong><span>{eligible === 1 ? 'participante elegible' : 'participantes elegibles'}</span></div>
        <div><strong>{openCategories}</strong><span>{openCategories === 1 ? 'categoría con premios' : 'categorías con premios'} de {categories.length}</span></div>
      </div>
      <PublicScreenBar screen={screen} onRehearse={() => setRehearsing(true)} />
      <div className="rf-run">
        <div className="rf-pick">
          <section aria-label="Premios por sortear">
            <h2 className="rf-step">Elige el premio</h2>
            <p className="rf-pick-hint">Sugerido: de los premios menores al mayor. Puedes elegir cualquiera.</p>
            <div className="rf-board" role="radiogroup" aria-label="Premio">
              {categories.map((item) => (
                <div key={item.id} className="rf-board-group" data-tone={toneOf(item.name)} role="group" aria-label={`Premios de ${item.name}`}>
                  <h3>{item.name}<small>{plural(item.pool_count ?? 0, 'elegible', 'elegibles')}</small></h3>
                  {(prizes[item.id] ?? EMPTY).map((target) => (
                    <PrizeCard key={target.id} category={item} prize={target} winners={winners} pending={!!pending[target.id]} unverified={!!unverified[target.id]}
                      checked={target.id === prizeId} disabled={locked} onSelect={() => pick(item, target)} />
                  ))}
                  {(prizes[item.id] ?? EMPTY).length === 0 && <p className="rf-choice-empty">Sin premios registrados.</p>}
                </div>
              ))}
            </div>
            {ctx.plan.status !== 'ready' && ctx.plan.entries.some((entry) => !entry.prize) && (
              <p className="rf-pick-hint">{canConfigure ? 'Faltan premios oficiales por registrar. ' : 'Faltan premios oficiales por registrar: avisa a Coordinación. '}
                {canConfigure && <button type="button" className="rf-link" onClick={() => ctx.goTo('premios')}>Ir a Premios</button>}</p>
            )}
            {unverifiedHere.length > 0 && (
              <Alert tone="warning">
                <div className="rf-alert-row">
                  <span>No se pudo comprobar si {unverifiedHere.length === 1 ? `«${unverifiedHere[0].name}» tiene` : `${unverifiedHere.length} premios tienen`} un ganador pendiente (sin conexión o error del servidor). Hasta comprobarlo no {unverifiedHere.length === 1 ? 'se puede sortear' : 'se pueden sortear'}, para no duplicar la selección.</span>
                  <Button variant="secondary" onClick={() => void recheck()} loading={checking}>Reintentar comprobación</Button>
                </div>
              </Alert>
            )}
          </section>
        </div>

        <div className="rf-live">
          {error && <Alert tone="error">{error}</Alert>}
          <RaffleStage variant="panel" rehearsal={rehearsal} phase={phase} prize={prize} poolCount={poolCount} result={result} blocker={blocker} folio={result ? folioOf(result.winnerId) : undefined}
            notice={notice} categoryName={category?.name} onRevealDone={() => setRevealDone(true)} alreadyRevealed={revealDone}>
            <RoundActions phase={phase} revealDone={revealDone} busy={busy} refreshing={prizesLoading} checking={checking} drawLabel={drawLabel}
              blockerCode={blocker?.code} canDraw={!blocker && !!prize}
              onRetryRead={() => void ctx.refresh()}
              onDraw={() => void draw()} onConfirm={() => void confirm()} onNoShow={() => void noShow()} onNext={nextRound}
              onVerify={() => { if (category && prize) void verify(prize, category); }} onRecheck={() => void recheck()} onRefresh={() => void ctx.refresh()}
              onInvalidate={canConfigure ? () => setInvalidating(true) : undefined} />
          </RaffleStage>
          <p className="rf-live-help">El ganador lo decide el servidor al sortear; esta pantalla solo lo muestra. {phase === 'revealed' && 'Confirma la entrega cuando la persona se presente.'}</p>
        </div>

        {rehearsing && <RehearsalLayer state={publicState} alreadyRevealed={revealDone} onExit={() => setRehearsing(false)} onPrimary={primary} />}
        {invalidating && result && (
          <InvalidateModal winner={{ id: result.winnerId, prize_name: result.prizeName, display_name: result.name }} onClose={() => setInvalidating(false)}
            onDone={() => { setInvalidating(false); setResult(null); setPhase('idle'); setRedraw('again'); setNotice('Ganador invalidado. El premio volvió al inventario: puedes volver a sortear.'); void ctx.refresh(); }} />
        )}
      </div>
    </>
  );
}

function PublicScreenBar({ screen, onRehearse }: { screen: ReturnType<typeof useRafflePublicScreen>; onRehearse: () => void }) {
  return (
    <div className="rf-public-bar" data-connected={screen.connected || undefined}>
      <div className="rf-public-text">
        <p className="rf-public-title"><i aria-hidden /> Pantalla pública · {screen.connected ? 'conectada' : 'no abierta'}</p>
        <p className="rf-public-help">
          {!screen.supported ? 'Este navegador no puede sincronizar ventanas: usa «Ensayar en esta pantalla».'
            : screen.blocked ? 'El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio e inténtalo de nuevo.'
            : screen.connected ? 'Llévala al proyector y pon pantalla completa con doble clic. Ahí no hay controles.'
            : 'Ábrela en otra ventana y llévala al proyector. Aquí conservas todos los controles.'}
        </p>
      </div>
      <div className="rf-public-actions">
        <Button variant="secondary" onClick={() => screen.open()} disabled={!screen.supported}><ExternalLink size={15} aria-hidden /> {screen.connected ? 'Traer al frente' : 'Abrir pantalla pública'}</Button>
        <Button variant="ghost" onClick={onRehearse} title="Pantalla completa sin controles. Espacio: sortear, confirmar y siguiente ronda. Esc: salir."><Monitor size={15} aria-hidden /> Ensayar en esta pantalla</Button>
      </div>
    </div>
  );
}

function PrizeCard({ category, prize, winners, pending, unverified, checked, disabled, onSelect }: {
  category: RaffleCategory; prize: RafflePrize; winners: RaffleContext['winners']; pending: boolean; unverified: boolean; checked: boolean; disabled: boolean; onSelect: () => void;
}) {
  const tally = prizeTally(prize, winners);
  const done = tally.left === 0 && verified(tally) && tally.waiting === 0 && !pending;
  const flag = pending ? 'Ganador pendiente' : unverified ? 'Sin comprobar' : !prize.is_active ? 'Inactivo' : done ? 'Completo' : tally.left === 0 ? (verified(tally) ? 'Por confirmar' : 'Sin unidades') : null;
  return (
    <label className="rf-pcard" data-checked={checked || undefined} data-done={done || undefined}>
      <input type="radio" name="rf-prize" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className="rf-prize-icon"><PrizeIcon kind={kindOf(category.name, prize.name)} /></span>
      <span className="rf-pcard-body">
        <span className="rf-pcard-title">{prize.name}</span>
        <span className="rf-pcard-meta">{done ? deliveryText(tally) : `${tally.left} por sortear · ${deliveryText(tally)}`}</span>
        <StockDots tally={tally} />
      </span>
      {flag && <Badge tone={pending || unverified ? 'warning' : 'neutral'}>{flag}</Badge>}
    </label>
  );
}

type ActionsProps = {
  phase: StagePhase; revealDone: boolean; busy: boolean; refreshing: boolean; checking: boolean; canDraw: boolean; drawLabel: string; blockerCode?: string;
  onDraw: () => void; onConfirm: () => void; onNoShow: () => void; onNext: () => void; onVerify: () => void; onRecheck: () => void; onRefresh: () => void; onRetryRead: () => void; onInvalidate?: () => void;
};

function RoundActions({ phase, revealDone, busy, refreshing, checking, canDraw, drawLabel, blockerCode, onDraw, onConfirm, onNoShow, onNext, onVerify, onRecheck, onRefresh, onRetryRead, onInvalidate }: ActionsProps) {
  const [askNoShow, setAskNoShow] = useState(false);
  useEffect(() => setAskNoShow(false), [phase]);
  const big = 'rf-draw-btn';

  if (phase === 'drawing') return <Button className={big} disabled loading>Sorteando…</Button>;
  if (phase === 'uncertain') return <Button className={big} onClick={onVerify} loading={busy}>Comprobar de nuevo</Button>;
  if (phase === 'idle') {
    if (blockerCode === 'stale') return <Button className={big} onClick={onRetryRead} loading={refreshing}>Reintentar actualización</Button>;
    if (blockerCode === 'unverified') return <Button className={big} onClick={onRecheck} loading={checking}>Reintentar comprobación</Button>;
    return (
      <>
        <Button className={big} onClick={onDraw} disabled={!canDraw || refreshing} loading={busy}>{drawLabel}</Button>
        {blockerCode === 'server-empty' && <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>Actualizar datos</Button>}
      </>
    );
  }
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
 * Rehearsal on a single screen: the public stage in full screen with NOTHING clickable on it. It is driven from the
 * keyboard (Space or Enter: draw, confirm, next round; Esc: leave), and a problem closes it so the operator sees it.
 * For the real event use the public window on the second screen.
 */
function RehearsalLayer({ state, alreadyRevealed, onExit, onPrimary }: { state: PublicState; alreadyRevealed: boolean; onExit: () => void; onPrimary: () => void }) {
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const primaryRef = useRef(onPrimary);
  primaryRef.current = onPrimary;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitRef.current();
      else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); primaryRef.current(); }
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
    (document.activeElement as HTMLElement | null)?.blur?.();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.body.style.overflow = previous;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  return createPortal(
    <div className="rf-projection" role="dialog" aria-modal="true" aria-label="Ensayo en pantalla completa"><PublicStage state={state} alreadyRevealed={alreadyRevealed} /></div>,
    document.body,
  );
}
