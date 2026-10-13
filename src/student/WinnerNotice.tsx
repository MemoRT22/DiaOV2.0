import { Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { markSeen, pendingNotice, readSeen, SEEN_STORAGE_KEY } from '../lib/raffleWinner';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { useRafflePrizes } from './RafflePrizeProvider';
import './winner.css';

const STARS = [[12, 14], [86, 10], [20, 70], [90, 62], [50, 6], [8, 40], [94, 36]];

/**
 * Aviso de ganador. Vive en el layout del alumno, así que aparece en cualquier sección. Sale cuando el servidor tiene un resultado
 * «seleccionado» de ESTA persona que aún no se cerró en este dispositivo; cerrarlo solo lo recuerda aquí (nada cambia en Supabase)
 * y el premio sigue consultable en la Bitácora. Si el resultado deja de estar «seleccionado» mientras está abierto, se retira.
 */
export default function WinnerNotice() {
  const { prizes } = useRafflePrizes();
  const { theme } = usePublicTheme();
  const navigate = useNavigate();
  const [seen, setSeen] = useState(() => readSeen());
  const primary = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);

  // Otra pestaña del mismo navegador pudo cerrarlo ya.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === SEEN_STORAGE_KEY) setSeen(readSeen()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const notice = useMemo(() => pendingNotice(prizes, seen), [prizes, seen]);
  const id = notice?.winnerId;
  useEffect(() => { if (id) primary.current?.focus(); }, [id]);

  const dismiss = (go: boolean) => {
    if (!notice) return;
    markSeen(notice.winnerId);
    setSeen(readSeen());
    if (go) navigate('/pasaporte#premio');
  };
  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { markSeen(id); setSeen(readSeen()); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);

  if (!notice) return null;
  const event = [theme.meta.eventName, theme.meta.editionLabel].filter(Boolean).join(' ') || 'Día OV 2026';

  return (
    <div className="wn-overlay" role="presentation">
      <div className="wn-panel" role="alertdialog" aria-modal="true" aria-labelledby="wn-title" aria-describedby="wn-body">
        {STARS.map(([left, top], index) => <i key={index} className="wn-star" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 0.35}s` }} aria-hidden />)}
        <div className="wn-halo" aria-hidden><Trophy size={44} /></div>
        <h2 id="wn-title" className="wn-title">¡Felicidades, eres ganador! <span aria-hidden>🏆</span></h2>
        <p id="wn-body" className="mt-2 text-sm text-ink-muted">Has ganado un premio en el Sorteo {event}.</p>
        <dl className="wn-facts">
          <div><dt>Premio</dt><dd>{notice.prizeName}</dd></div>
          <div><dt>Ganador</dt><dd>{notice.displayName}</dd></div>
          <div><dt>Folio</dt><dd className="wn-folio">{notice.folio}</dd></div>
        </dl>
        <p className="mt-4 text-sm font-semibold">Presenta tu Bitácora Digital al personal encargado para recoger tu premio.</p>
        <div className="wn-actions">
          <button type="button" ref={(node) => { primary.current = node; }} className={buttonClasses('primary', 'w-full')} onClick={() => dismiss(true)}>Ver mi premio</button>
          <button type="button" className={buttonClasses('ghost', 'w-full')} onClick={() => dismiss(false)}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
