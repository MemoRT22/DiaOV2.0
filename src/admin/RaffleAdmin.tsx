import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, LoadError, Modal, SelectField, Spinner } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { useEdition } from '../edition/EditionProvider';
import {
  categoryRules, fetchOperatorView, fetchPrizes, fetchWinners,
  invalidateWinner, saveCategory, savePrize,
  type OperatorView, type RaffleCategory, type RafflePrize, type RaffleRule, type RaffleWinner, type UnassignedCombo,
} from '../lib/raffleApi';
import { describeRule, describeRules, hasRequirement } from '../lib/raffleRules';
import { useLoad } from '../lib/useLoad';
import { DataPanel, EmptyState, PageHeader, RowAction, ScopeSwitch, SectionHeading, SectionTabs } from './design/Primitives';

type Tab = 'categories' | 'prizes' | 'winners';

export default function RaffleAdmin() {
  const { edition } = useEdition();
  const [tab, setTab] = useState<Tab>('categories');
  const [scope, setScope] = useState<'real' | 'demo'>('real');
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
    if (data) { setCategories(data.categories); if (!selectedCat && data.categories.length) setSelectedCat(data.categories.find((category) => !category.is_demo)?.id ?? data.categories[0].id); }
  }, [data]);

  useEffect(() => {
    if (!selectedCat) { setPrizes([]); return; }
    let cancelled = false;
    setPrizesLoading(true);
    setPrizes([]);
    fetchPrizes(selectedCat).then((items) => { if (!cancelled) setPrizes(items); })
      .catch((cause) => { if (!cancelled) setActionError(friendlyError(cause)); })
      .finally(() => { if (!cancelled) setPrizesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCat]);

  const loadWinners = () => { setWinnersLoading(true); fetchWinners().then(setWinners).catch((e) => setActionError(friendlyError(e))).finally(() => setWinnersLoading(false)); };
  useEffect(() => { if (tab === 'winners') loadWinners(); }, [tab]);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <LoadError error={error} onRetry={reload} />;

  const opView = data as OperatorView;
  const unassigned = opView.unassigned_combinations as UnassignedCombo[];
  const unassignedScope = edition?.mode === 'preparacion' ? 'demo' : 'real';
  const visibleCategories = categories.filter((category) => category.is_demo === (scope === 'demo'));
  const activeCategory = visibleCategories.find((category) => category.id === selectedCat) ?? visibleCategories[0];
  const visiblePrizes = prizes.filter((prize) => prize.category_id === activeCategory?.id);
  const scopedWinners = winners.filter((winner) => visibleCategories.some((category) => category.id === winner.category_id));
  const selectScope = (next: 'real' | 'demo') => {
    setScope(next);
    setSelectedCat(categories.find((category) => category.is_demo === (next === 'demo'))?.id ?? '');
  };
  const tabs: { value: Tab; label: string }[] = [{ value: 'categories', label: 'Categorías' }, { value: 'prizes', label: 'Premios' }, { value: 'winners', label: 'Ganadores' }];

  return (
    <div className="ad-page">
      <PageHeader eyebrow="Operación / Sorteo" title="Sorteo final"
        description="Configura categorías y premios; consulta después el historial de ganadores."
        action={tab === 'categories' ? <Button onClick={() => setEditingCat({ is_demo: scope === 'demo', is_active: true, sort_order: 0, rules: [{ academic: 1, university_life: 1 }] })}>Nueva categoría</Button>
          : tab === 'prizes' ? <Button onClick={() => setEditingPrize({ category_id: activeCategory?.id, quantity: 1, is_active: true, sort_order: 0 })} disabled={!activeCategory}>Nuevo premio</Button> : undefined} />
      <SectionTabs label="Secciones del sorteo" tabs={tabs} value={tab} onChange={(next) => { setTab(next); setActionError(''); setActionOk(''); }} />
      <div className="ad-context-bar">
        <div><p className="ad-context-label">Entorno de datos</p><p className="ad-context-help">Categorías y resultados de {scope === 'real' ? 'la edición real' : 'prueba'}</p></div>
        <ScopeSwitch label="Entorno del sorteo" value={scope} onChange={selectScope}
          options={[{ value: 'real', label: 'Datos reales' }, { value: 'demo', label: 'Datos de prueba' }]} />
      </div>
      {actionError && <Alert tone="error">{actionError}</Alert>}
      {actionOk && <Alert tone="success">{actionOk}</Alert>}
      {tab === 'categories' && (
        <section className="ad-page">
          <SectionHeading title={`${visibleCategories.length} ${visibleCategories.length === 1 ? 'categoría' : 'categorías'}`}
            detail="Se asigna la categoría más alta cuyos requisitos de sellos cumple cada participante." />
          <DataPanel>
            {visibleCategories.map((category) => <div key={category.id} className="ad-data-row">
              <div className="ad-row-main"><p className="ad-row-title">{category.name} {!category.is_active && <Badge tone="neutral">Inactiva</Badge>}</p>
                <p className="ad-row-meta">{describeRules(categoryRules(category))}</p></div>
              <div className="ad-metric"><strong>{category.pool_count ?? '—'}</strong><span>candidatos</span></div>
              <RowAction onClick={() => setEditingCat(category)}>Editar</RowAction>
            </div>)}
            {visibleCategories.length === 0 && <EmptyState title={`Sin categorías ${scope === 'demo' ? 'de prueba' : 'reales'}.`}
              description="Crea una categoría para definir los sellos necesarios y empezar a organizar el sorteo." />}
          </DataPanel>
          {scope === unassignedScope && unassigned.length > 0 && (
            <details className="ad-inline-note"><summary>Sellos que todavía no alcanzan una categoría · {unassigned.reduce((sum, combo) => sum + combo.count, 0)} participantes</summary>
              <p>Estos participantes ya tienen sellos, pero no cumplen ninguna categoría activa. Revisa la combinación antes de ajustar las reglas.</p>
              <ul>{unassigned.map((combo, index) => <li key={index}>{combo.academic} {combo.academic === 1 ? 'académico' : 'académicos'} + {combo.university_life} de Vida Universitaria · {combo.count} participantes</li>)}</ul>
            </details>
          )}
        </section>
      )}
      {tab === 'prizes' && (
        <section className="ad-page">
          <div className="ad-context-bar"><label className="ad-category-filter"><span>Categoría</span>
            <select className="ad-select" value={activeCategory?.id ?? ''} onChange={(event) => setSelectedCat(event.target.value)} disabled={visibleCategories.length === 0}>
              {visibleCategories.length === 0 && <option value="">Sin categorías</option>}
              {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <span className="ad-context-help">{activeCategory ? describeRules(categoryRules(activeCategory)) : 'Crea primero una categoría.'}</span>
          </div>
          <SectionHeading title={activeCategory ? `Premios de ${activeCategory.name}` : 'Premios'}
            detail={activeCategory ? `${visiblePrizes.length} premios configurados · ${visiblePrizes.reduce((sum, prize) => sum + prize.available, 0)} unidades disponibles` : undefined} />
          {prizesLoading ? <Spinner /> : (
            <DataPanel>
              {visiblePrizes.map((p) => (
                <div key={p.id} className="ad-data-row">
                  <div className="ad-row-main"><p className="ad-row-title">{p.name} {!p.is_active && <Badge tone="neutral">Inactivo</Badge>}</p>
                    <p className="ad-row-meta">{p.description || `${p.delivered} de ${p.quantity} entregados`}</p></div>
                  <div className="ad-metric"><strong>{p.available} / {p.quantity}</strong><span>disponibles</span></div>
                  <RowAction onClick={() => setEditingPrize(p)}>Editar</RowAction>
                </div>
              ))}
              {visiblePrizes.length === 0 && <EmptyState title="Sin premios en esta categoría." description="Agrega un premio para configurar su cantidad disponible." />}
            </DataPanel>
          )}
        </section>
      )}
      {tab === 'winners' && (
        <section className="ad-page">
          <SectionHeading title="Historial de ganadores" detail={`Resultados de ${scope === 'demo' ? 'prueba' : 'la edición real'}`} />
          {winnersLoading ? <Spinner /> : (
            <DataPanel>
              {scopedWinners.map((w) => (
                <div key={w.id} className="ad-data-row">
                  <div className="ad-row-main"><p className="ad-row-title">{w.display_name}</p>
                    <p className="ad-row-meta">{w.prize_name} · {w.category_name} · {new Date(w.drawn_at).toLocaleString('es-MX')}{w.invalidation_reason && ` · invalidado: ${w.invalidation_reason}`}</p></div>
                  <Badge tone={w.status === 'confirmado' ? 'success' : w.status === 'invalidado' ? 'error' : w.status === 'no_presentado' ? 'neutral' : 'warning'}>{w.status}</Badge>
                  {w.status === 'confirmado' && <RowAction danger onClick={() => { setInvalidating(w); setActionError(''); }}>Invalidar</RowAction>}
                </div>
              ))}
              {scopedWinners.length === 0 && <EmptyState title="Sin ganadores registrados." description="Cuando se confirmen resultados, aparecerán aquí." />}
            </DataPanel>
          )}
        </section>
      )}
      {editingCat && <CategoryModal initial={editingCat} onClose={() => setEditingCat(null)} onSaved={() => { setEditingCat(null); reload(); setActionOk('Categoría guardada.'); }} />}
      {editingPrize && <PrizeModal initial={editingPrize} categories={visibleCategories} onClose={() => setEditingPrize(null)} onSaved={() => { setEditingPrize(null); if (selectedCat) fetchPrizes(selectedCat).then(setPrizes).catch(() => {}); setActionOk('Premio guardado.'); }} />}
      {invalidating && <InvalidateModal winner={invalidating} onClose={() => setInvalidating(null)} onDone={() => { setInvalidating(null); loadWinners(); setActionOk('Ganador invalidado. El inventario fue restaurado.'); }} />}
    </div>
  );
}

type RuleDraft = { academic: string; university_life: string; total: string };

const toDraft = (rule: RaffleRule): RuleDraft => ({
  academic: rule.academic ? String(rule.academic) : '', university_life: rule.university_life ? String(rule.university_life) : '', total: rule.total ? String(rule.total) : '',
});

const EMPTY_DRAFT: RuleDraft = { academic: '', university_life: '', total: '' };

/**
 * Why this alternative cannot be saved, or null. The server is the authority (it rejects the same cases); this only
 * prevents the mistake and explains it: every alternative must ask for at least one stamp.
 */
const draftError = (draft: RuleDraft): string | null => {
  const values = [draft.academic, draft.university_life, draft.total].map((v) => v.trim()).filter((v) => v !== '');
  if (values.some((v) => !/^\d{1,3}$/.test(v))) return 'Usa números enteros entre 0 y 999.';
  if (!hasRequirement(fromDraft(draft))) {
    return 'Esta alternativa no pide ningún sello: dejaría entrar al sorteo a quien no tiene sellos. Indica al menos un mínimo mayor que cero o quítala.';
  }
  return null;
};

/** Empty or zero fields are simply not part of the alternative. */
const fromDraft = (draft: RuleDraft): RaffleRule => {
  const rule: RaffleRule = {};
  const academic = Math.trunc(Number(draft.academic) || 0);
  const universityLife = Math.trunc(Number(draft.university_life) || 0);
  const total = Math.trunc(Number(draft.total) || 0);
  if (academic > 0) rule.academic = academic;
  if (universityLife > 0) rule.university_life = universityLife;
  if (total > 0) rule.total = total;
  return rule;
};

function CategoryModal({ initial, onClose, onSaved }: { initial: Partial<RaffleCategory>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order ?? 0));
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    categoryRules({ rules: initial.rules ?? [], required_academic: initial.required_academic ?? 0, required_leadership: initial.required_leadership ?? 0 }).map(toDraft));
  const [active, setActive] = useState(initial.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setRule = (index: number, patch: Partial<RuleDraft>) => setRules((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const ruleErrors = rules.map(draftError);
  const invalid = ruleErrors.some(Boolean);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    setBusy(true); setError('');
    try { await saveCategory({ id: initial.id, name: name.trim(), sort_order: Number(sortOrder), rules: rules.map(fromDraft), is_active: active, is_demo: initial.is_demo }); onSaved(); }
    catch (cause) { setError(friendlyError(cause)); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? 'Editar categoría' : initial.is_demo ? 'Nueva categoría de prueba' : 'Nueva categoría'} onClose={onClose}>
      <form onSubmit={submit} className="ad-modal-form space-y-4">
        <div className="grid grid-cols-[1fr,7rem] gap-4">
          <Field label="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
          <Field label="Orden" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} hint="Mayor = más alta" />
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Cómo se alcanza</legend>
          <p className="text-xs text-ink-muted">Sellos mínimos. Si hay varias alternativas, basta con cumplir una. Cada alternativa debe pedir al menos un sello; deja vacío lo que no aplique.</p>
          {rules.map((rule, i) => (
            <div key={i} role="group" aria-label={`Alternativa ${i + 1}`} className={`rounded-theme border p-3 ${ruleErrors[i] ? 'border-error-500/60' : 'border-line'}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{i === 0 ? 'Alternativa 1' : `o alternativa ${i + 1}`} · {describeRule(fromDraft(rule))}</p>
                {rules.length > 1 && (
                  <button type="button" onClick={() => setRules((list) => list.filter((_, j) => j !== i))} className="text-xs font-semibold text-fg-error">Quitar</button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Académicos" type="number" min={0} max={999} value={rule.academic} onChange={(e) => setRule(i, { academic: e.target.value })} />
                <Field label="Vida Universitaria" type="number" min={0} max={999} value={rule.university_life} onChange={(e) => setRule(i, { university_life: e.target.value })} />
                <Field label="Total" type="number" min={0} max={999} value={rule.total} onChange={(e) => setRule(i, { total: e.target.value })} />
              </div>
              {ruleErrors[i] && <p role="alert" className="mt-2 text-xs font-semibold text-fg-error">{ruleErrors[i]}</p>}
            </div>
          ))}
          {rules.length < 10 && (
            <Button type="button" variant="ghost" onClick={() => setRules((list) => [...list, { ...EMPTY_DRAFT }])}>Agregar alternativa</Button>
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Categoría activa</label>
        {error && <Alert tone="error">{error}</Alert>}
        {invalid && <p className="text-right text-xs text-ink-muted">Completa o quita las alternativas marcadas para poder guardar.</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy} disabled={invalid}>Guardar</Button></div>
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
      <form onSubmit={submit} className="ad-modal-form space-y-4">
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
      <form onSubmit={submit} className="ad-modal-form space-y-4">
        <Alert tone="warning">Vas a invalidar el premio <strong>{winner.prize_name}</strong> de <strong>{winner.display_name}</strong>. El inventario se restaurará y el participante volverá al pool. Esta acción queda registrada en auditoría y no se puede deshacer.</Alert>
        <Field label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" variant="secondary" loading={busy}>Invalidar</Button></div>
      </form>
    </Modal>
  );
}
