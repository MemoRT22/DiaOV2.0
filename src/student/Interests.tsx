import { ArrowDown, ArrowUp, Check, Compass, MapPin, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, LoadError, PageSkeleton } from '../components/ui';
import { fetchCareers, fetchDivisions, fetchMyInterests, fetchProgress } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { fetchVocationalProfile, type VocationalProfile } from '../lib/vocationalApi';
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
    () =>
      Promise.all([
        fetchCareers(),
        fetchDivisions(),
        fetchMyInterests(),
        fetchProgress(),
        fetchVocationalProfile().catch(() => null),
      ]),
    [],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (data) {
      setSelected(data[2]);
      setSaved(data[2]);
    }
  }, [data]);

  const [careers, divisions, , progress, vocational] = data ?? [[], [], [], null, null] as const;
  const careerById = useMemo(() => new Map(careers.map((c) => [c.id, c])), [careers]);
  const groups = useMemo(() => {
    const q = normalize(query.trim());
    return divisions
      .map((d) => ({
        division: d,
        careers: careers.filter((c) => c.division_id === d.id && (!q || normalize(c.name).includes(q))),
      }))
      .filter((g) => g.careers.length > 0);
  }, [careers, divisions, query]);

  if (loading && !data) return <PageSkeleton />;
  if (error || !data || !progress) return <LoadError error={error} onRetry={reload} />;

  const closed = !progress.interests_open;
  const dirty = selected.join() !== saved.join();
  const vp = vocational as VocationalProfile | null;

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

  const addRecommendation = (careerId: string) => {
    if (closed) return;
    setSelected((cur) => {
      if (cur.includes(careerId)) return cur;
      if (cur.length >= MAX) return cur;
      return [...cur, careerId];
    });
    setShowPicker(true);
    setStatus(null);
  };

  return (
    <div className="space-y-5">
      <header className="animate-fade-up">
        <div className="flex items-center gap-2">
          <Compass className="h-6 w-6 text-primary-400" aria-hidden />
          <h1 className="text-2xl font-extrabold">Tu Brújula Vocacional</h1>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Selecciona las carreras que te llaman la atención y te ayudaremos a encontrar talleres relacionados durante el evento.
          También revisa las conexiones entre lo que has explorado y las carreras que podrías considerar.
        </p>
      </header>

      {closed && <Alert tone="warning">{text('interestsClosed')}</Alert>}

      {vp && (
        <ResumenExploracion vp={vp} theme={theme} />
      )}

      {vp && vp.recommendations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold">Carreras que podrías explorar</h2>
          {vp.recommendations.map((rec) => {
            const color = theme.divisions[rec.division_code]?.color ?? theme.colors.secondary;
            const alreadySelected = selected.includes(rec.career_id);
            const canAdd = !closed && !alreadySelected && selected.length < MAX;
            return (
              <div
                key={rec.career_id}
                className="card animate-fade-up p-4"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-bold">{rec.career_name}</h3>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-ink-muted">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {rec.division_name}
                    </div>
                  </div>
                  {rec.is_initial_interest && (
                    <Badge tone="neutral">
                      Interés inicial
                    </Badge>
                  )}
                </div>
                <ul className="mt-3 space-y-1.5">
                  {rec.reasons.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-400" aria-hidden />
                      <span>{reason.text}</span>
                    </li>
                  ))}
                </ul>
                {rec.matched_tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {rec.matched_tags.map((tag) => (
                      <span
                        key={tag.code}
                        className="rounded-full bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-ink-muted"
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                )}
                {canAdd && (
                  <button
                    onClick={() => addRecommendation(rec.career_id)}
                    className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-primary-400 hover:text-primary-300"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar a mis opciones
                  </button>
                )}
                {alreadySelected && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success-400">
                    <Check className="h-4 w-4" />
                    En tu selección
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      {vp && vp.recommendations.length === 0 && vp.attended_workshops.length === 0 && (
        <section className="card p-5 text-center">
          <Compass className="mx-auto h-8 w-8 text-ink-muted" aria-hidden />
          <p className="mt-2 text-sm text-ink-muted">
            Todavía estás comenzando tu recorrido. Completa más actividades para que podamos mostrarte conexiones entre
            lo que has explorado y las carreras.
          </p>
        </section>
      )}

      <section className="card p-4" aria-label="Mis opciones después del Día OV">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Carreras que me llaman la atención</h2>
          <span className="text-xs text-ink-muted">
            {selected.length} de {MAX}
          </span>
        </div>
        {selected.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">
            Toca una carrera de la lista para agregarla. Selecciona hasta {MAX} y te recomendaremos talleres relacionados.
          </p>
        ) : (
          <ol className="space-y-2">
            {selected.map((id, idx) => (
              <li
                key={id}
                className="flex items-center gap-2 rounded-theme border border-line bg-surface-raised py-1 pl-3 pr-1"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-extrabold text-on-primary">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {careerById.get(id)?.name ?? 'Carrera no disponible'}
                </span>
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

      {!closed && showPicker && (
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

          {groups.length === 0 && (
            <p className="text-center text-sm text-ink-muted">No encontramos carreras con ese nombre.</p>
          )}

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

      {!closed && !showPicker && (
        <button
          onClick={() => setShowPicker(true)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface py-3 text-sm font-semibold text-ink-muted hover:border-secondary-400 hover:text-ink"
        >
          <Search className="h-4 w-4" />
          Explorar todas las carreras
        </button>
      )}
    </div>
  );
}

function ResumenExploracion({ vp, theme }: { vp: VocationalProfile; theme: ReturnType<typeof useTheme>['theme'] }) {
  const attendedCount = vp.attended_workshops.length;
  const reservedCount = vp.reserved_workshops.length;
  const divisionCount = vp.divisions_visited.length;

  return (
    <section className="card animate-fade-up p-4">
      <h2 className="text-sm font-semibold">Lo que exploraste durante el Día OV</h2>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="font-display text-xl font-extrabold text-secondary-300">{attendedCount}</p>
          <p className="text-xs text-ink-muted">Talleres asistidos</p>
        </div>
        <div>
          <p className="font-display text-xl font-extrabold text-primary-400">{reservedCount}</p>
          <p className="text-xs text-ink-muted">Reservados</p>
        </div>
        <div>
          <p className="font-display text-xl font-extrabold text-accent-400">{divisionCount}</p>
          <p className="text-xs text-ink-muted">Divisiones</p>
        </div>
      </div>

      {vp.divisions_visited.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {vp.divisions_visited.map((d) => {
            const color = theme.divisions[d.division_code]?.color ?? theme.colors.secondary;
            return (
              <span
                key={d.division_id}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                style={{ background: `${color}22`, color }}
              >
                {d.division_name}
              </span>
            );
          })}
        </div>
      )}

      {vp.initial_interest && (
        <div className="mt-3 rounded-theme border border-line bg-surface-raised px-3 py-2">
          <p className="text-xs text-ink-muted">Tu interés inicial</p>
          <p className="text-sm font-semibold">{vp.initial_interest.career_name}</p>
        </div>
      )}

      {vp.attended_workshops.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-ink-muted">Talleres que cursaste</p>
          <ul className="space-y-1">
            {vp.attended_workshops.map((w) => (
              <li key={w.activity_id} className="text-sm">
                {w.title}
                <span className="text-ink-muted"> · {w.division_name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
