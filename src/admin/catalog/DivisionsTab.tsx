import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Modal, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchDivisions, type Division } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import PhraseConfirmModal from '../PhraseConfirmModal';
import { DemoCheckbox } from './DemoCheckbox';

/** What deleting a division implies, as computed by the server (`division_delete_preview`). */
export type DivisionDeletePreview = {
  id: string; code: string; name: string; is_demo: boolean;
  careers: number; career_names: string[];
  workshops_deleted: { title: string; status: string; sessions: number; reservations: number; attendances: number }[];
  workshops_kept: number; activities_unlinked: number;
  participants_initial_interest: number; participants_post_event_interest: number;
};

export default function DivisionsTab() {
  const { data, error, loading, reload } = useLoad(fetchDivisions, []);
  const [editing, setEditing] = useState<Partial<Division> | null>(null);
  const [deleting, setDeleting] = useState<DivisionDeletePreview | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const openDelete = async (division: Division) => {
    setOpening(division.id); setActionError(''); setNotice('');
    try { setDeleting(await rpc<DivisionDeletePreview>('division_delete_preview', { p_id: division.id })); }
    catch (cause) { setActionError(friendlyError(cause)); }
    finally { setOpening(null); }
  };

  if (loading && !data) return <Spinner />;
  if (error || !data)
    return (
      <Alert tone="error">
        {friendlyError(error)}{' '}
        <button className="font-semibold underline" onClick={reload}>
          Reintentar
        </button>
      </Alert>
    );

  return (
    <section className="space-y-4">
      {notice && <Alert tone="success">{notice}</Alert>}
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ sort_order: data.length + 1, is_demo: false })}>
          <Plus className="h-4 w-4" aria-hidden />
          Nueva división
        </Button>
      </div>
      <ul className="card divide-y divide-line">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-4 px-5 py-3">
            <span className="w-8 text-sm text-ink-muted">{d.sort_order}</span>
            <div className="flex-1">
              <p className="font-semibold">{d.name}</p>
              <p className="text-xs text-ink-muted">{d.code}</p>
            </div>
            {d.is_demo && <Badge tone="warning">Prueba</Badge>}
            <button onClick={() => setEditing(d)} className="admin-action-link" aria-label={`Editar ${d.name}`}>
              <Pencil className="h-4 w-4" aria-hidden />Editar
            </button>
            <button onClick={() => void openDelete(d)} disabled={!!opening} className="admin-action-link text-fg-error" aria-label={`Eliminar ${d.name}`}>
              <Trash2 className="h-4 w-4" aria-hidden />Eliminar
            </button>
          </li>
        ))}
        {data.length === 0 && <li className="px-5 py-6 text-sm text-ink-muted">Aún no hay divisiones.</li>}
      </ul>
      {deleting && (
        <PhraseConfirmModal title="Eliminar división" phrase="ELIMINAR" confirmLabel="Eliminar definitivamente" danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await rpc('delete_division', { p_id: deleting.id });
            setNotice(`División «${deleting.name}» eliminada.`);
            setDeleting(null);
            reload();
          }}>
          <DeleteSummary preview={deleting} />
        </PhraseConfirmModal>
      )}
      {editing && (
        <DivisionModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The related information affected by deleting a division, before the administrator confirms. */
function DeleteSummary({ preview: d }: { preview: DivisionDeletePreview }) {
  const reservations = d.workshops_deleted.reduce((sum, w) => sum + w.reservations, 0);
  const attendances = d.workshops_deleted.reduce((sum, w) => sum + w.attendances, 0);
  const students = d.participants_initial_interest + d.participants_post_event_interest;
  const nothing = d.careers === 0 && d.workshops_deleted.length === 0 && d.workshops_kept === 0 && d.activities_unlinked === 0 && students === 0;
  return (
    <>
      <p>Vas a eliminar definitivamente la división <strong className="text-ink">{d.name}</strong>. Esta acción no se puede deshacer.</p>
      {nothing ? (
        <p>No tiene carreras, talleres ni intereses de alumnos asociados.</p>
      ) : (
        <ul className="list-disc space-y-2 pl-5" aria-label="Información relacionada que se verá afectada">
          {d.careers > 0 && (
            <li>Se eliminan sus {count(d.careers, 'carrera', 'carreras')}: {d.career_names.join(', ')}.</li>
          )}
          {d.workshops_deleted.length > 0 && (
            <li>
              Se {d.workshops_deleted.length === 1 ? 'elimina 1 taller que solo pertenece' : `eliminan ${d.workshops_deleted.length} talleres que solo pertenecen`} a esta división
              {reservations + attendances > 0 ? `, con ${count(reservations, 'reservación', 'reservaciones')} y ${count(attendances, 'asistencia', 'asistencias')}` : ''}:{' '}
              {d.workshops_deleted.map((w) => w.title).join(', ')}.
            </li>
          )}
          {d.workshops_kept > 0 && (
            <li>{count(d.workshops_kept, 'taller compartido se conserva', 'talleres compartidos se conservan')} con sus otras divisiones; solo {d.workshops_kept === 1 ? 'pierde' : 'pierden'} las carreras de esta.</li>
          )}
          {d.participants_initial_interest > 0 && (
            <li>{count(d.participants_initial_interest, 'alumno deja', 'alumnos dejan')} de tener como carrera de interés inicial una de esta división.</li>
          )}
          {d.participants_post_event_interest > 0 && (
            <li>{count(d.participants_post_event_interest, 'alumno pierde', 'alumnos pierden')} carreras de esta división entre sus intereses posteriores.</li>
          )}
        </ul>
      )}
      <p>Las demás divisiones, sus carreras y sus talleres no cambian.</p>
    </>
  );
}

function DivisionModal({ initial, onClose, onSaved }: { initial: Partial<Division>; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(initial.code ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [order, setOrder] = useState(String(initial.sort_order ?? 1));
  const [isDemo, setIsDemo] = useState(!!initial.is_demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await rpc('save_division', {
        p: { id: initial.id ?? null, code: code.trim().toUpperCase(), name: name.trim(), sort_order: Number(order) || 0, is_demo: isDemo },
      });
      onSaved();
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  return (
    <Modal title={initial.id ? 'Editar división' : 'Nueva división'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código" hint="Mayúsculas, sin espacios" value={code} onChange={(e) => setCode(e.target.value)} required />
          <Field label="Orden" type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
        {!initial.id && <DemoCheckbox checked={isDemo} onChange={setIsDemo} />}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
