import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui';
import {
  IntakeError,
  submitWorkshopProposal,
  type IntakeCatalog,
  type SubmissionReceipt,
} from '../../lib/workshopIntakeApi';
import {
  ACTIVITY_TYPES,
  EXPERIENCE_CATEGORIES,
  LIMITS,
  SESSION_DURATIONS,
  copyFor,
  describeSubmitError,
  emptyForm,
  fieldId,
  stepIdOfField,
  stepsFor,
  validateForm,
  validateStep,
  type FieldErrors,
  type FormState,
} from '../../lib/workshopForm';
import CareerPicker from './CareerPicker';
import { RadioCards, TextAreaField, TextField } from './FormFields';
import KeywordInput from './KeywordInput';
import ReviewSummary from './ReviewSummary';
import StepIndicator from './StepIndicator';

const LABELS: Record<string, string> = {
  facilitator_name: 'Nombre',
  facilitator_email: 'Correo electrónico',
  activity_type: 'Tipo de taller',
  experience_category: 'Categoría de la experiencia',
  title: 'Nombre del taller',
  student_pitch: 'Presentación del taller',
  why_join: '¿Por qué debería elegirlo un alumno?',
  objective: 'Objetivo',
  student_experience: '¿Qué hará el alumno?',
  takeaway: '¿Qué se llevará el alumno?',
  keywords: 'Palabras clave',
  session_duration_minutes: 'Duración',
  capacity_per_session: 'Cupo por sesión',
  building: 'Edificio',
  room_space: 'Salón o espacio',
  requirements: 'Requerimientos',
  notes: 'Notas',
  career_ids: 'Carreras relacionadas',
};

export default function WorkshopWizard({
  catalog,
  onSubmitted,
  onReloadCatalog,
  onUnavailable,
}: {
  catalog: IntakeCatalog;
  onSubmitted: (receipt: SubmissionReceipt, form: FormState) => void;
  onReloadCatalog: () => Promise<void>;
  onUnavailable: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fromReview, setFromReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof describeSubmitError> | null>(null);
  const [notice, setNotice] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const focusTarget = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submittingRef = useRef(false);
  const firstRun = useRef(true);

  const dirty = JSON.stringify(form) !== JSON.stringify(emptyForm());
  // Vida Universitaria omite el paso de carreras; con el tipo aún sin elegir se muestra el flujo académico.
  const steps = stepsFor(form.activity_type);
  const LAST = steps.length - 1;
  const current = steps[Math.min(step, LAST)];
  const copy = copyFor(form.activity_type);
  const stepIndexOf = (field: string) => {
    const id = stepIdOfField(field);
    return id ? steps.findIndex((s) => s.id === id) : -1;
  };

  // Aviso al salir con datos sin enviar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Si el catálogo cambia (recarga), quita selecciones que ya no existen.
  useEffect(() => {
    const careers = new Set(catalog.careers.map((c) => c.career_id));
    setForm((f) => {
      const keptCareers = f.career_ids.filter((id) => careers.has(id));
      if (keptCareers.length === f.career_ids.length) return f;
      setNotice('Actualizamos las opciones de carreras; revisa tu selección.');
      return { ...f, career_ids: keptCareers };
    });
  }, [catalog]);

  // Foco: al cambiar de paso, al título; al validar, al primer campo con error.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const target = focusTarget.current ? document.getElementById(focusTarget.current) : null;
    focusTarget.current = null;
    (target ?? headingRef.current)?.focus();
  }, [focusTick]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e) && !('_form' in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      delete rest._form;
      return rest;
    });
    setFailure(null);
  }, []);

  const goTo = (index: number, focusField?: string) => {
    focusTarget.current = focusField ? fieldId(focusField) : null;
    setStep(index);
    setReached((r) => Math.max(r, index));
    setFocusTick((t) => t + 1);
  };

  const showErrors = (found: FieldErrors, targetStep: number) => {
    setErrors(found);
    const first = (steps[targetStep].fields.find((f) => found[f]) ?? Object.keys(found)[0]) as string | undefined;
    goTo(targetStep, first);
  };

  // Taller académico sin carreras reales en el catálogo: se informa en su momento, sin bloquear el resto del formulario.
  const academicUnavailable = form.activity_type === 'academica' && catalog.careers.length === 0;

  const next = () => {
    if (current.id === 'taller' && academicUnavailable) return;
    const found = validateStep(form, current.id);
    if (Object.keys(found).length > 0) {
      showErrors(found, step);
      return;
    }
    setErrors({});
    const target = fromReview ? LAST : Math.min(step + 1, LAST);
    if (target === LAST) setFromReview(false);
    goTo(target);
  };

  const submit = async () => {
    if (submittingRef.current || academicUnavailable) return; // bloquea el doble envío aunque el botón aún no se haya deshabilitado
    const { errors: found, payload } = validateForm(form);
    if (!payload) {
      const firstField = Object.keys(found).filter((k) => k !== '_form').sort((a, b) => stepIndexOf(a) - stepIndexOf(b))[0];
      showErrors(found, firstField ? Math.max(stepIndexOf(firstField), 0) : LAST);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const receipt = await submitWorkshopProposal(payload);
      onSubmitted(receipt, form);
    } catch (err) {
      const f = describeSubmitError(err);
      if (f.unavailable) {
        onUnavailable();
        return;
      }
      setFailure(f);
      if (Object.keys(f.fieldErrors).length > 0) {
        const firstField = Object.keys(f.fieldErrors).sort((a, b) => stepIndexOf(a) - stepIndexOf(b))[0];
        setErrors(f.fieldErrors);
        goTo(Math.max(stepIndexOf(firstField), 0), firstField);
      }
      if (err instanceof IntakeError && err.kind === 'http' && err.status >= 500) setFocusTick((t) => t + 1);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (current.id !== 'revision') next();
    else void submit();
  };

  const errorList = Object.entries(errors).filter(([k]) => k !== '_form');
  const isReview = current.id === 'revision';

  return (
    <div className="space-y-6">
      <StepIndicator steps={steps} current={Math.min(step, LAST)} reached={reached} />

      <form onSubmit={onSubmit} noValidate aria-labelledby="wf-step-title" className="card space-y-6 bg-surface/80 p-5 backdrop-blur sm:p-7">
        <div>
          <h2 id="wf-step-title" ref={headingRef} tabIndex={-1} className="text-xl font-extrabold focus:outline-none">
            {current.title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{stepIntro(current.id, form.activity_type === 'vida_universitaria')}</p>
        </div>

        {notice && <Alert tone="warning">{notice}</Alert>}

        {failure && (
          <div className="space-y-3">
            <Alert tone="error">{failure.message}</Alert>
            {failure.reloadCatalog && (
              <button
                type="button"
                onClick={() => {
                  setFailure(null);
                  void onReloadCatalog();
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold hover:border-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
              >
                Actualizar opciones
              </button>
            )}
          </div>
        )}

        {errorList.length > 0 && (
          <div role="alert" className="rounded-theme border border-error-500/50 bg-error-500/10 px-4 py-3 text-sm">
            <p className="font-semibold">Revisa estos puntos para continuar:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errorList.map(([field, message]) => (
                <li key={field}>
                  <button
                    type="button"
                    onClick={() => {
                      const s = stepIndexOf(field);
                      if (s >= 0 && s !== step) goTo(s, field);
                      else document.getElementById(fieldId(field))?.focus();
                    }}
                    className="text-left underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
                  >
                    {LABELS[field] ?? field}: {message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {current.id === 'responsable' && (
          <div className="space-y-5">
            <TextField field="facilitator_name" label="Nombre completo" required autoComplete="name" value={form.facilitator_name} onChange={(v) => set('facilitator_name', v)} error={errors.facilitator_name} />
            <TextField
              field="facilitator_email"
              label="Correo electrónico"
              required
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              hint="Cualquier correo sirve. Te escribiremos aquí si hace falta ajustar algo."
              value={form.facilitator_email}
              onChange={(v) => set('facilitator_email', v)}
              error={errors.facilitator_email}
            />
          </div>
        )}

        {current.id === 'taller' && (
          <div className="space-y-5">
            <RadioCards
              field="activity_type"
              legend="Tipo de taller"
              required
              value={form.activity_type}
              onChange={(v) => {
                set('activity_type', v);
                if (v === 'academica') set('experience_category', ''); // la categoría solo existe para Vida Universitaria
              }}
              options={ACTIVITY_TYPES.map((t) => ({ value: t.value, label: t.label, description: t.description }))}
              error={errors.activity_type}
            />
            {academicUnavailable && <Alert tone="warning">El registro de talleres académicos aún no está disponible. Estamos preparando el catálogo de carreras; vuelve a intentarlo más tarde.</Alert>}
            {form.activity_type === 'vida_universitaria' && (
              <RadioCards
                field="experience_category"
                legend="Clasificación de la experiencia"
                hint="Elige la que mejor la describa."
                required
                value={form.experience_category}
                onChange={(v) => set('experience_category', v)}
                options={(catalog.experience_categories ?? EXPERIENCE_CATEGORIES).map((c) => ({ value: c.value, label: c.label }))}
                error={errors.experience_category}
              />
            )}
            <TextField field="title" label={copy.title.label} required value={form.title} onChange={(v) => set('title', v)} error={errors.title} />
            <TextAreaField
              field="student_pitch"
              label={copy.student_pitch.label}
              hint={copy.student_pitch.hint}
              required
              rows={3}
              max={LIMITS.studentPitch.max}
              value={form.student_pitch}
              onChange={(v) => set('student_pitch', v)}
              error={errors.student_pitch}
            />
          </div>
        )}

        {current.id === 'experiencia' && (
          <div className="space-y-5">
            <TextAreaField field="why_join" label={copy.why_join.label} hint={copy.why_join.hint} required max={LIMITS.whyJoin.max} value={form.why_join} onChange={(v) => set('why_join', v)} error={errors.why_join} />
            <TextAreaField
              field="objective"
              label={copy.objective.label}
              hint={copy.objective.hint}
              required={form.activity_type !== 'vida_universitaria'}
              max={LIMITS.objective.max}
              value={form.objective}
              onChange={(v) => set('objective', v)}
              error={errors.objective}
            />
            <TextAreaField
              field="student_experience"
              label={copy.student_experience.label}
              hint={copy.student_experience.hint}
              required
              max={LIMITS.studentExperience.max}
              value={form.student_experience}
              onChange={(v) => set('student_experience', v)}
              error={errors.student_experience}
            />
            <TextAreaField field="takeaway" label={copy.takeaway.label} hint={copy.takeaway.hint} required rows={3} max={LIMITS.takeaway.max} value={form.takeaway} onChange={(v) => set('takeaway', v)} error={errors.takeaway} />
            <KeywordInput value={form.keywords} onChange={(v) => set('keywords', v)} error={errors.keywords} />
          </div>
        )}

        {current.id === 'operacion' && (
          <div className="space-y-5">
            <RadioCards
              field="session_duration_minutes"
              legend="Duración del taller"
              hint="Todos los talleres se realizan entre las 10:00 a. m. y las 12:00 p. m."
              required
              value={form.session_duration_minutes}
              onChange={(v) => set('session_duration_minutes', v)}
              options={SESSION_DURATIONS.map((d) => ({ value: String(d.value), label: d.label }))}
              error={errors.session_duration_minutes}
            />
            <TextField
              field="capacity_per_session"
              label="Cupo por sesión (personas)"
              required
              inputMode="numeric"
              value={form.capacity_per_session}
              onChange={(v) => set('capacity_per_session', v)}
              error={errors.capacity_per_session}
              hint={`Entre ${LIMITS.capacityPerSession.min} y ${LIMITS.capacityPerSession.max}.`}
            />
            <TextField field="building" label="Edificio" required value={form.building} onChange={(v) => set('building', v)} error={errors.building} />
            <div>
              <TextField
                field="room_space"
                label="Salón o espacio"
                required
                value={form.room_tbd ? 'Por confirmar' : form.room_space}
                onChange={(v) => set('room_space', v)}
                disabled={form.room_tbd}
                error={errors.room_space}
              />
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                <input type="checkbox" checked={form.room_tbd} onChange={(e) => set('room_tbd', e.target.checked)} className="h-4 w-4 accent-primary-500" />
                Aún no tengo el espacio: dejarlo «Por confirmar»
              </label>
            </div>
            <TextAreaField
              field="requirements"
              label="Requerimientos"
              hint="Equipo, materiales, montaje o conexiones que necesitas."
              rows={3}
              max={LIMITS.requirementsMax}
              value={form.requirements}
              onChange={(v) => set('requirements', v)}
              error={errors.requirements}
            />
            <TextAreaField field="notes" label="Notas para el equipo organizador" rows={3} max={LIMITS.notesMax} value={form.notes} onChange={(v) => set('notes', v)} error={errors.notes} />
          </div>
        )}

        {current.id === 'carreras' && <CareerPicker catalog={catalog} value={form.career_ids} onChange={(v) => set('career_ids', v)} error={errors.career_ids} />}

        {isReview && (
          <div className="space-y-4">
            <ReviewSummary
              form={form}
              catalog={catalog}
              onEdit={(stepId) => {
                const i = steps.findIndex((s) => s.id === stepId);
                if (i < 0) return;
                setFromReview(true);
                goTo(i);
              }}
            />
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => {
              setFromReview(false);
              goTo(Math.max(step - 1, 0));
            }}
            disabled={step === 0 || submitting}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-line px-6 text-sm font-semibold text-ink hover:border-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50 disabled:invisible"
          >
            Atrás
          </button>
          <button
            type="submit"
            disabled={submitting || (current.id === 'taller' && academicUnavailable)}
            aria-busy={submitting || undefined}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary-500 px-8 text-sm font-semibold text-on-primary shadow-[0_8px_24px_-8px_rgb(var(--c-primary-500)/0.6)] hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isReview ? (submitting ? 'Enviando…' : 'Enviar propuesta') : fromReview ? 'Guardar y volver a la revisión' : current.id === steps[LAST - 1].id ? 'Revisar propuesta' : 'Siguiente'}
          </button>
        </div>
      </form>
    </div>
  );
}

function stepIntro(stepId: string, vida: boolean): string {
  switch (stepId) {
    case 'responsable':
      return 'Cuéntanos quién será el contacto del equipo organizador.';
    case 'taller':
      return vida ? 'Cuéntanos cómo se llama tu actividad y de qué trata.' : 'Lo básico de tu taller: de qué tipo es, cómo se llama y de qué trata.';
    case 'experiencia':
      return 'Ayúdanos a explicarle a los alumnos qué van a vivir.';
    case 'operacion':
      return 'Para armar el programa necesitamos saber cuánto dura, cuántas personas caben y dónde será.';
    case 'carreras':
      return 'Elige todas las carreras con las que se relaciona tu taller. Puede ser multidisciplinario: las carreras pueden ser de distintas escuelas.';
    default:
      return 'Revisa que todo esté bien. Puedes editar cualquier sección antes de enviar.';
  }
}
