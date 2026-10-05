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
  LIMITS,
  STEPS,
  describeSubmitError,
  emptyForm,
  fieldId,
  stepOfField,
  validateForm,
  validateStep,
  type FieldErrors,
  type FormState,
} from '../../lib/workshopForm';
import CareerPicker from './CareerPicker';
import { RadioCards, SelectBox, TextAreaField, TextField } from './FormFields';
import KeywordInput from './KeywordInput';
import ReviewSummary from './ReviewSummary';
import StepIndicator from './StepIndicator';

const LABELS: Record<string, string> = {
  facilitator_name: 'Nombre',
  facilitator_email: 'Correo electrónico',
  facilitator_phone: 'Teléfono',
  division_id: 'Escuela o división',
  activity_type: 'Tipo de experiencia',
  title: 'Nombre del taller',
  student_pitch: 'Presentación del taller',
  why_join: '¿Por qué debería elegirlo un alumno?',
  objective: 'Objetivo',
  student_experience: '¿Qué hará el alumno?',
  takeaway: '¿Qué se llevará el alumno?',
  keywords: 'Palabras clave',
  session_duration_minutes: 'Duración por sesión',
  capacity_per_session: 'Cupo por sesión',
  operating_start_time: 'Hora de inicio',
  operating_end_time: 'Hora de fin',
  break_minutes: 'Descanso entre sesiones',
  building: 'Edificio',
  room_space: 'Salón o espacio',
  requirements: 'Requerimientos',
  notes: 'Notas',
  career_ids: 'Carreras relacionadas',
};

const TYPE_HINTS: Record<string, string> = {
  academica: 'Un acercamiento práctico a una disciplina o carrera.',
  liderazgo: 'Habilidades de liderazgo, trabajo en equipo y comunicación.',
};

const LAST = STEPS.length - 1;

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
    const divisions = new Set(catalog.divisions.map((d) => d.division_id));
    setForm((f) => {
      const keptCareers = f.career_ids.filter((id) => careers.has(id));
      const divisionOk = !f.division_id || divisions.has(f.division_id);
      if (keptCareers.length === f.career_ids.length && divisionOk) return f;
      setNotice('Actualizamos las opciones de escuelas y carreras; revisa tu selección.');
      return { ...f, career_ids: keptCareers, division_id: divisionOk ? f.division_id : '' };
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
    const first = (STEPS[targetStep].fields.find((f) => found[f]) ?? Object.keys(found)[0]) as string | undefined;
    goTo(targetStep, first);
  };

  const next = () => {
    const found = validateStep(form, step);
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
    if (submittingRef.current) return; // bloquea el doble envío aunque el botón aún no se haya deshabilitado
    const { errors: found, payload } = validateForm(form);
    if (!payload) {
      const firstField = Object.keys(found).filter((k) => k !== '_form').sort((a, b) => stepOfField(a) - stepOfField(b))[0];
      showErrors(found, firstField ? Math.max(stepOfField(firstField), 0) : LAST);
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
        const firstField = Object.keys(f.fieldErrors).sort((a, b) => stepOfField(a) - stepOfField(b))[0];
        setErrors(f.fieldErrors);
        goTo(Math.max(stepOfField(firstField), 0), firstField);
      }
      if (err instanceof IntakeError && err.kind === 'http' && err.status >= 500) setFocusTick((t) => t + 1);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step < LAST) next();
    else void submit();
  };

  const errorList = Object.entries(errors).filter(([k]) => k !== '_form');
  const isReview = step === LAST;

  return (
    <div className="space-y-6">
      <StepIndicator steps={STEPS} current={step} reached={reached} />

      <form onSubmit={onSubmit} noValidate aria-labelledby="wf-step-title" className="card space-y-6 bg-surface/80 p-5 backdrop-blur sm:p-7">
        <div>
          <h2 id="wf-step-title" ref={headingRef} tabIndex={-1} className="text-xl font-extrabold focus:outline-none">
            {STEPS[step].title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{stepIntro(step)}</p>
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
                      const s = stepOfField(field);
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

        {step === 0 && (
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
            <TextField
              field="facilitator_phone"
              label="Teléfono o WhatsApp"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.facilitator_phone}
              onChange={(v) => set('facilitator_phone', v)}
              error={errors.facilitator_phone}
            />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <SelectBox
              field="division_id"
              label="Escuela o división que organiza el taller"
              required
              placeholder="Elige una opción"
              value={form.division_id}
              onChange={(v) => set('division_id', v)}
              options={catalog.divisions.map((d) => ({ value: d.division_id, label: d.division_name }))}
              error={errors.division_id}
            />
            <RadioCards
              field="activity_type"
              legend="Tipo de experiencia"
              required
              value={form.activity_type}
              onChange={(v) => set('activity_type', v)}
              options={catalog.activity_types.map((t) => ({ value: t.value, label: t.label, description: TYPE_HINTS[t.value] }))}
              error={errors.activity_type}
            />
            <TextField field="title" label="Nombre del taller" required value={form.title} onChange={(v) => set('title', v)} error={errors.title} />
            <TextAreaField
              field="student_pitch"
              label="Presenta tu taller en pocas palabras"
              hint="Es lo primero que verán los alumnos al elegirlo."
              required
              rows={3}
              max={LIMITS.studentPitch.max}
              value={form.student_pitch}
              onChange={(v) => set('student_pitch', v)}
              error={errors.student_pitch}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <TextAreaField field="why_join" label="¿Por qué debería elegirlo un alumno?" required max={LIMITS.whyJoin.max} value={form.why_join} onChange={(v) => set('why_join', v)} error={errors.why_join} />
            <TextAreaField field="objective" label="¿Cuál es el objetivo del taller?" required max={LIMITS.objective.max} value={form.objective} onChange={(v) => set('objective', v)} error={errors.objective} />
            <TextAreaField
              field="student_experience"
              label="¿Qué hará el alumno durante el taller?"
              required
              max={LIMITS.studentExperience.max}
              value={form.student_experience}
              onChange={(v) => set('student_experience', v)}
              error={errors.student_experience}
            />
            <TextAreaField field="takeaway" label="¿Qué se llevará el alumno al terminar?" required rows={3} max={LIMITS.takeaway.max} value={form.takeaway} onChange={(v) => set('takeaway', v)} error={errors.takeaway} />
            <KeywordInput value={form.keywords} onChange={(v) => set('keywords', v)} error={errors.keywords} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                field="session_duration_minutes"
                label="Duración de cada sesión (minutos)"
                required
                inputMode="numeric"
                value={form.session_duration_minutes}
                onChange={(v) => set('session_duration_minutes', v)}
                error={errors.session_duration_minutes}
                hint={`Entre ${LIMITS.sessionDurationMinutes.min} y ${LIMITS.sessionDurationMinutes.max}.`}
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
            </div>
            <fieldset className="grid gap-5 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold text-ink">Horario en el que puedes dar el taller</legend>
              <TextField field="operating_start_time" label="Desde" required type="time" value={form.operating_start_time} onChange={(v) => set('operating_start_time', v)} error={errors.operating_start_time} />
              <TextField field="operating_end_time" label="Hasta" required type="time" value={form.operating_end_time} onChange={(v) => set('operating_end_time', v)} error={errors.operating_end_time} />
            </fieldset>
            <TextField
              field="break_minutes"
              label="Descanso entre sesiones (minutos)"
              required
              inputMode="numeric"
              hint="Si no necesitas descanso, escribe 0."
              value={form.break_minutes}
              onChange={(v) => set('break_minutes', v)}
              error={errors.break_minutes}
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

        {step === 4 && <CareerPicker catalog={catalog} value={form.career_ids} onChange={(v) => set('career_ids', v)} error={errors.career_ids} />}

        {isReview && (
          <div className="space-y-4">
            <ReviewSummary
              form={form}
              catalog={catalog}
              onEdit={(i) => {
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
            disabled={submitting}
            aria-busy={submitting || undefined}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary-500 px-8 text-sm font-semibold text-on-primary shadow-[0_8px_24px_-8px_rgb(var(--c-primary-500)/0.6)] hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isReview ? (submitting ? 'Enviando…' : 'Enviar propuesta') : fromReview ? 'Guardar y volver a la revisión' : step === LAST - 1 ? 'Revisar propuesta' : 'Siguiente'}
          </button>
        </div>
      </form>
    </div>
  );
}

function stepIntro(step: number): string {
  switch (step) {
    case 0:
      return 'Cuéntanos quién será el contacto del equipo organizador.';
    case 1:
      return 'Lo básico de tu taller: quién lo organiza, de qué trata y cómo se llama.';
    case 2:
      return 'Ayúdanos a explicarle a los alumnos qué van a vivir.';
    case 3:
      return 'Para armar el programa necesitamos saber cuándo y dónde puedes darlo.';
    case 4:
      return 'Elige todas las carreras con las que se relaciona tu taller. Puede ser multidisciplinario: no tiene que pertenecer solo a la escuela que lo organiza.';
    default:
      return 'Revisa que todo esté bien. Puedes editar cualquier sección antes de enviar.';
  }
}
