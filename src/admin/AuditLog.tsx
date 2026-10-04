import { Link } from 'react-router-dom';
import { Alert, Button, Spinner } from '../components/ui';
import { FIELD_LABELS, ROLE_LABELS } from '../lib/adminApi';
import { formatDateTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

type Entry = { id: string; action: string; detail: Record<string, unknown> | null; created_at: string; actor_user_id: string | null };

const ACTIONS: Record<string, string> = {
  'theme.draft_saved': 'Guardó un borrador de la temática',
  'theme.published': 'Publicó una versión de la temática',
  'theme.restored_to_draft': 'Restauró una versión anterior como borrador',
  'theme.emergency_unlock': 'Desbloqueo de emergencia de la temática',
  'theme.relocked': 'Volvió a bloquear la temática',
  'ranks.updated': 'Actualizó las reglas de rangos',
  'demo.purged': 'Retiró los datos de prueba',
  'edition.real_operation_activated': 'Activó la operación real',
  'participant.viewed': 'Consultó el expediente de un participante',
  'participant.created': 'Dio de alta a un participante',
  'participant.updated': 'Corrigió datos de un participante',
  'participant.access_checked': 'Revisó el acceso de un correo',
  'participant.access_unlocked': 'Retiró un bloqueo de acceso',
  'participants.imported': 'Importó participantes',
  'participants.conflict_resolved': 'Resolvió un conflicto de importación',
  'participants.career_mapped': 'Relacionó carreras no reconocidas del padrón',
  'roster.declared_official': 'Declaró el padrón oficial',
  'roster.reopened': 'Reabrió la importación del padrón',
  'participants.exported': 'Exportó participantes a Excel',
  'participants.empty_overrides_cleaned': 'Limpió protecciones manuales vacías',
  'catalog.division_saved': 'Guardó una división',
  'catalog.career_saved': 'Guardó una carrera',
  'catalog.activity_saved': 'Guardó un taller',
  'catalog.activity_deleted': 'Eliminó un taller',
  'catalog.session_saved': 'Guardó un horario',
  'catalog.session_deleted': 'Eliminó un horario',
  'catalog.imported': 'Importó catálogo',
  'staff.created': 'Creó una cuenta del personal',
  'staff.updated': 'Actualizó una cuenta del personal',
  'staff.password_reset': 'Cambió la contraseña de una cuenta del personal',
};

const COUNT_LABELS: Record<string, string> = { new: 'nuevos', update: 'actualizados', conflict: 'con conflicto', error: 'con error' };

const roleList = (v: unknown) => (Array.isArray(v) ? v.map((r) => ROLE_LABELS[String(r)] ?? String(r)).join(', ') : '');

function describe(e: Entry): string | null {
  const d = e.detail ?? {};
  if (typeof d.reason === 'string') return `Motivo: ${d.reason}${typeof d.count === 'number' ? ` · ${d.count} registros` : ''}`;
  if (typeof d.version === 'number') return `Versión ${d.version}`;
  if (typeof d.from_version === 'number') return `Desde la versión ${d.from_version}`;
  if (Array.isArray(d.fields)) return `Campos: ${d.fields.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join(', ') || 'ninguno'}`;
  if (typeof d.field === 'string') return `${FIELD_LABELS[d.field] ?? d.field}: ${d.accepted_import ? 'se usó el dato del archivo' : 'se conservó la corrección'}`;
  if (d.counts && typeof d.counts === 'object') {
    const c = d.counts as Record<string, number>;
    const parts = Object.entries(COUNT_LABELS)
      .filter(([k]) => c[k])
      .map(([k, label]) => `${c[k]} ${label}`);
    const kind = d.kind === 'careers' ? 'Carreras · ' : d.kind === 'workshops' ? 'Talleres · ' : '';
    return `${kind}${parts.join(', ') || 'sin cambios'}`;
  }
  if (typeof d.code === 'string') return `Código ${d.code}`;
  if (e.action.startsWith('staff.') && Array.isArray(d.roles))
    return `Roles: ${roleList(d.roles)}${d.is_active === false ? ' · desactivada' : ''}`;
  if (d.found === false) return 'Correo sin registro';
  return null;
}

export default function AuditLog() {
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase
      .from('audit_log')
      .select('id, action, detail, created_at, actor_user_id')
      .order('created_at', { ascending: false })
      .limit(200);
    if (e) throw e;
    const entries = (rows ?? []) as Entry[];
    const ids = [...new Set(entries.map((r) => r.actor_user_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: staff, error: se } = await supabase.from('staff_members').select('user_id, full_name').in('user_id', ids);
      if (se) throw se;
      for (const s of staff ?? []) names.set(s.user_id, s.full_name);
    }
    return entries.map((r) => ({ ...r, actor: (r.actor_user_id && names.get(r.actor_user_id)) || 'Cuenta no disponible' }));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Auditoría</h1>
          <p className="mt-1 text-sm text-ink-muted">Las últimas 200 acciones protegidas, de la más reciente a la más antigua.</p>
        </div>
        <Button variant="secondary" onClick={reload}>
          Actualizar
        </Button>
      </header>

      {error || !data ? (
        <Alert tone="error">{friendlyError(error)}</Alert>
      ) : data.length === 0 ? (
        <Alert>Todavía no hay acciones registradas.</Alert>
      ) : (
        <ol className="card divide-y divide-line">
          {data.map((e) => {
            const extra = describe(e);
            return (
              <li key={e.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div>
                  <p className="text-sm font-semibold">{ACTIONS[e.action] ?? e.action}</p>
                  <p className="text-xs text-ink-muted">{e.actor}</p>
                  {extra && <p className="mt-1 text-xs text-ink-muted">{extra}</p>}
                  {typeof e.detail?.participant_id === 'string' && (
                    <Link to={`/coordinacion/participantes/${e.detail.participant_id}`} className="mt-1 inline-block text-xs font-semibold text-secondary-300 hover:underline">
                      Ver participante
                    </Link>
                  )}
                </div>
                <time className="shrink-0 text-xs text-ink-muted">{formatDateTime(e.created_at)}</time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
