import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Modal, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchHighSchools, type HighSchool } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { fold } from '../../lib/csv';
import { useLoad } from '../../lib/useLoad';

export default function HighSchoolsTab() {
  const { data, error, loading, reload } = useLoad(() => fetchHighSchools(true), []);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<HighSchool> | null>(null);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert tone="error">{friendlyError(error)} <button className="underline" onClick={reload}>Reintentar</button></Alert>;
  const filtered = data.filter((school) => fold(school.name).includes(fold(search)));
  const active = data.filter((school) => school.is_active).length;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">{active} activas</p>
        <p className="text-xs text-ink-muted">Las inactivas siguen visibles en los expedientes históricos.</p>
      </div>
      <Button variant="secondary" onClick={() => setEditing({ is_active: true })}><Plus className="h-4 w-4" aria-hidden /> Nueva preparatoria</Button>
    </div>
    <Field label="Buscar preparatorias" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o plantel" />
    <ul className="card max-h-[36rem] divide-y divide-line overflow-y-auto">
      {filtered.map((school) => <li key={school.id} className="flex items-center gap-3 px-5 py-3">
        <span className={`flex-1 text-sm font-semibold ${school.is_active ? '' : 'text-ink-muted line-through'}`}>{school.name}</span>
        {!school.is_active && <Badge tone="neutral">Inactiva</Badge>}
        <button type="button" onClick={() => setEditing(school)} aria-label={`Editar ${school.name}`} className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
          <Pencil className="h-4 w-4" />
        </button>
      </li>)}
      {!filtered.length && <li className="p-5 text-sm text-ink-muted">Sin coincidencias.</li>}
    </ul>
    {editing && <HighSchoolModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
  </section>;
}

function HighSchoolModal({ initial, onClose, onSaved }: { initial: Partial<HighSchool>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [active, setActive] = useState(initial.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await rpc('save_high_school', { p: { id: initial.id ?? null, name: name.trim(), is_active: active } });
      onSaved();
    } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); }
  };
  return <Modal title={initial.id ? 'Editar preparatoria' : 'Nueva preparatoria'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nombre" required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-5 w-5 accent-primary-500" /> Activa</label>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Guardar</Button></div>
    </form>
  </Modal>;
}
