import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Modal, Spinner } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { fetchDivisions, type Division } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { DemoCheckbox } from './DemoCheckbox';

export default function DivisionsTab() {
  const { data, error, loading, reload } = useLoad(fetchDivisions, []);
  const [editing, setEditing] = useState<Partial<Division> | null>(null);

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
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setEditing({ sort_order: data.length + 1, is_demo: false })}>
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
            <button onClick={() => setEditing(d)} className="rounded-full p-2 text-ink-muted hover:bg-surface-raised hover:text-ink" aria-label={`Editar ${d.name}`}>
              <Pencil className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
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
