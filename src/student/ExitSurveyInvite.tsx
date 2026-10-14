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

/**
 * Invitación automática a la encuesta de salida. Sale UNA sola vez por alumno (el servidor recuerda que ya se le mostró, también si
 * cambia de dispositivo) cuando el servidor dice que la encuesta ya está abierta y la persona todavía no contesta. Se pospone:
 * ni al cerrarla ni al ignorarla se pierde nada, y la encuesta sigue disponible en la Bitácora. No interrumpe una actividad
 * crítica (escanear, confirmar una operación, el aviso de ganador): espera a que termine y no insiste.
 */
export default function ExitSurveyInvite() {
  const { enabled, status, markInvited } = useExitSurvey();
  const critical = useCriticalActivity();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const shown = useRef(false); // por sesión de esta pantalla: aunque falle la anotación en el servidor, no se repite
  const panel = useRef<HTMLDivElement | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);

  const onSurveyPage = pathname === '/encuesta';
  const due = enabled && !!status && status.isOpen && !status.completed && !status.invitedAt && !shown.current;

  useEffect(() => {
    if (!due || critical || onSurveyPage || open) return;
    shown.current = true;
    setOpen(true);
    void markInvited();
  }, [due, critical, onSurveyPage, open, markInvited]);

  // Si contestó (en otra pestaña, por ejemplo) mientras estaba abierta, ya no hace falta.
  useEffect(() => { if (open && status?.completed) setOpen(false); }, [open, status?.completed]);

  const close = () => setOpen(false);
  const onKeyDown = useModalDialog(open, panel, primary, close);

  if (!open) return null;
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
