import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PublicState } from '../../lib/rafflePublic';
import { burstParticles, letterCount, orbitTokens, REVEAL_MS, scrambleParts, type Blocker } from '../../lib/raffleShow';

/** `uncertain` exists only on the operator's console: the outcome of a draw could not be confirmed. The audience never sees it. */
export type StagePhase = 'idle' | 'drawing' | 'revealed' | 'confirmed' | 'uncertain';
export type StagePrize = { name: string; available: number; quantity: number };
export type StageResult = { winnerId: string; name: string; prizeName: string; categoryName: string; /** The pool the server drew from, or null when it did not say (a recovered selection): never zero. */ poolSize: number | null; /** drawn just now (animate) or recovered after a reload (show as is) */ fresh: boolean };

export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

/** Letters settle from the left; `settled` turns true once the final name is on screen. */
function useNameReveal(name: string, animate: boolean, key: string) {
  const [progress, setProgress] = useState<{ key: string; settled: number; tick: number; done: boolean }>({ key: '', settled: 0, tick: 0, done: false });
  useEffect(() => {
    if (!animate) return;
    const total = letterCount(name);
    const started = performance.now();
    let tick = 0;
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / REVEAL_MS);
      if (t >= 1) { clearInterval(timer); setProgress({ key, settled: total, tick, done: true }); return; }
      tick += 1;
      setProgress({ key, settled: Math.floor(Math.pow(t, 1.35) * total), tick, done: false });
    }, 45);
    return () => clearInterval(timer);
  }, [name, animate, key]);
  const current = progress.key === key ? progress : { settled: 0, tick: 0, done: false };
  const settled = !animate || current.done;
  return { parts: settled ? null : scrambleParts(name, current.settled, current.tick), settled };
}

/** Tokens sit on the ring at fixed angles (percent of the ring box), so the same pool always draws the same crowd. */
const onRing = (degrees: number): CSSProperties => {
  const radians = (degrees * Math.PI) / 180;
  return { left: `${(50 + 50 * Math.cos(radians)).toFixed(2)}%`, top: `${(50 + 50 * Math.sin(radians)).toFixed(2)}%` };
};

function Orbits({ pool, phase }: { pool: number; phase: StagePhase }) {
  return (
    <div className="rf-orbits" aria-hidden data-phase={phase}>
      {orbitTokens(pool).map((count, ring) => (
        <div key={ring} className="rf-ring" style={{ '--ring': ring } as CSSProperties}>
          {Array.from({ length: count }, (_, index) => <i key={index} style={onRing((360 / count) * index + ring * 23)} />)}
        </div>
      ))}
      <div className="rf-core" />
    </div>
  );
}

function Burst() {
  return (
    <div className="rf-burst" aria-hidden>
      {burstParticles(36).map((particle, index) => (
        <i key={index} data-tone={particle.tone}
          style={{ '--dx': `${particle.dx}cqmin`, '--dy': `${particle.dy}cqmin`, '--rot': `${particle.rotate}deg`, '--delay': `${particle.delay}ms` } as CSSProperties} />
      ))}
    </div>
  );
}

const sizeBucket = (name: string) => (name.length > 40 ? 'xl' : name.length > 26 ? 'l' : 'm');

type Props = {
  /** `panel` is the operator's console: it may show problems and carries the controls. `projection` is what the audience sees and has neither. */
  variant: 'panel' | 'projection';
  phase: StagePhase;
  rehearsal: boolean;
  categoryName?: string;
  prize?: StagePrize;
  poolCount: number;
  result: StageResult | null;
  /** Projection only: false shows the title screen instead of an unfinished round. */
  ready?: boolean;
  /** Operator only. */
  blocker?: Blocker | null;
  /** Operator only: a one-line outcome of the previous step, e.g. that the last winner did not show up. */
  notice?: string;
  onRevealDone?: () => void;
  /** The name has already been revealed on another stage (console ⇄ on-screen rehearsal): show it as is, do not replay. */
  alreadyRevealed?: boolean;
  /** Operator only: controls at the foot of the stage. */
  children?: ReactNode;
};

/** What the audience sees: category, prize, how many compete and, at the end, the winner. The same stage serves the console and the public screen. */
export default function RaffleStage({ variant, phase, rehearsal, categoryName, prize, poolCount, result, ready = true, blocker = null, notice, onRevealDone, alreadyRevealed, children }: Props) {
  const operator = variant === 'panel';
  const reduced = useReducedMotion();
  const animateReveal = phase === 'revealed' && !!result?.fresh && !reduced && !alreadyRevealed;
  const name = result?.name ?? '';
  const { parts, settled } = useNameReveal(name, animateReveal, result?.winnerId ?? '');
  const doneRef = useRef(onRevealDone);
  doneRef.current = onRevealDone;
  // The burst is latched when the name settles, so it keeps playing after the parent marks the reveal as done.
  const [burstFor, setBurstFor] = useState('');
  const showBurst = phase === 'revealed' && !!result && burstFor === result.winnerId;
  const revealing = phase === 'revealed' || phase === 'confirmed';
  useEffect(() => {
    if (phase !== 'revealed' || !settled) return;
    if (result?.fresh && !reduced && !alreadyRevealed) setBurstFor(result.winnerId);
    doneRef.current?.();
  }, [phase, settled, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitsText = prize ? `${prize.available} de ${prize.quantity} ${prize.quantity === 1 ? 'unidad disponible' : 'unidades disponibles'}` : '';
  const title = !operator && (!ready || !prize);
  const poolKnown = result?.poolSize != null && result.poolSize > 0;

  return (
    <section className="rf-stage" data-variant={variant} data-phase={phase} data-rehearsal={rehearsal || undefined} data-motion={reduced ? 'reduced' : 'full'} aria-label="Escenario del sorteo">
      <Orbits pool={Math.max(poolCount, result?.poolSize ?? 0)} phase={phase} />
      {showBurst && <Burst key={result?.winnerId} />}
      <div className="rf-stage-top">
        <p className="rf-eyebrow">{categoryName ?? 'Sorteo final'}</p>
        <div className="rf-stage-top-end">
          {rehearsal && <span className="rf-tag">Ensayo del evento</span>}
        </div>
      </div>

      <div className="rf-stage-main">
        {phase === 'idle' && title && <h2 className="rf-prize rf-title">Sorteo final</h2>}
        {phase === 'idle' && !title && (
          <>
            {!blocker || (blocker.code !== 'no-category' && blocker.code !== 'no-prizes' && blocker.code !== 'inactive-category') ? (
              <>
                <p className="rf-pool"><strong>{poolCount}</strong><span>{poolCount === 1 ? 'participante compite por' : 'participantes compiten por'}</span></p>
                <h2 className="rf-prize">{prize?.name ?? 'Elige un premio'}</h2>
                {prize && <p className="rf-facts">{unitsText}</p>}
              </>
            ) : <h2 className="rf-prize">{categoryName ?? 'Elige una categoría'}</h2>}
            {operator && notice && <p className="rf-notice" role="status">{notice}</p>}
            {operator && blocker && <p className="rf-blocker" role="status">{blocker.message}</p>}
          </>
        )}

        {(phase === 'drawing' || phase === 'uncertain') && (
          <>
            <p className="rf-label">{phase === 'uncertain' ? 'Resultado sin confirmar' : `Sorteando entre ${poolCount} ${poolCount === 1 ? 'participante' : 'participantes'}`}</p>
            <h2 className="rf-prize">{prize?.name}</h2>
            {phase === 'drawing' && <p className="rf-dots" aria-hidden><i /><i /><i /></p>}
            {operator && phase === 'uncertain' && notice && <p className="rf-blocker" role="status">{notice}</p>}
            {phase === 'drawing' && <p className="sr-only" role="status">Sorteando…</p>}
          </>
        )}

        {revealing && result && (
          <>
            <p className="rf-label">{phase === 'confirmed' ? 'Premio confirmado' : 'Ganador'}</p>
            <p className="rf-winner" data-size={sizeBucket(name)} data-settled={settled || undefined} aria-hidden>{parts ? parts.map((part, index) => (part.glyph
              ? <span key={index} className="rf-ch"><span>{part.char}</span><b>{part.glyph}</b></span>
              : part.char)) : name}</p>
            <p className="rf-prize rf-prize-sub">{result.prizeName}</p>
            {phase === 'confirmed'
              ? <p className="rf-confirmed"><Check size={18} aria-hidden /> Entrega confirmada</p>
              : poolKnown && <p className="rf-facts">Elegido entre {result.poolSize} {result.poolSize === 1 ? 'participante' : 'participantes'}</p>}
            {settled && <p className="sr-only" role="status">{phase === 'confirmed' ? 'Premio confirmado' : 'Ganador'}: {name}, {result.prizeName}</p>}
          </>
        )}
      </div>

      {operator && children && <div className="rf-dock">{children}</div>}
    </section>
  );
}

/**
 * The stage as the audience sees it, drawn from the public state alone. It has no props that could carry an error, a
 * notice or a control, which is what keeps the projector clean.
 */
export function PublicStage({ state, alreadyRevealed }: { state: PublicState; alreadyRevealed?: boolean }) {
  const phase: StagePhase = state.phase === 'standby' || state.phase === 'ready' ? 'idle' : state.phase;
  return (
    <RaffleStage variant="projection" phase={phase} rehearsal={state.rehearsal} categoryName={state.categoryName ?? undefined} prize={state.prize ?? undefined}
      poolCount={state.poolCount} ready={state.phase !== 'standby'} alreadyRevealed={alreadyRevealed}
      result={state.result ? { ...state.result, categoryName: state.categoryName ?? '' } : null} />
  );
}
