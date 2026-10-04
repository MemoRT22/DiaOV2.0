import { ArrowDown, ArrowUp, Check, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, LoadError, PageSkeleton } from '../components/ui';
import { fetchCareers, fetchDivisions, fetchMyInterests, fetchProgress } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';

const MAX = 3;

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function Interests() {
  const { theme, text } = useTheme();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchCareers(), fetchDivisions(), fetchMyInterests(), fetchProgress()]),
    [],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (data) {
      setSelected(data[2]);
      setSaved(data[2]);
    }
  }, [data]);

  const [careers, divisions, , progress] = data ?? [[], [], [], null];
  const careerById = useMemo(() => new Map(careers.map((c) => [c.id, c])), [careers]);
  const groups = useMemo(() => {
    const q = normalize(query.trim());
    return divisions
      .map((d) => ({ division: d, careers: careers.filter((c) => c.division_id === d.id && (!q || normalize(c.name).includes(q))) }))
      .filter((g) => g.careers.length > 0);
  }, [careers, divisions, query]);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data || !progress) return <LoadError error={error} onRetry={reload} />;

  const closed = !progress.interests_open;
  const dirty = selected.join() !== saved.join();

  const toggle = (id: string) => {
    setStatus(null);
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX ? [...cur, id] : cur));
  };
  const move = (idx: number, delta: number) => {
    setStatus(null);
    setSelected((cur) => {
      const next = [...cur];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_post_event_interests', { p_career_ids: selected });
      if (rpcError) throw rpcError;
      setSaved(selected);
      setStatus({ tone: 'success', msg: text('interestsSaved') });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{text('interestsTitle')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{text('interestsBody')}</p>
      </header>

      {closed && <Alert tone="warning">{text('interestsClosed')}</Alert>}

      <section className="card p-4" aria-label="Tu selección">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Tu selección</h2>
          <span className="text-xs text-ink-muted">
            {selected.length} de {MAX}
          </span>
        </div>
        {selected.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">Toca una carrera de la lista para agregarla.</p>
        ) : (
          <ol className="space-y-2">
            {selected.map((id, idx) => (
              <li key={id} className="flex items-center gap-2 rounded-theme border border-line bg-surface-raised py-1 pl-3 pr-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-extrabold text-on-primary">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold">{careerById.get(id)?.name ?? 'Carrera no disponible'}</span>
                {!closed && (
                <div className="flex shrink-0 items-center">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink disabled:opacity-30"
                      aria-label="Subir"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === selected.length - 1}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink disabled:opacity-30"
                      aria-label="Bajar"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggle(id)}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-error-400"
                      aria-label="Quitar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {status && (
          <Alert tone={status.tone} className="mt-3">
            {status.msg}
          </Alert>
        )}
        {!closed && (
          <Button className="mt-4 w-full" onClick={onSave} loading={saving} disabled={!dirty}>
            {dirty ? 'Guardar selección' : 'Selección guardada'}
          </Button>
        )}
      </section>

      {!closed && (
        <>
          <label className="relative block">
            <span className="sr-only">Buscar carrera</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar carrera"
              className="h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-base text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none"
            />
          </label>

          {groups.length === 0 && <p className="text-center text-sm text-ink-muted">No encontramos carreras con ese nombre.</p>}

          {groups.map(({ division, careers: list }) => {
            const color = theme.divisions[division.code]?.color ?? theme.colors.secondary;
            return (
              <section key={division.id}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color }}>
                  {division.name}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {list.map((c) => {
                    const pos = selected.indexOf(c.id);
                    const isOn = pos >= 0;
                    const full = !isOn && selected.length >= MAX;
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        disabled={full}
                        aria-pressed={isOn}
                        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-all ${
                          isOn
                            ? 'border-primary-500 bg-primary-500/15 font-semibold text-ink'
                            : 'border-line bg-surface text-ink hover:border-secondary-400 disabled:opacity-40'
                        }`}
                      >
                        {isOn ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-[11px] font-extrabold text-on-primary">
                            {pos + 1}
                          </span>
                        ) : (
                          <Check className="h-4 w-4 opacity-0" aria-hidden />
                        )}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
