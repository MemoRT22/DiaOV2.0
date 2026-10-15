import { ArrowDown, ArrowRight, ArrowUp, Check, ClipboardList, Compass, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, buttonClasses, PageSkeleton } from '../components/ui';
import { fetchDivisions, fetchPostEventInterests } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import { ErrorState } from './ui/States';
import { useExitSurvey } from './ExitSurveyProvider';

const MAX = 3;

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function Interests() {
  const { theme, text } = usePublicTheme();
  const survey = useExitSurvey();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([fetchDivisions(), fetchPostEventInterests()]),
    [],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    if (data) {
      setSelected(data[1].career_ids);
      setSaved(data[1].career_ids);
    }
  }, [data]);

  const [divisions, interests] = data ?? [[], null] as const;
  const careers = interests?.careers ?? [];
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
  if (error || !data || !interests) return <ErrorState error={error} onRetry={reload} />;

  // Only editable while the question is enabled and its window is open; a closed window is read-only.
  const closed = !interests.post_event_interests_open;
  const notYet = !interests.post_event_interests_prompt && !interests.post_event_interests_completed;
  const editable = interests.post_event_interests_can_edit;
  const dirty = selected.join() !== saved.join();
  const hasResponse = saved.length > 0;

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
    // An empty list means "not answered yet", never a completed vocational response.
    if (saving || (selected.length === 0 && !hasResponse)) return;
    setSaving(true);
    setStatus(null);
    try {
      const { error: rpcError } = await supabase.rpc('save_post_event_interests', { p_career_ids: selected });
      if (rpcError) throw rpcError;
      setSaved(selected);
      setStatus({
        tone: 'success',
        msg: selected.length > 0 ? text('interestsSaved') : 'Retiramos tus elecciones. Esta etapa vuelve a quedar pendiente.',
      });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex animate-fade-up items-start gap-3">
        <span className="icon-orb flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-fg-brand" aria-hidden>
          <Compass className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-fg-brand">Cierre vocacional · opcional</p>
          <h1 className="text-2xl font-extrabold leading-tight">{text('interestsTitle')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{text('interestsBody')}</p>
        </div>
      </header>

      {notYet && (
        <Alert tone="info">Esta pregunta se habilita después de participar en el evento. Aún no necesitas responderla.</Alert>
      )}
      {closed && <Alert tone="warning">{text('interestsClosed')}</Alert>}

      {!notYet && (
        <div className="rounded-theme border border-line bg-surface-raised p-4 text-sm text-ink-muted">
          <strong className="block text-ink">Tu prerregistro permanece igual.</strong>
          Esta selección registra lo que te interesa después de vivir el Día OV. Tu carrera inicial también puede estar entre estas opciones.
        </div>
      )}

      {!notYet && (
      <section className="space-card p-4" aria-label="Carreras que más me interesaron">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Mis carreras de interés</h2>
          <span className="text-xs text-ink-muted" aria-live="polite">
            {selected.length} de {MAX} seleccionadas
          </span>
        </div>
        {selected.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">
            {editable
              ? `Todavía no has respondido. Toca al menos una carrera para comenzar; puedes elegir hasta ${MAX} y ordenarlas por preferencia.`
              : 'No hay una respuesta vocacional registrada.'}
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
                {editable && (
                  <div className="flex shrink-0 items-center">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink disabled:opacity-30"
                      aria-label={`Subir ${careerById.get(id)?.name ?? 'carrera'}`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === selected.length - 1}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink disabled:opacity-30"
                      aria-label={`Bajar ${careerById.get(id)?.name ?? 'carrera'}`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggle(id)}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-ink-muted hover:text-error-400"
                      aria-label={`Quitar ${careerById.get(id)?.name ?? 'carrera'}`}
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
        {editable && (
          <Button className="mt-4 w-full" onClick={onSave} loading={saving} disabled={!dirty || (selected.length === 0 && !hasResponse)}>
            {selected.length === 0 && hasResponse ? 'Retirar todas mis elecciones' : 'Guardar mis intereses'}
          </Button>
        )}
        {editable && selected.length === 0 && !hasResponse && (
          <p className="mt-2 text-center text-xs text-ink-muted">Si aún no quieres responder, puedes volver más tarde. No guardaremos una selección vacía.</p>
        )}
        {editable && selected.length === 0 && hasResponse && (
          <p className="mt-2 text-center text-xs text-ink-muted">Al retirar todas, no quedará una respuesta vocacional completada.</p>
        )}
      </section>
      )}

      {editable && (
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

      {survey.enabled && survey.status?.isOpen && !survey.status.completed && (
        <section className="space-card border-secondary-400/40 p-4" aria-label="Siguiente paso del cierre">
          <div className="flex items-start gap-3">
            <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-fg-brand" aria-hidden />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Siguiente paso del cierre</p>
              <h2 className="mt-1 font-extrabold">Comparte cómo fue tu experiencia</h2>
              <p className="mt-1 text-sm text-ink-muted">La encuesta es independiente de tus carreras y sigue disponible aunque hayas omitido esta etapa.</p>
            </div>
          </div>
          <Link to="/encuesta" className={buttonClasses('secondary', 'mt-4 w-full')}>
            Responder encuesta <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      )}
    </div>
  );
}
