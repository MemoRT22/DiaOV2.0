import { useState } from 'react';
import { Alert, Button, Field, Modal, SelectField } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { categoryRules, invalidateWinner, saveCategory, savePrize, type RaffleCategory, type RafflePrize, type RaffleRule } from '../../lib/raffleApi';
import { describeRule, hasRequirement } from '../../lib/raffleRules';

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

export function CategoryModal({ initial, onClose, onSaved }: { initial: Partial<RaffleCategory>; onClose: () => void; onSaved: () => void }) {
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

export function PrizeModal({ initial, categories, onClose, onSaved }: { initial: Partial<RafflePrize>; categories: RaffleCategory[]; onClose: () => void; onSaved: () => void }) {
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

/** What the dialog needs to name the result it invalidates; both the history rows and the draw screen provide it. */
export type InvalidatableWinner = { id: string; prize_name: string; display_name: string };

export function InvalidateModal({ winner, onClose, onDone }: { winner: InvalidatableWinner; onClose: () => void; onDone: () => void }) {
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
