import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import type { IntakeCatalog } from '../../lib/workshopIntakeApi';
import { ROOM_TBD, type FormState } from '../../lib/workshopForm';

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="card p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-extrabold">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${title}`}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-ink hover:border-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary-500/50"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Editar
        </button>
      </div>
      <dl className="mt-3 space-y-3 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{children}</dd>
    </div>
  );
}

/** Resumen completo antes de enviar. Cada sección tiene su botón para volver a editarla. */
export default function ReviewSummary({
  form,
  catalog,
  onEdit,
}: {
  form: FormState;
  catalog: IntakeCatalog;
  onEdit: (stepIndex: number) => void;
}) {
  const division = catalog.divisions.find((d) => d.division_id === form.division_id)?.division_name ?? '—';
  const type = catalog.activity_types.find((t) => t.value === form.activity_type)?.label ?? '—';
  const careerNames = form.career_ids.map((id) => catalog.careers.find((c) => c.career_id === id)?.career_name ?? 'Carrera no disponible');
  return (
    <div className="space-y-4">
      <Section title="Tus datos" onEdit={() => onEdit(0)}>
        <Row label="Nombre">{form.facilitator_name}</Row>
        <Row label="Correo electrónico">{form.facilitator_email}</Row>
        <Row label="Teléfono">{form.facilitator_phone.trim() || 'No indicado'}</Row>
      </Section>
      <Section title="Tu taller" onEdit={() => onEdit(1)}>
        <Row label="Escuela o división organizadora">{division}</Row>
        <Row label="Tipo de experiencia">{type}</Row>
        <Row label="Nombre del taller">{form.title}</Row>
        <Row label="Presentación">{form.student_pitch}</Row>
      </Section>
      <Section title="La experiencia del alumno" onEdit={() => onEdit(2)}>
        <Row label="¿Por qué debería elegirlo un alumno?">{form.why_join}</Row>
        <Row label="Objetivo">{form.objective}</Row>
        <Row label="¿Qué hará el alumno?">{form.student_experience}</Row>
        <Row label="¿Qué se llevará?">{form.takeaway}</Row>
        <Row label="Palabras clave">
          <ul className="flex flex-wrap gap-2">
            {form.keywords.map((k) => (
              <li key={k} className="rounded-full bg-primary-500/15 px-3 py-1 text-xs font-medium">
                {k}
              </li>
            ))}
          </ul>
        </Row>
      </Section>
      <Section title="Horarios y logística" onEdit={() => onEdit(3)}>
        <Row label="Duración por sesión">{form.session_duration_minutes} minutos</Row>
        <Row label="Cupo por sesión">{form.capacity_per_session} personas</Row>
        <Row label="Horario disponible">
          {form.operating_start_time} a {form.operating_end_time}
        </Row>
        <Row label="Descanso entre sesiones">{form.break_minutes} minutos</Row>
        <Row label="Edificio">{form.building}</Row>
        <Row label="Salón o espacio">{form.room_tbd ? ROOM_TBD : form.room_space}</Row>
        <Row label="Requerimientos">{form.requirements.trim() || 'Ninguno'}</Row>
        <Row label="Notas">{form.notes.trim() || 'Ninguna'}</Row>
      </Section>
      <Section title="Carreras relacionadas" onEdit={() => onEdit(4)}>
        <Row label={`${careerNames.length} ${careerNames.length === 1 ? 'carrera' : 'carreras'}`}>
          <ul className="list-disc space-y-1 pl-5">
            {careerNames.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        </Row>
      </Section>
    </div>
  );
}
