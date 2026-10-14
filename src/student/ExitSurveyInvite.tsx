import { ClipboardCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { useExitSurvey } from './ExitSurveyProvider';
import { useCriticalActivity } from './useCriticalActivity';
import { useModalDialog } from './useModalDialog';
import './winner.css';

const STARS = [[12, 14], [86, 10], [20, 70], [90, 62], [50, 6], [8, 40], [94, 36]];
/** Si no se puede confirmar el reclamo (sin conexión) se reintenta pocas veces y con espera; después queda solo la Bitácora. */
export const MAX_CLAIM_ATTEMPTS = 3;
const retryDelay = (attempt: number) => Math.round((20_000 + Math.random() * 20_000) * attempt);

/**
 * Invitación automática a la encuesta de salida. Sale UNA sola vez por alumno, y solo en el dispositivo que obtiene el derecho: el
 * servidor lo concede de forma atómica (`exit_survey_mark_invited` → `claimed`) a una sola solicitud, así que con dos pestañas o dos
 * dispositivos a la vez solo uno abre el popup, y sin la confirmación del servidor (falla de conexión) no se abre ninguno por su
 * cuenta. Quien no lo obtiene conserva el acceso desde la Bitácora.
 *
 * Es de menor prioridad que cualquier otra cosa: ni se reclama ni se muestra mientras la persona escanea, confirma una operación o
 * tiene abierto el aviso de ganador; si algo prioritario aparece con el popup abierto, este se retira (sin perder el derecho ni el
 * acceso desde la Bitácora) y vuelve cuando la actividad termina. «Ahora no» y «Responder encuesta» lo cierran para siempre.
 */
export default function ExitSurveyInvite() {
  const { enabled, status, claimInvitation } = useExitSurvey();
  const critical = useCriticalActivity();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [granted, setGranted] = useState(false); // este dispositivo obtuvo el derecho a mostrarla
  const [dismissed, setDismissed] = useState(false);
  const [retry, setRetry] = useState(0);
  const claiming = useRef(false);
  const attempts = useRef(0);
  const alive = useRef(true);
  const timer = useRef(0);
  const panel = useRef<HTMLDivElement | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(timer.current); };
  }, []);

  const onSurveyPage = pathname === '/encuesta';
  const pending = enabled && !!status && status.isOpen && !status.completed;
  const due = pending && !status!.invitedAt && !granted && !dismissed;

  useEffect(() => {
    if (!due || critical || onSurveyPage || claiming.current) return;
    claiming.current = true;
    void claimInvitation().then((result) => {
      claiming.current = false;
      if (!alive.current) return;
      if (result === 'claimed') { setGranted(true); return; }
      if (result === 'failed' && attempts.current < MAX_CLAIM_ATTEMPTS) {
        attempts.current += 1;
        timer.current = window.setTimeout(() => setRetry((count) => count + 1), retryDelay(attempts.current));
      }
      // «taken»: otra pestaña o dispositivo ya la tiene; aquí no se muestra nada.
    });
  }, [due, critical, onSurveyPage, claimInvitation, retry]);

  const visible = pending && granted && !dismissed && !critical && !onSurveyPage;
  const close = () => setDismissed(true);
  const onKeyDown = useModalDialog(visible, panel, primary, close);

  if (!visible) return null;
  return createPortal(
    <div className="wn-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div ref={panel} data-exit-survey-dialog className="wn-panel" role="alertdialog" aria-modal="true" aria-labelledby="es-title" aria-describedby="es-body">
        {STARS.map(([left, top], index) => <i key={index} className="wn-star" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 0.35}s` }} aria-hidden />)}
        <div className="wn-halo" aria-hidden><ClipboardCheck size={44} /></div>
        <h2 id="es-title" className="wn-title">Una última misión</h2>
        <p id="es-body" className="mt-2 text-sm text-ink-muted">
          Cuéntanos cómo te fue en el Día OV. Responder esta encuesta es un requisito adicional para participar en el sorteo, y toma cerca de un minuto.
        </p>
        <p className="mt-3 text-xs text-ink-muted">Si prefieres, puedes hacerlo después desde tu Bitácora.</p>
        <div className="wn-actions">
          <button type="button" ref={primary} className={buttonClasses('primary', 'w-full')} onClick={() => { close(); navigate('/encuesta'); }}>Responder encuesta</button>
          <button type="button" className={buttonClasses('ghost', 'w-full')} onClick={close}>Ahora no</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
