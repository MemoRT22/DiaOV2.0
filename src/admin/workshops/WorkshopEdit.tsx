import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { fetchWorkshopIntakeCatalog } from '../../lib/workshopIntakeApi';
import {
  ACTIVITY_TYPES, EXPERIENCE_CATEGORIES, LIMITS, durationsFor, ROOM_TBD,
  copyFor, emptyForm, validateForm, type FieldErrors, type FormState,
} from '../../lib/workshopForm';
import { useLoad } from '../../lib/useLoad';
import { groupForStatus, workshopAdminApi, type WorkshopDetail } from '../../lib/workshopAdminApi';
import CareerPicker from '../../public/workshop/CareerPicker';
import { RadioCards, TextAreaField, TextField } from '../../public/workshop/FormFields';
import KeywordInput from '../../public/workshop/KeywordInput';

export function formFromDetail(detail: WorkshopDetail): FormState {
  return {
    facilitator_name: detail.facilitator_name, facilitator_email: detail.facilitator_email,
    activity_type: detail.activity_type, experience_category: detail.experience_category as FormState['experience_category'] ?? '',
    title: detail.title, student_pitch: detail.student_pitch, objective: detail.objective ?? '',
    takeaway: detail.takeaway, keywords: detail.keywords,
    session_duration_minutes: String(detail.session_duration_minutes), capacity_per_session: String(detail.capacity_per_session),
    building: detail.building, room_space: detail.room_space === ROOM_TBD ? '' : detail.room_space,
    room_tbd: detail.room_space === ROOM_TBD, requirements: detail.requirements ?? '', notes: detail.notes ?? '',
    career_ids: detail.careers.map((c) => c.career_id),
  };
}

/** One form for both jobs: correcting an existing workshop (`detail`) or creating a new one from the panel (no `detail`). */
function Editor({ detail, catalog }: { detail?: WorkshopDetail; catalog: Awaited<ReturnType<typeof fetchWorkshopIntakeCatalog>> }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => (detail ? formFromDetail(detail) : emptyForm()));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState<false | 'save' | 'publish'>(false);
  const savingRef = useRef(false);
  const [failure, setFailure] = useState('');
  const back = detail ? `/coordinacion/talleres/${detail.id}` : '/coordinacion/talleres';
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  };
  const save = async (publish: boolean) => {
    if (savingRef.current) return;
    const result = validateForm(form);
    if (!result.payload) { setErrors(result.errors); return; }
    savingRef.current = true; setSaving(publish ? 'publish' : 'save'); setFailure('');
    try {
      if (detail) {
        await workshopAdminApi.edit(detail.id, result.payload);
        navigate(back, { replace: true });
      } else {
        const created = await workshopAdminApi.create(result.payload, publish);
        navigate(`/coordinacion/talleres/${created.submission_id}`, { replace: true });
      }
    } catch (cause) { setFailure(friendlyError(cause)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(false); };
  const copy = copyFor(form.activity_type);
  return <div className="space-y-6">
    <Link to={back} className="text-sm font-semibold underline">{detail ? 'Volver al taller' : 'Volver a Talleres'}</Link>
    {detail
      ? <header className="admin-feature-card p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Taller · edición</p><h1 className="mt-1 text-2xl font-extrabold">Editar taller</h1><p className="mt-1 text-sm text-ink-muted">{detail.title}. Revisa cada sección y guarda al finalizar.</p></header>
      : <header className="admin-feature-card p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Taller · alta</p><h1 className="mt-1 text-2xl font-extrabold">Nuevo taller</h1><p className="mt-1 text-sm text-ink-muted">Académico o de Vida Universitaria. Puedes dejarlo pendiente de revisión o publicarlo de inmediato para los alumnos.</p></header>}
    {failure && <Alert tone="error">{failure}</Alert>}
    {Object.keys(errors).length > 0 && <Alert tone="error">Revisa los campos marcados antes de guardar.</Alert>}
    <form onSubmit={submit} noValidate className="space-y-6">
      <section className="card admin-editor-section space-y-4 p-5"><h2 data-step="01" className="text-lg font-bold">Responsable</h2>
        <TextField field="facilitator_name" label="Nombre completo" required value={form.facilitator_name} onChange={(v) => set('facilitator_name', v)} error={errors.facilitator_name} />
        <TextField field="facilitator_email" label="Correo electrónico" required type="email" value={form.facilitator_email} onChange={(v) => set('facilitator_email', v)} error={errors.facilitator_email} />
      </section>
      <section className="card admin-editor-section space-y-4 p-5"><h2 data-step="02" className="text-lg font-bold">Sobre el taller</h2>
        <RadioCards field="activity_type" legend="Tipo de taller" required value={form.activity_type}
          onChange={(v) => { set('activity_type', v); if (v === 'academica') { set('experience_category', ''); if (form.session_duration_minutes === '15') set('session_duration_minutes', '30'); } else set('career_ids', []); }}
          options={ACTIVITY_TYPES.map((t) => ({ value: t.value, label: t.label, description: t.description }))} error={errors.activity_type} />
        {form.activity_type === 'vida_universitaria' && <RadioCards field="experience_category" legend="Categoría de la experiencia" required value={form.experience_category}
          onChange={(v) => set('experience_category', v)} options={EXPERIENCE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} error={errors.experience_category} />}
        <TextField field="title" label={copy.title.label} required value={form.title} onChange={(v) => set('title', v)} error={errors.title} />
        <TextAreaField field="student_pitch" label="Presentación breve" required rows={3} max={LIMITS.studentPitch.max} value={form.student_pitch} onChange={(v) => set('student_pitch', v)} error={errors.student_pitch} />
      </section>
      <section className="card admin-editor-section space-y-4 p-5"><h2 data-step="03" className="text-lg font-bold">Experiencia</h2>
        <TextAreaField field="objective" label="Objetivo" required={form.activity_type === 'academica'} max={LIMITS.objective.max} value={form.objective} onChange={(v) => set('objective', v)} error={errors.objective} />
        <TextAreaField field="takeaway" label="Qué se llevará el alumno" required max={LIMITS.takeaway.max} value={form.takeaway} onChange={(v) => set('takeaway', v)} error={errors.takeaway} />
        <KeywordInput value={form.keywords} onChange={(v) => set('keywords', v)} error={errors.keywords} />
      </section>
      <section className="card admin-editor-section space-y-4 p-5"><h2 data-step="04" className="text-lg font-bold">Logística</h2>
        <RadioCards field="session_duration_minutes" legend="Duración" required value={form.session_duration_minutes} onChange={(v) => set('session_duration_minutes', v)}
          options={durationsFor(form.activity_type).map((d) => ({ value: String(d.value), label: d.label }))} error={errors.session_duration_minutes} />
        <TextField field="capacity_per_session" label="Cupo por sesión" required inputMode="numeric" value={form.capacity_per_session} onChange={(v) => set('capacity_per_session', v)} error={errors.capacity_per_session} />
        <TextField field="building" label="Edificio" required value={form.building} onChange={(v) => set('building', v)} error={errors.building} />
        <TextField field="room_space" label="Salón o espacio" required disabled={form.room_tbd} value={form.room_tbd ? ROOM_TBD : form.room_space} onChange={(v) => set('room_space', v)} error={errors.room_space} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.room_tbd} onChange={(e) => set('room_tbd', e.target.checked)} />Por confirmar</label>
        <TextAreaField field="requirements" label="Requerimientos" max={LIMITS.requirementsMax} value={form.requirements} onChange={(v) => set('requirements', v)} error={errors.requirements} />
        <TextAreaField field="notes" label="Notas" max={LIMITS.notesMax} value={form.notes} onChange={(v) => set('notes', v)} error={errors.notes} />
      </section>
      {form.activity_type === 'academica' && <section className="card admin-editor-section space-y-4 p-5"><h2 data-step="05" className="text-lg font-bold">Carreras relacionadas</h2>
        <CareerPicker catalog={catalog} value={form.career_ids} onChange={(v) => set('career_ids', v)} error={errors.career_ids} />
      </section>}
      <div className="admin-form-actions flex flex-wrap items-center justify-end gap-3"><Link to={back} className="admin-action-link">Cancelar</Link>
        {detail
          ? <Button type="submit" loading={saving === 'save'} disabled={!!saving}>Guardar cambios</Button>
          : <>
            <Button type="submit" variant="secondary" loading={saving === 'save'} disabled={!!saving}>Guardar como pendiente</Button>
            <Button type="button" loading={saving === 'publish'} disabled={!!saving} onClick={() => void save(true)}>Crear y publicar</Button>
          </>}
      </div>
    </form>
  </div>;
}

export default function WorkshopEdit() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useLoad(async () => {
    const [detail, catalog] = await Promise.all([workshopAdminApi.get(id), fetchWorkshopIntakeCatalog()]);
    return { detail, catalog };
  }, [id]);
  if (loading && !data) return <Spinner label="Cargando edición" />;
  if (!data) return <Alert tone="error">{friendlyError(error)} <button onClick={reload} className="underline">Reintentar</button></Alert>;
  if (groupForStatus(data.detail.status) === 'archived') return <Alert tone="warning">Este taller está descartado. <Link to={`/coordinacion/talleres/${id}`} className="underline">Ver taller</Link></Alert>;
  return <Editor key={id} detail={data.detail} catalog={data.catalog} />;
}

/** Alta de un taller desde el panel. Usa el mismo modelo, la misma validación y el mismo formulario que la edición. */
export function WorkshopCreate() {
  const { data, error, loading, reload } = useLoad(fetchWorkshopIntakeCatalog, []);
  if (loading && !data) return <Spinner label="Cargando formulario" />;
  if (!data) return <Alert tone="error">{friendlyError(error)} <button onClick={reload} className="underline">Reintentar</button></Alert>;
  return <Editor catalog={data} />;
}
