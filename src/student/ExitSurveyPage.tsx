import { ArrowLeft, ArrowRight, Check, Clock, PartyPopper, Send, Star } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses, PageSkeleton } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import {
  AREA_OPTIONS, answered, COMMENT_MAX, describeOpening, EMPTY_ANSWERS, isComplete, MAX_AREAS, NO_AREA, Q1_OPTIONS, Q3_OPTIONS, QUESTION_COUNT,
  submitExitSurvey, toggleArea, type ExitSurveyOutcome, type ExitSurveyStatus, type SurveyAnswers,
} from '../lib/exitSurvey';
import { isTemporaryAccessError } from '../lib/accessErrors';
import { useExitSurvey } from './ExitSurveyProvider';
import { EmptyState, ErrorState } from './ui/States';

const STAR_WORDS = ['Nada', 'Poco', 'Algo', 'Bastante', 'Mucho'];
const draftKey = (participantId: string | undefined) => `diaov.exitSurvey.draft:${participantId ?? 'anon'}`;

type Draft = { answers: SurveyAnswers; step: number };
function readDraft(participantId: string | undefined): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    return parsed && typeof parsed === 'object' && parsed.answers ? { answers: { ...EMPTY_ANSWERS, ...parsed.answers }, step: Math.min(Math.max(0, Number(parsed.step) || 0), QUESTION_COUNT - 1) } : null;
  } catch {
    return null; // un navegador sin almacenamiento solo pierde el borrador
  }
}
const writeDraft = (participantId: string | undefined, draft: Draft | null) => {
  try {
    if (draft) sessionStorage.setItem(draftKey(participantId), JSON.stringify(draft)); else sessionStorage.removeItem(draftKey(participantId));
  } catch { /* sin borrador */ }
};

/** Un cuadro de opción: se elige con el dedo, con el teclado (flechas / espacio) y lo lee un lector de pantalla como botón de radio o casilla. */
function Choice({ type, name, label, checked, disabled, onChange }: { type: 'radio' | 'checkbox'; name: string; label: string; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-theme border px-4 py-3 text-left text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-secondary-500/40 ${checked ? 'border-primary-400 bg-primary-500/15 text-ink' : 'border-line bg-surface-raised hover:border-secondary-400'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${type === 'radio' ? 'rounded-full' : 'rounded-md'} ${checked ? 'border-primary-400 bg-primary-500 text-on-primary' : 'border-line'}`} aria-hidden>
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Calificación de 1 a 5 estrellas" className="flex justify-between gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value !== null && n <= value;
          return (
            <label key={n} className="flex min-h-14 flex-1 cursor-pointer items-center justify-center rounded-theme border border-line bg-surface-raised transition-colors focus-within:ring-2 focus-within:ring-secondary-500/40 hover:border-secondary-400">
              <input type="radio" name="q2" className="sr-only" checked={value === n} onChange={() => onChange(n)} aria-label={`${n} de 5 estrellas`} />
              <Star className={`h-8 w-8 transition-colors ${on ? 'fill-accent-400 text-accent-400' : 'text-ink-muted'}`} aria-hidden />
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-center text-sm font-semibold text-ink-muted" aria-live="polite">{value ? `${value} de 5 · ${STAR_WORDS[value - 1]}` : 'Toca una estrella'}</p>
    </div>
  );
}

function Recommend({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Probabilidad de recomendar el Día OV, de 0 a 10" className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, n) => (
          <label key={n} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-theme border text-base font-extrabold transition-colors focus-within:ring-2 focus-within:ring-secondary-500/40 ${value === n ? 'border-primary-400 bg-primary-500 text-on-primary' : 'border-line bg-surface-raised hover:border-secondary-400'}`}>
            <input type="radio" name="q5" className="sr-only" checked={value === n} onChange={() => onChange(n)} aria-label={`${n}`} />
            <span aria-hidden>{n}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-muted"><span>0 · Nada probable</span><span>10 · Muy probable</span></div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

/** Mensaje final: lo dice el servidor (sellos de una categoría + encuesta), no el navegador. */
function Done({ outcome, status, justNow }: { outcome: ExitSurveyOutcome | null; status: ExitSurveyStatus; justNow: boolean }) {
  const server = outcome ?? status;
  return (
    <section className="space-card animate-fade-up px-6 py-8 text-center" aria-live="polite">
      <span className="icon-orb mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-fg-brand" aria-hidden><PartyPopper className="h-8 w-8" /></span>
      <h1 className="mt-4 text-2xl font-extrabold">{justNow ? '¡Misión completada!' : '¡Gracias por compartir tu experiencia!'}</h1>
      <p className="mx-auto mt-1 max-w-xs text-sm text-ink-muted">{justNow ? 'Gracias por ayudarnos a mejorar el Día OV.' : 'Tu encuesta ya está registrada: no necesitas contestarla de nuevo.'}</p>
      {!server.hasWon && (
        <p className={`mx-auto mt-4 max-w-xs rounded-theme border p-3 text-sm font-semibold ${server.eligible ? 'border-success-500/40 bg-success-500/10' : 'border-line bg-surface-raised'}`}>
          {server.eligible
            ? `Ya cumples los requisitos para participar en el sorteo${server.stampsCategoryName ? ` (${server.stampsCategoryName})` : ''}.`
            : 'Tu encuesta ya está lista. Sigue completando misiones para alcanzar una categoría.'}
        </p>
      )}
      <Link to="/pasaporte" className={buttonClasses('primary', 'mt-6 w-full sm:w-auto')}>Ir a mi bitácora</Link>
    </section>
  );
}

/**
 * Encuesta de salida (`/encuesta`): cinco preguntas, una por paso, pensadas para contestarse en cerca de un minuto desde el teléfono.
 * Las cinco son obligatorias; el comentario de la última es opcional. Lo escrito se conserva si falla el envío o se recarga la
 * página (en esta pestaña), y reenviar es seguro: el servidor no duplica ni sobrescribe.
 */
export default function ExitSurveyPage() {
  const { enabled, status, loaded, failed, refresh, apply } = useExitSurvey();
  const { profile } = useAuth();
  const participantId = profile?.participant_id;
  const [draft] = useState(() => readDraft(participantId));
  const [answers, setAnswers] = useState<SurveyAnswers>(draft?.answers ?? EMPTY_ANSWERS);
  const [step, setStep] = useState(draft?.step ?? 0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; temporary: boolean } | null>(null);
  const [outcome, setOutcome] = useState<ExitSurveyOutcome | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => { document.title = 'Encuesta de salida'; }, []);
  // Al cambiar de pregunta el foco va al título: quien usa lector de pantalla o teclado se entera del cambio.
  useEffect(() => { heading.current?.focus({ preventScroll: false }); }, [step]);
  useEffect(() => { if (!outcome) writeDraft(participantId, { answers, step }); }, [answers, step, participantId, outcome]);

  const set = useCallback((patch: Partial<SurveyAnswers>) => { setError(null); setAnswers((current) => ({ ...current, ...patch })); }, []);

  const send = async () => {
    if (inFlight.current || !isComplete(answers)) return; // un envío a la vez; nunca un formulario incompleto
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const result = await submitExitSurvey(answers);
      apply(result);
      setOutcome(result);
      writeDraft(participantId, null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : '';
      if (code.includes('SURVEY_NOT_OPEN') || code.includes('SURVEY_VERSION_MISMATCH')) void refresh();
      setError({ message: friendlyError(cause), temporary: isTemporaryAccessError(cause) });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  if (!enabled || !loaded || !status) {
    if (failed) return <ErrorState error={new Error('NETWORK')} onRetry={() => void refresh()} title="No pudimos abrir la encuesta" />;
    return <PageSkeleton blocks={2} />;
  }
  if (outcome) return <Done outcome={outcome} status={status} justNow={!outcome.alreadyCompleted} />;
  if (status.completed) return <Done outcome={null} status={status} justNow={false} />;
  if (!status.isOpen) {
    return (
      <EmptyState icon={Clock} title="La encuesta aún no está abierta"
        action={<div className="flex flex-col gap-2 sm:flex-row sm:justify-center"><Button variant="secondary" onClick={() => void refresh()}>Actualizar</Button><Link to="/pasaporte" className={buttonClasses('ghost')}>Volver a mi bitácora</Link></div>}>
        Se abre {describeOpening(status)} (hora de Cancún). Cuando llegue la hora podrás contestarla aquí y desde tu Bitácora.
      </EmptyState>
    );
  }

  const last = step === QUESTION_COUNT - 1;
  const ready = answered(answers, step);
  const percent = Math.round(((step + (ready ? 1 : 0)) / QUESTION_COUNT) * 100);

  return (
    <Shell>
      <header className="animate-fade-up">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">Encuesta de salida</p>
        <div className="mt-2 flex items-center justify-between text-xs font-semibold text-ink-muted">
          <span>Pregunta {step + 1} de {QUESTION_COUNT}</span>
          <span>≈ 1 minuto</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-raised" role="progressbar" aria-label="Avance de la encuesta" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={step + (ready ? 1 : 0)}>
          <div className="h-full rounded-full bg-primary-500 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); if (last) void send(); else if (ready) setStep(step + 1); }} noValidate className="space-card space-y-5 p-5">
        <div key={step} className="animate-fade-up space-y-4">
          {step === 0 && (<>
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">Antes de venir, ¿ya sabías qué querías estudiar?</h2>
            <div role="radiogroup" aria-label="Qué tan definido tenías qué estudiar" className="space-y-2">
              {Q1_OPTIONS.map((option) => <Choice key={option.value} type="radio" name="q1" label={option.label} checked={answers.q1 === option.value} onChange={() => set({ q1: option.value })} />)}
            </div>
          </>)}
          {step === 1 && (<>
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">¿Qué tanto te ayudaron los talleres a conocer las carreras?</h2>
            <Stars value={answers.q2} onChange={(q2) => set({ q2 })} />
          </>)}
          {step === 2 && (<>
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">Después del Día OV, ¿qué tan claro tienes qué estudiar?</h2>
            <div role="radiogroup" aria-label="Qué tan claro tienes qué estudiar" className="space-y-2">
              {Q3_OPTIONS.map((option) => <Choice key={option.value} type="radio" name="q3" label={option.label} checked={answers.q3 === option.value} onChange={() => set({ q3: option.value })} />)}
            </div>
          </>)}
          {step === 3 && (<>
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">¿Qué áreas te interesaron más?</h2>
            <p className="text-sm text-ink-muted">Elige hasta {MAX_AREAS}. Esto no cambia las carreras de interés que elijas en tu Bitácora.</p>
            <div role="group" aria-label="Áreas de interés" className="space-y-2">
              {AREA_OPTIONS.map((option) => {
                const checked = answers.q4.includes(option.value);
                const full = !checked && !answers.q4.includes(NO_AREA) && answers.q4.length >= MAX_AREAS;
                return <Choice key={option.value} type="checkbox" name="q4" label={option.label} checked={checked} disabled={full} onChange={() => set({ q4: toggleArea(answers.q4, option.value) })} />;
              })}
              <Choice type="checkbox" name="q4" label="Todavía no tengo un área definida" checked={answers.q4.includes(NO_AREA)} onChange={() => set({ q4: toggleArea(answers.q4, NO_AREA) })} />
            </div>
            <p className="text-xs text-ink-muted" aria-live="polite">{answers.q4.includes(NO_AREA) ? 'Sin área definida' : `${answers.q4.length} de ${MAX_AREAS} elegidas`}</p>
          </>)}
          {step === 4 && (<>
            <h2 ref={heading} tabIndex={-1} className="text-xl font-extrabold outline-none">¿Qué tan probable es que recomiendes el Día OV?</h2>
            <Recommend value={answers.q5} onChange={(q5) => set({ q5 })} />
            <label className="block pt-1">
              <span className="mb-2 block text-sm font-semibold">¿Qué mejorarías? <span className="font-normal text-ink-muted">(opcional)</span></span>
              <textarea
                value={answers.comment}
                maxLength={COMMENT_MAX}
                rows={3}
                onChange={(event) => set({ comment: event.target.value })}
                className="w-full rounded-theme border border-line bg-surface-raised px-4 py-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30"
              />
              <span className="mt-1 block text-right text-xs text-ink-muted">{answers.comment.length}/{COMMENT_MAX}</span>
            </label>
          </>)}
        </div>

        {error && (
          <Alert tone="error">
            <p>{error.message}</p>
            {error.temporary && <p className="mt-1 text-ink-muted">Tus respuestas se conservan. Cuando tengas conexión, toca «Reintentar envío».</p>}
          </Alert>
        )}

        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button type="button" variant="ghost" onClick={() => { setError(null); setStep(step - 1); }} disabled={sending}>
              <ArrowLeft className="h-4 w-4" aria-hidden />Atrás
            </Button>
          )}
          <Button type="submit" className="ml-auto" disabled={!ready} loading={sending}>
            {last ? (<><Send className="h-4 w-4" aria-hidden />{error?.temporary ? 'Reintentar envío' : 'Enviar encuesta'}</>) : (<>Siguiente<ArrowRight className="h-4 w-4" aria-hidden /></>)}
          </Button>
        </div>
      </form>
      <p className="text-center text-xs text-ink-muted">Es un requisito adicional para participar en el sorteo. Tus respuestas ayudan a mejorar el Día OV.</p>
    </Shell>
  );
}
