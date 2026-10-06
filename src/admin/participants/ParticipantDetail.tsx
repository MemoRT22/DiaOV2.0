import { ArrowLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { hasRole, useAuth } from '../../lib/auth';
import { FIELD_LABELS, ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { fetchCareers, formatDateTime, formatEventDate } from '../../lib/catalog';
import { fold } from '../../lib/csv';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import ConflictReview from '../imports/ConflictReview';
import AccessDiagnosis, { type AccessState } from './AccessDiagnosis';
import ParticipantForm from './ParticipantForm';
import { EmailHistory, FormsExtra, type EmailHistoryEntry, type FormsExtraEntry } from './ParticipantExtraSections';

type InitialInterest = {
  preference: number;
  career_id: string;
  career_name: string;
  career_code: string;
  career_raw: string | null;
};

type Detail = {
  id: string;
  full_name: string;
  email: string;
  birth_date: string | null;
  phone: string | null;
  high_school: string | null;
  initial_career_id: string | null;
  initial_career_raw: string | null;
  initial_interests?: InitialInterest[];
  origin: string;
  is_demo: boolean;
  forms_consent: boolean | null;
  forms_consent_at: string | null;
  manual_consent_at: string | null;
  manual_consent_by: string | null;
  manual_overrides: Record<string, { at: string; by: string | null; cleared?: boolean }>;
  email_history?: EmailHistoryEntry[];
  forms_extra?: FormsExtraEntry[];
  pending_conflicts: number;
  has_logged_in: boolean;
  platform_consent_at: string | null;
  attendances: number;
  access: AccessState;
};

export default function ParticipantDetail() {
  const { id = '' } = useParams();
  const { staff } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { data, error, loading, reload } = useLoad(async () => {
    const [detail, careers] = await Promise.all([rpc<Detail>('get_participant', { p_id: id }), fetchCareers(true)]);
    if (!detail || typeof detail.id !== 'string') throw new Error('NOT_FOUND');
    return { detail, careers };
  }, [id]);

  if (loading && !data) return <Spinner />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Link to=".." relative="path" className="text-sm font-semibold text-fg-info">
          Volver a la búsqueda
        </Link>
      </div>
    );
  }

  const { detail: p, careers } = data;
  const career = careers.find((c) => c.id === p.initial_career_id);
  const raw = p.initial_career_raw?.trim() ?? '';
  const rawDiffers =
    !!raw && (!career || (fold(raw) !== fold(career.name) && raw.toUpperCase() !== career.code.toUpperCase()));
  const initialInterests = p.initial_interests ?? [];
  const interest1 = initialInterests.find((i) => i.preference === 1);
  const interest2 = initialInterests.find((i) => i.preference === 2);
  const rows: { key: string; label?: string; value: string | null }[] = [
    { key: 'email', value: p.email },
    { key: 'full_name', value: p.full_name },
    { key: 'birth_date', value: p.birth_date ? formatEventDate(p.birth_date) : null },
    { key: 'phone', value: p.phone },
    { key: 'high_school', value: p.high_school },
    { key: 'initial_career_id', label: 'Carrera inicial 1 (prerregistro)', value: interest1?.career_name ?? career?.name ?? null },
    ...(rawDiffers ? [{ key: 'initial_career_raw', label: 'Carrera 1 recibida en Forms', value: raw }] : []),
    { key: 'initial_career_id_2', label: 'Carrera inicial 2 (prerregistro)', value: interest2?.career_name ?? null },
    ...(interest2?.career_raw && interest2.career_raw.trim() && fold(interest2.career_raw.trim()) !== fold(interest2.career_name)
      ? [{ key: 'initial_career_2_raw', label: 'Carrera 2 recibida en Forms', value: interest2.career_raw.trim() }] : []),
  ];

  return (
    <div className="space-y-6">
      <Link to=".." relative="path" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Participantes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{p.full_name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="neutral">{ORIGIN_LABELS[p.origin] ?? p.origin}</Badge>
            {p.is_demo && <Badge tone="warning">Prueba</Badge>}
            {p.has_logged_in ? <Badge tone="success">Ya entró a la plataforma</Badge> : <Badge tone="neutral">Aún no entra</Badge>}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" aria-hidden />
          Corregir datos
        </Button>
      </header>

      {saved && <Alert tone="success">Cambios guardados.</Alert>}
      <AccessDiagnosis
        participantId={p.id}
        hasBirthDate={!!p.birth_date}
        hasLoggedIn={p.has_logged_in}
        platformConsentAt={p.platform_consent_at}
        access={p.access}
        onChanged={reload}
        onCorrect={() => setEditing(true)}
      />

      {p.pending_conflicts > 0 &&
        (hasRole(staff, 'coordinacion') ? (
          <ConflictReview
            participantId={p.id}
            heading="Datos pendientes de revisión de este participante"
            description="Una importación trajo datos distintos a los que ya se habían corregido a mano. Elige cuál se queda."
            onChange={reload}
          />
        ) : (
          <Alert tone="warning">
            Este registro tiene {p.pending_conflicts} dato(s) de importación por revisar. Coordinación debe resolverlos.
          </Alert>
        ))}

      <section className="card divide-y divide-line">
        <h2 className="px-5 py-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">Datos del registro</h2>
        {rows.map(({ key, label, value }) => {
          const override = p.manual_overrides[key];
          return (
            <div key={key} className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_1fr_auto] sm:items-center sm:gap-4">
              <p className="text-sm text-ink-muted">{label ?? FIELD_LABELS[key]}</p>
              <p className={`font-semibold ${value ? '' : 'text-ink-muted'}`}>{value ?? 'Sin dato'}</p>
              <p className="text-xs text-ink-muted">
                {override
                  ? `${override.cleared ? 'Borrado' : 'Capturado o corregido'}${override.by ? ` por ${override.by}` : ''} · ${formatDateTime(override.at)}`
                  : key === 'email'
                    ? ''
                    : key === 'initial_career_raw' || key === 'initial_career_2_raw'
                      ? 'Texto original del archivo de Forms'
                      : key === 'initial_career_id_2'
                        ? 'Segunda carrera del prerregistro'
                        : value
                          ? 'Del registro original'
                          : ''}
              </p>
            </div>
          );
        })}
      </section>

      <EmailHistory entries={p.email_history ?? []} />
      {hasRole(staff, 'coordinacion') && Array.isArray(p.forms_extra) && <FormsExtra entries={p.forms_extra} />}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-ink-muted">Consentimiento</p>
          <p className="mt-1 font-semibold">
            {p.forms_consent ? 'Aceptado en Forms' : p.manual_consent_at ? 'Capturado en alta manual' : 'Sin registro'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {p.forms_consent_at && formatDateTime(p.forms_consent_at)}
            {p.manual_consent_at && `${formatDateTime(p.manual_consent_at)}${p.manual_consent_by ? ` · ${p.manual_consent_by}` : ''}`}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-ink-muted">Aviso en la plataforma</p>
          <p className="mt-1 font-semibold">{p.platform_consent_at ? 'Aceptado' : 'Pendiente'}</p>
          {p.platform_consent_at && <p className="mt-1 text-xs text-ink-muted">{formatDateTime(p.platform_consent_at)}</p>}
        </div>
        <div className="card p-5">
          <p className="text-sm text-ink-muted">Asistencias registradas</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{p.attendances}</p>
        </div>
      </section>

      {editing && (
        <ParticipantForm
          participantId={p.id}
          careers={careers}
          initial={{
            email: p.email,
            full_name: p.full_name,
            birth_date: p.birth_date ?? '',
            phone: p.phone ?? '',
            high_school: p.high_school ?? '',
            initial_career_id: p.initial_career_id ?? '',
            initial_career_id_2: interest2?.career_id ?? '',
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            reload();
          }}
        />
      )}
    </div>
  );
}
