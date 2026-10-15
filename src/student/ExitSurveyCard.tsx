import { CheckCircle2, ClipboardList, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/ui';
import { describeOpening } from '../lib/exitSurvey';
import { useExitSurvey } from './ExitSurveyProvider';

/**
 * «Encuesta de salida» en la Bitácora: el acceso permanente, también para quien nunca vio la invitación. Pendiente → invita a
 * contestar (voluntaria: no afecta el sorteo); completada → agradece y no ofrece volver a contestar. Todo lo dice el servidor.
 */
export default function ExitSurveyCard({ stepLabel }: { stepLabel?: string }) {
  const { enabled, status, loaded, failed, refresh } = useExitSurvey();
  if (!enabled) return null;
  return (
    <section id="encuesta" className="space-card scroll-mt-20 p-5" aria-label="Encuesta de salida">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-fg-brand" aria-hidden />
        <h2 className="text-base font-extrabold">Encuesta de salida</h2>
      </div>
      {stepLabel && <p className="mt-1 text-xs font-bold uppercase tracking-wide text-ink-muted">{stepLabel}</p>}
      {!loaded || !status ? (
        failed ? (
          <div className="mt-3">
            <p className="text-sm text-ink-muted">No pudimos consultar el estado de tu encuesta.</p>
            <button type="button" onClick={() => void refresh()} className={buttonClasses('secondary', 'mt-3 w-full sm:w-auto')}>Reintentar</button>
          </div>
        ) : (
          <div className="mt-3 h-12 animate-pulse rounded-theme bg-surface-raised" role="status" aria-label="Cargando" />
        )
      ) : status.completed ? (
        <div className="mt-3 flex items-start gap-3 rounded-theme border border-success-500/40 bg-success-500/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-fg-success" aria-hidden />
          <p className="text-sm font-semibold">¡Gracias por compartir tu experiencia!</p>
        </div>
      ) : status.isOpen ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">Cuéntanos cómo te fue en el Día OV.</p>
          <p className="mt-1 text-sm text-ink-muted">Son cinco preguntas, cerca de un minuto.</p>
          <Link to="/encuesta" className={buttonClasses('primary', 'mt-4 w-full sm:w-auto')}>Responder encuesta</Link>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3 rounded-theme border border-line bg-surface-raised p-4">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          <p className="text-sm text-ink-muted">Se abrirá {describeOpening(status)} (hora de Cancún). Responderla es voluntario.</p>
        </div>
      )}
    </section>
  );
}
