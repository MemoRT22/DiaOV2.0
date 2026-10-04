import { ArrowLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { hasRole, useAuth } from '../../lib/auth';
import { FIELD_LABELS, ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { fetchCareers, formatDateTime, formatEventDate } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import AccessStatus, { type AccessState } from './AccessStatus';
import ParticipantForm from './ParticipantForm';
import { EmailHistory, FormsExtra, type EmailHistoryEntry, type FormsExtraEntry } from './ParticipantExtraSections';

type Detail = {
  id: string;
  full_name: string;
  email: string;
  birth_date: string | null;
  phone: string | null;
  high_school: string | null;
  initial_career_id: string | null;
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
        <Link to=".." relative="path" className="text-sm font-semibold text-secondary-300">
          Volver a la búsqueda
        </Link>
      </div>
    );
  }

  const { detail: p, careers } = data;
  const career = careers.find((c) => c.id === p.initial_career_id);
  const rows: { key: string; value: string | null }[] = [
    { key: 'email', value: p.email },
    { key: 'full_name', value: p.full_name },
    { key: 'birth_date', value: p.birth_date ? formatEventDate(p.birth_date) : null },
    { key: 'phone', value: p.phone },
    { key: 'high_school', value: p.high_school },
    { key: 'initial_career_id', value: career?.name ?? null },
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
      {p.pending_conflicts > 0 && (
        <Alert tone="warning">
          Este registro tiene {p.pending_conflicts} conflicto(s) de importación pendientes.{' '}
          {hasRole(staff, 'coordinacion') ? (
            <Link to="/coordinacion/conflictos" className="font-semibold underline">
              Resolver
            </Link>
          ) : (
            'Coordinación debe resolverlos.'
          )}
        </Alert>
      )}

      <AccessStatus participantId={p.id} hasBirthDate={!!p.birth_date} access={p.access} onChanged={reload} />

      <section className="card divide-y divide-line">
        <h2 className="px-5 py-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">Datos del registro</h2>
        {rows.map(({ key, value }) => {
          const override = p.manual_overrides[key];
          return (
            <div key={key} className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_1fr_auto] sm:items-center sm:gap-4">
              <p className="text-sm text-ink-muted">{FIELD_LABELS[key]}</p>
              <p className={`font-semibold ${value ? '' : 'text-ink-muted'}`}>{value ?? 'Sin dato'}</p>
              <p className="text-xs text-ink-muted">
                {override
                  ? `${override.cleared ? 'Borrado' : 'Capturado o corregido'}${override.by ? ` por ${override.by}` : ''} · ${formatDateTime(override.at)}`
                  : key === 'email'
                    ? ''
                    : value
                      ? 'Del registro original'
                      : 'Se completará con Forms si llega el dato'}
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
