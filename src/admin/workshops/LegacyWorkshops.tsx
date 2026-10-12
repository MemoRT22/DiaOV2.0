import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge } from '../../components/ui';
import { formatEventDateTime, formatEventTime } from '../../lib/eventTime';
import { useLoad } from '../../lib/useLoad';
import { CATEGORY_LABELS, TYPE_LABELS, workshopAdminApi, type LegacyWorkshop, type WorkshopType } from '../../lib/workshopAdminApi';
import PhraseConfirmModal from '../PhraseConfirmModal';
import WorkshopDeleteSummary from './WorkshopDeleteSummary';

const LEGACY_TYPE_LABELS: Record<string, string> = { ...TYPE_LABELS, liderazgo: 'Liderazgo (tipo anterior)' };
const SESSION_STATUS: Record<string, string> = { activa: 'Disponible', oculta: 'Oculto', cancelada: 'Cancelado' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Workshops that exist only as an activity, without a file («expediente»): test data created before the unified
 * workshop flow. They are live for students, so Coordinación must be able to see them and delete them one by one.
 * They are not given an artificial file: they are managed through the activity itself.
 */
export default function LegacyWorkshops({ type, search }: { type: WorkshopType | ''; search: string }) {
  const { data, reload } = useLoad(() => workshopAdminApi.listLegacy(), []);
  const [deleting, setDeleting] = useState<LegacyWorkshop | null>(null);
  const [notice, setNotice] = useState('');

  // A backend that does not know this list yet (or a failed request) simply shows no section: the inbox is unaffected.
  const all = data ?? [];
  const needle = fold(search.trim());
  const items = all.filter((w) => (!type || w.activity_type === type) && (!needle || fold(w.title).includes(needle)));
  if (all.length === 0 && !notice) return null;

  return (
    <section className="space-y-3" aria-label="Talleres sin expediente">
      <div>
        <h2 className="text-lg font-bold">Talleres sin expediente</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Datos de prueba creados antes del flujo de propuestas. Están visibles para los alumnos de su modo; puedes consultarlos y eliminarlos uno por uno.
        </p>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {all.length > 0 && items.length === 0 && <p className="card p-4 text-sm text-ink-muted">Ninguno coincide con la búsqueda o el tipo elegidos.</p>}
      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((w) => (
            <li key={w.activity_id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    {LEGACY_TYPE_LABELS[w.activity_type] ?? w.activity_type}
                    {w.experience_category ? ` · ${CATEGORY_LABELS[w.experience_category] ?? w.experience_category}` : ''}
                  </p>
                  <h3 className="text-base font-bold leading-snug">{w.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {[w.division_names.join(', ') || 'Sin división', w.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {w.is_demo && <Badge tone="warning">Prueba</Badge>}
                  <Badge tone="neutral">Sin expediente</Badge>
                </div>
              </div>
              <p className="mt-3 text-sm">
                {plural(w.dependents.sessions, 'horario', 'horarios')} · {plural(w.dependents.reservations, 'reservación', 'reservaciones')} · {plural(w.dependents.attendances, 'asistencia', 'asistencias')}
              </p>
              {w.sessions.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-semibold text-fg-info">Ver horarios</summary>
                  <ul className="mt-2 space-y-1 text-ink-muted">
                    {w.sessions.map((s) => (
                      <li key={s.id}>
                        {formatEventDateTime(s.starts_at)} – {formatEventTime(s.ends_at)} · Cupo {s.capacity} · Reservados {s.reserved} · {SESSION_STATUS[s.status] ?? s.status}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-3 flex justify-end border-t border-line pt-3">
                <button type="button" className="admin-action-link text-fg-error" onClick={() => { setNotice(''); setDeleting(w); }} aria-label={`Eliminar taller ${w.title}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <PhraseConfirmModal title="Eliminar taller" phrase="ELIMINAR" confirmLabel="Eliminar definitivamente" danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await workshopAdminApi.removeLegacy(deleting.activity_id);
            setNotice(`Taller «${deleting.title}» eliminado.`);
            setDeleting(null);
            reload();
          }}>
          <WorkshopDeleteSummary title={deleting.title} published dependents={deleting.dependents} />
        </PhraseConfirmModal>
      )}
    </section>
  );
}
