import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Modal, SelectField } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { eventTimestamp, formatTime, SESSION_STATUS_LABELS, type Activity, type Division, type Session, type SessionStatus } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { DemoCheckbox } from './DemoCheckbox';

function useSave(save: () => Promise<unknown>, onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await save();
      onSaved();
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function Footer({ busy, error, onClose }: { busy: boolean; error: string; onClose: () => void }) {
  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={busy}>
          Guardar
        </Button>
      </div>
    </>
  );
}

type ActivityProps = { initial: Partial<Activity>; divisions: Division[]; onClose: () => void; onSaved: () => void };

export function ActivityModal({ initial, divisions, onClose, onSaved }: ActivityProps) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [location, setLocation] = useState(initial.location ?? '');
  const [divisionId, setDivisionId] = useState(initial.division_id ?? '');
  const [isDemo, setIsDemo] = useState(!!initial.is_demo);
  const { busy, error, submit } = useSave(
    () =>
      rpc('save_activity', {
        p: { id: initial.id ?? null, title: title.trim(), description: description.trim(), location: location.trim(), division_id: divisionId, is_demo: isDemo },
      }),
    onSaved,
  );

  return (
    <Modal title={initial.id ? 'Editar taller' : 'Nuevo taller'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <SelectField label="División" value={divisionId} onChange={(e) => setDivisionId(e.target.value)} required>
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <Field label="Ubicación" placeholder="Ej. Edificio B, aula 204" value={location} onChange={(e) => setLocation(e.target.value)} />
        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Descripción</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-theme border border-line bg-surface-raised px-4 py-3 text-base text-ink focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30"
          />
        </label>
        {!initial.id && <DemoCheckbox checked={isDemo} onChange={setIsDemo} />}
        <Footer busy={busy} error={error} onClose={onClose} />
      </form>
    </Modal>
  );
}

type SessionProps = { initial: Partial<Session>; activityLocation: string; eventDate: string; onClose: () => void; onSaved: () => void };

export function SessionModal({ initial, activityLocation, eventDate, onClose, onSaved }: SessionProps) {
  const [location, setLocation] = useState(initial.location ?? '');
  const [status, setStatus] = useState<SessionStatus>(initial.status ?? 'activa');
  const [start, setStart] = useState(initial.starts_at ? formatTime(initial.starts_at) : '10:00');
  const [end, setEnd] = useState(initial.ends_at ? formatTime(initial.ends_at) : '10:45');
  const [capacity, setCapacity] = useState(String(initial.capacity ?? 30));
  const { busy, error, submit } = useSave(
    () =>
      rpc('save_session', {
        p: {
          id: initial.id ?? null,
          activity_id: initial.activity_id,
          starts_at: eventTimestamp(eventDate, start),
          ends_at: eventTimestamp(eventDate, end),
          capacity: Number(capacity),
          location: location.trim(),
          status,
        },
      }),
    onSaved,
  );

  return (
    <Modal title={initial.id ? 'Editar horario' : 'Nuevo horario'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">El horario se registra para el día del evento, en hora de Cancún.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Inicio" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          <Field label="Fin" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <Field label="Cupo" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        <Field
          label="Ubicación de este horario"
          placeholder={activityLocation || 'Ej. Edificio B, aula 204'}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          hint="Si lo dejas vacío se usa la ubicación del taller."
        />
        <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value as SessionStatus)}>
          {(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((s) => (
            <option key={s} value={s}>
              {SESSION_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <p className="text-xs text-ink-muted">Solo los horarios publicados son visibles para los aspirantes.</p>
        <Footer busy={busy} error={error} onClose={onClose} />
      </form>
    </Modal>
  );
}
