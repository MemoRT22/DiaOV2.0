import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Modal, SelectField, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchCareers, fetchDivisions, type Career, type Division } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { DemoCheckbox } from './DemoCheckbox';

export default function CareersTab() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([fetchDivisions(), fetchCareers(true)]), []);
  const [editing, setEditing] = useState<Partial<Career> | null>(null);

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

  const [divisions, careers] = data;

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setEditing({ is_active: true, division_id: divisions[0]?.id })} disabled={!divisions.length}>
          <Plus className="h-4 w-4" aria-hidden />
          Nueva carrera
        </Button>
      </div>
      {divisions.map((d) => {
        const list = careers.filter((c) => c.division_id === d.id);
        return (
          <div key={d.id} className="card overflow-hidden">
            <h3 className="border-b border-line bg-surface-raised px-5 py-3 text-sm font-semibold">{d.name}</h3>
            {list.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">Sin carreras.</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1">
                      <p className={`font-semibold ${c.is_active ? '' : 'text-ink-muted line-through'}`}>{c.name}</p>
                      <p className="text-xs text-ink-muted">{c.code}</p>
                    </div>
                    {!c.is_active && <Badge tone="neutral">Inactiva</Badge>}
                    {c.is_demo && <Badge tone="warning">Prueba</Badge>}
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink"
                      aria-label={`Editar ${c.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {editing && (
        <CareerModal
          initial={editing}
          divisions={divisions}
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

type ModalProps = { initial: Partial<Career>; divisions: Division[]; onClose: () => void; onSaved: () => void };

function CareerModal({ initial, divisions, onClose, onSaved }: ModalProps) {
  const [code, setCode] = useState(initial.code ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [divisionId, setDivisionId] = useState(initial.division_id ?? '');
  const [active, setActive] = useState(initial.is_active ?? true);
  const [isDemo, setIsDemo] = useState(!!initial.is_demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await rpc('save_career', {
        p: { id: initial.id ?? null, code: code.trim().toUpperCase(), name: name.trim(), division_id: divisionId, is_active: active, is_demo: isDemo },
      });
      onSaved();
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  return (
    <Modal title={initial.id ? 'Editar carrera' : 'Nueva carrera'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="Código" hint="Mayúsculas, sin espacios. Se usa en la importación de Forms." value={code} onChange={(e) => setCode(e.target.value)} required />
        <SelectField label="División" value={divisionId} onChange={(e) => setDivisionId(e.target.value)} required>
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary-500" />
          <span>
            Activa
            <span className="block text-xs text-ink-muted">Las carreras inactivas no se ofrecen a los aspirantes, pero se conservan en los registros.</span>
          </span>
        </label>
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
