import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { burstParticles, letterCount, orbitTokens, REVEAL_MS, scrambleParts, type Blocker, type RaffleScope } from '../../lib/raffleShow';
import type { RafflePrize } from '../../lib/raffleApi';

export type StagePhase = 'idle' | 'drawing' | 'revealed' | 'confirmed';
export type StageResult = { winnerId: string; name: string; prizeName: string; categoryName: string; poolSize: number; /** drawn just now (animate) or recovered after a reload (show as is) */ fresh: boolean };

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
  variant: 'panel' | 'projection';
  phase: StagePhase;
  scope: RaffleScope;
  categoryName?: string;
  prize?: RafflePrize;
  poolCount: number;
  result: StageResult | null;
  blocker: Blocker | null;
  /** A one-line outcome of the previous step, e.g. that the last winner did not show up. */
  notice?: string;
  onRevealDone: () => void;
  /** The name has already been revealed on another stage (panel ⇄ projection): show it as is, do not replay. */
  alreadyRevealed?: boolean;
  /** Operator controls, rendered at the foot of the stage. */
  children?: ReactNode;
  /** Small tools in the top corner (projection mode, exit). */
  corner?: ReactNode;
  controlsHidden?: boolean;
};

/** What the audience sees: category, prize, how many compete and, at the end, the winner. Identical in the panel and on the projector. */
export default function RaffleStage({ variant, phase, scope, categoryName, prize, poolCount, result, blocker, notice, onRevealDone, alreadyRevealed, children, corner, controlsHidden }: Props) {
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
    doneRef.current();
  }, [phase, settled, name]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitsText = prize ? `${prize.available} de ${prize.quantity} ${prize.quantity === 1 ? 'unidad disponible' : 'unidades disponibles'}` : '';

  return (
    <section className="rf-stage" data-variant={variant} data-phase={phase} data-scope={scope} data-motion={reduced ? 'reduced' : 'full'} aria-label="Escenario del sorteo">
      <Orbits pool={Math.max(poolCount, result?.poolSize ?? 0)} phase={phase} />
      {showBurst && <Burst key={result?.winnerId} />}
      <div className="rf-stage-top">
        <p className="rf-eyebrow">{categoryName ?? 'Sorteo final'}</p>
        <div className="rf-stage-top-end">
          {scope === 'demo' && <span className="rf-tag">Ensayo · datos de prueba</span>}
          {corner}
        </div>
      </div>

      <div className="rf-stage-main">
        {phase === 'idle' && (
          <>
            {!blocker || (blocker.code !== 'no-category' && blocker.code !== 'no-prizes' && blocker.code !== 'inactive-category') ? (
              <>
                <p className="rf-pool"><strong>{poolCount}</strong><span>{poolCount === 1 ? 'participante compite por' : 'participantes compiten por'}</span></p>
                <h2 className="rf-prize">{prize?.name ?? 'Elige un premio'}</h2>
                {prize && <p className="rf-facts">{unitsText}</p>}
              </>
            ) : <h2 className="rf-prize">{categoryName ?? 'Elige una categoría'}</h2>}
            {notice && <p className="rf-notice" role="status">{notice}</p>}
            {blocker && <p className="rf-blocker" role="status">{blocker.message}</p>}
          </>
        )}

        {phase === 'drawing' && (
          <>
            <p className="rf-label">Sorteando entre {poolCount} {poolCount === 1 ? 'participante' : 'participantes'}</p>
            <h2 className="rf-prize">{prize?.name}</h2>
            <p className="rf-dots" aria-hidden><i /><i /><i /></p>
            <p className="sr-only" role="status">Sorteando…</p>
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
              : <p className="rf-facts">Elegido entre {result.poolSize} {result.poolSize === 1 ? 'participante' : 'participantes'}</p>}
            {settled && <p className="sr-only" role="status">{phase === 'confirmed' ? 'Premio confirmado' : 'Ganador'}: {name}, {result.prizeName}</p>}
          </>
        )}
      </div>

      {children && <div className="rf-dock" data-hidden={controlsHidden || undefined}>{children}</div>}
    </section>
  );
}
