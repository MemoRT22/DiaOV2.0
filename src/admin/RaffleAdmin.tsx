import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, LoadError, Modal, SelectField, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import {
  fetchOperatorView, fetchPrizes, fetchWinners,
  invalidateWinner, saveCategory, savePrize,
  type OperatorView, type RaffleCategory, type RafflePrize, type RaffleWinner, type UnassignedCombo,
} from '../lib/raffleApi';
import { useLoad } from '../lib/useLoad';

type Tab = 'categories' | 'prizes' | 'winners';

export default function RaffleAdmin() {
  const [tab, setTab] = useState<Tab>('categories');
  const { data, error, loading, reload } = useLoad(fetchOperatorView, []);
  const [categories, setCategories] = useState<RaffleCategory[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('');
  const [prizes, setPrizes] = useState<RafflePrize[]>([]);
  const [prizesLoading, setPrizesLoading] = useState(false);
  const [winners, setWinners] = useState<RaffleWinner[]>([]);
  const [winnersLoading, setWinnersLoading] = useState(false);
  const [editingCat, setEditingCat] = useState<Partial<RaffleCategory> | null>(null);
  const [editingPrize, setEditingPrize] = useState<Partial<RafflePrize> | null>(null);
  const [invalidating, setInvalidating] = useState<RaffleWinner | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionOk, setActionOk] = useState('');

  useEffect(() => {
    if (data) { setCategories(data.categories); if (!selectedCat && data.categories.length) setSelectedCat(data.categories[0].id); }
  }, [data]);

  useEffect(() => {
    if (!selectedCat) return;
    setPrizesLoading(true);
    fetchPrizes(selectedCat).then(setPrizes).catch((e) => setActionError(friendlyError(e))).finally(() => setPrizesLoading(false));
  }, [selectedCat]);

  const loadWinners = () => { setWinnersLoading(true); fetchWinners().then(setWinners).catch((e) => setActionError(friendlyError(e))).finally(() => setWinnersLoading(false)); };
  useEffect(() => { if (tab === 'winners') loadWinners(); }, [tab]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const opView = data as OperatorView;
  const unassigned = opView.unassigned_combinations as UnassignedCombo[];
  const catBadge = (c: RaffleCategory) => (<>{c.is_demo && <Badge tone="warning">Prueba</Badge>}{!c.is_active && <Badge tone="neutral">Inactiva</Badge>}</>);
  const tabs: { key: Tab; label: string }[] = [{ key: 'categories', label: 'Categorías' }, { key: 'prizes', label: 'Premios' }, { key: 'winners', label: 'Ganadores' }];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Sorteo final</h1>
        <p className="mt-1 text-sm text-ink-muted">Configura las categorías del sorteo, los premios por categoría y revisa el historial de ganadores.</p>
      </header>
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setActionError(''); setActionOk(''); }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab === t.key ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted hover:text-ink'}`}>{t.label}</button>
        ))}
      </div>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {actionOk && <Alert tone="success">{actionOk}</Alert>}
      {tab === 'categories' && (
        <section className="space-y-4">
          <div className="flex justify-end"><Button variant="secondary" onClick={() => setEditingCat({ is_active: true, sort_order: 0, required_academic: 0, required_leadership: 0 })}>Nueva categoría</Button></div>
          {unassigned.length > 0 && (
            <div className="card border-warning-500/40 p-4">
              <p className="text-sm font-semibold">Combinaciones de tickets sin categoría</p>
              <p className="mt-1 text-xs text-ink-muted">Estos participantes cumplen asistencias pero no encajan en ninguna categoría configurada.</p>
              <ul className="mt-3 space-y-1">{unassigned.map((c, i) => (<li key={i} className="text-sm"><span className="font-semibold">{c.academic} académicos + {c.leadership} liderazgo</span><span className="text-ink-muted"> · {c.count} participante{c.count !== 1 ? 's' : ''}</span></li>))}</ul>
            </div>
          )}
          <div className="card divide-y divide-line">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-4">
                <div className="flex-1">
                  <p className="font-semibold">{c.name} {catBadge(c)}</p>
                  <p className="text-sm text-ink-muted">{c.required_academic} académicos + {c.required_leadership} liderazgo{(c as RaffleCategory & { pool_count?: number }).pool_count !== undefined && (<> · {(c as RaffleCategory & { pool_count?: number }).pool_count} candidatos</>)}</p>
                </div>
                <button onClick={() => setEditingCat(c)} className="text-sm font-semibold text-secondary-300 hover:text-ink">Editar</button>
              </div>
            ))}
            {categories.length === 0 && <p className="p-4 text-sm text-ink-muted">Sin categorías configuradas.</p>}
          </div>
        </section>
      )}
      {tab === 'prizes' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((c) => (<button key={c.id} onClick={() => setSelectedCat(c.id)} className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${selectedCat === c.id ? 'bg-primary-500 text-on-primary' : 'border border-line text-ink-muted hover:text-ink'}`}>{c.name}</button>))}
          </div>
          <div className="flex justify-end"><Button variant="secondary" onClick={() => setEditingPrize({ category_id: selectedCat, quantity: 1, is_active: true, sort_order: 0 })} disabled={!selectedCat}>Nuevo premio</Button></div>
          {prizesLoading ? <Spinner /> : (
            <div className="card divide-y divide-line">
              {prizes.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <p className="font-semibold">{p.name} {!p.is_active && <Badge tone="neutral">Inactivo</Badge>}</p>
                    <p className="text-sm text-ink-muted">{p.delivered} de {p.quantity} entregados · {p.available} disponibles</p>
                    {p.description && <p className="mt-1 text-xs text-ink-muted">{p.description}</p>}
                  </div>
                  <button onClick={() => setEditingPrize(p)} className="text-sm font-semibold text-secondary-300 hover:text-ink">Editar</button>
                </div>
              ))}
              {prizes.length === 0 && <p className="p-4 text-sm text-ink-muted">Sin premios en esta categoría.</p>}
            </div>
          )}
        </section>
      )}
      {tab === 'winners' && (
        <section className="space-y-4">
          {winnersLoading ? <Spinner /> : (
            <div className="card divide-y divide-line">
              {winners.map((w) => (
                <div key={w.id} className="flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <p className="font-semibold">{w.display_name}</p>
                    <p className="text-sm text-ink-muted">{w.prize_name} · {w.category_name}</p>
                    <p className="text-xs text-ink-muted">{new Date(w.drawn_at).toLocaleString('es-MX')}{w.confirmed_at && ' · confirmado'}{w.invalidation_reason && ` · invalidado: ${w.invalidation_reason}`}</p>
                  </div>
                  <Badge tone={w.status === 'confirmado' ? 'success' : w.status === 'invalidado' ? 'error' : w.status === 'no_presentado' ? 'neutral' : 'warning'}>{w.status}</Badge>
                  {w.status === 'confirmado' && <button onClick={() => { setInvalidating(w); setActionError(''); }} className="text-sm font-semibold text-error-300 hover:text-error-200">Invalidar</button>}
                </div>
              ))}
              {winners.length === 0 && <p className="p-4 text-sm text-ink-muted">Sin ganadores registrados.</p>}
            </div>
          )}
        </section>
      )}
      {editingCat && <CategoryModal initial={editingCat} onClose={() => setEditingCat(null)} onSaved={() => { setEditingCat(null); reload(); setActionOk('Categoría guardada.'); }} />}
      {editingPrize && <PrizeModal initial={editingPrize} categories={categories} onClose={() => setEditingPrize(null)} onSaved={() => { setEditingPrize(null); if (selectedCat) fetchPrizes(selectedCat).then(setPrizes).catch(() => {}); setActionOk('Premio guardado.'); }} />}
      {invalidating && <InvalidateModal winner={invalidating} onClose={() => setInvalidating(null)} onDone={() => { setInvalidating(null); loadWinners(); setActionOk('Ganador invalidado. El inventario fue restaurado.'); }} />}
    </div>
  );
}

function CategoryModal({ initial, onClose, onSaved }: { initial: Partial<RaffleCategory>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order ?? 0));
  const [reqA, setReqA] = useState(String(initial.required_academic ?? 0));
  const [reqL, setReqL] = useState(String(initial.required_leadership ?? 0));
  const [active, setActive] = useState(initial.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await saveCategory({ id: initial.id, name: name.trim(), sort_order: Number(sortOrder), required_academic: Number(reqA), required_leadership: Number(reqL), is_active: active }); onSaved(); }
    catch (cause) { setError(friendlyError(cause)); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-3 gap-4">
          <Field label="Orden" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} hint="Mayor = más alto" />
          <Field label="Tickets académicos" type="number" min={0} value={reqA} onChange={(e) => setReqA(e.target.value)} required />
          <Field label="Tickets liderazgo" type="number" min={0} value={reqL} onChange={(e) => setReqL(e.target.value)} required />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Categoría activa</label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

function PrizeModal({ initial, categories, onClose, onSaved }: { initial: Partial<RafflePrize>; categories: RaffleCategory[]; onClose: () => void; onSaved: () => void }) {
  const [catId, setCatId] = useState(initial.category_id ?? categories[0]?.id ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [desc, setDesc] = useState(initial.description ?? '');
  const [qty, setQty] = useState(String(initial.quantity ?? 1));
  const [active, setActive] = useState(initial.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await savePrize({ id: initial.id, category_id: catId, name: name.trim(), description: desc.trim(), quantity: Number(qty), is_active: active, sort_order: Number(sortOrder) }); onSaved(); }
    catch (cause) { setError(friendlyError(cause)); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? 'Editar premio' : 'Nuevo premio'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <SelectField label="Categoría" value={catId} onChange={(e) => setCatId(e.target.value)} required>{categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</SelectField>
        <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="grid grid-cols-2 gap-4"><Field label="Cantidad" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} required /><Field label="Orden" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Premio activo</label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

function InvalidateModal({ winner, onClose, onDone }: { winner: RaffleWinner; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await invalidateWinner(winner.id, reason.trim()); onDone(); }
    catch (cause) { setError(friendlyError(cause)); setBusy(false); }
  };
  return (
    <Modal title="Invalidar ganador" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert tone="warning">Vas a invalidar el premio <strong>{winner.prize_name}</strong> de <strong>{winner.display_name}</strong>. El inventario se restaurará y el participante volverá al pool. Esta acción queda registrada en auditoría y no se puede deshacer.</Alert>
        <Field label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="secondary" loading={busy}>Invalidar</Button></div>
      </form>
    </Modal>
  );
}
