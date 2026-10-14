import { Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { markSeen, pendingNotice, readSeen, SEEN_STORAGE_KEY } from '../lib/raffleWinner';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { useBackgroundLocked } from './backgroundLock';
import { useRafflePrizes } from './RafflePrizeProvider';
import './winner.css';

const STARS = [[12, 14], [86, 10], [20, 70], [90, 62], [50, 6], [8, 40], [94, 36]];
/**
 * Aviso de ganador. Vive en el layout del alumno, así que aparece en cualquier sección. Sale cuando el servidor tiene un resultado
 * «seleccionado» de ESTA persona, confirmado por una consulta reciente, que aún no se cerró en este dispositivo. Cerrarlo solo lo
 * recuerda aquí (nada cambia en Supabase) y el premio sigue consultable en la Bitácora. Si el resultado deja de estar «seleccionado»
 * o la consulta deja de estar verificada mientras está abierto, se retira (y vuelve si sigue vigente al verificarse).
 */
export default function WinnerNotice() {
  const { prizes, verified } = useRafflePrizes();
  const { theme } = usePublicTheme();
  const navigate = useNavigate();
  const [seen, setSeen] = useState(() => readSeen());
  const panel = useRef<HTMLDivElement | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Otra pestaña del mismo navegador pudo cerrarlo ya.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === SEEN_STORAGE_KEY) setSeen(readSeen()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Solo se presenta lo que el servidor confirmó hace poco: sin consulta verificada no se ofrece como premio por recoger.
  const notice = useMemo(() => (verified ? pendingNotice(prizes, seen) : null), [prizes, seen, verified]);
  const id = notice?.winnerId;
  const open = !!notice;
  useBackgroundLocked(open);

  // Foco: entra al botón principal y, al cerrarse, regresa a donde estaba la persona.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    primary.current?.focus();
    return () => {
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target && document.contains(target)) target.focus();
    };
  }, [open]);

  const close = (winnerId: string) => { markSeen(winnerId); setSeen(readSeen()); };
  const dismiss = (go: boolean) => {
    if (!notice) return;
    close(notice.winnerId);
    if (go) navigate('/pasaporte#premio');
  };

  // Escape cierra; Tab y Shift+Tab giran dentro del aviso (también donde el navegador no soporta `inert`).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && id) { event.stopPropagation(); close(id); return; }
    if (event.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  // Si el foco llegara a escapar (clic fuera con el ratón en un navegador sin `inert`), vuelve al aviso.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => { if (panel.current && event.target instanceof Node && !panel.current.contains(event.target)) primary.current?.focus(); };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [open]);

  if (!notice) return null;
  const event = [theme.meta.eventName, theme.meta.editionLabel].filter(Boolean).join(' ') || 'Día OV 2026';

  return createPortal(
    <div className="wn-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div ref={panel} className="wn-panel" role="alertdialog" aria-modal="true" aria-labelledby="wn-title" aria-describedby="wn-body">
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
          <button type="button" ref={primary} className={buttonClasses('primary', 'w-full')} onClick={() => dismiss(true)}>Ver mi premio</button>
          <button type="button" className={buttonClasses('ghost', 'w-full')} onClick={() => dismiss(false)}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
