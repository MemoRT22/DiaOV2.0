import { ArrowLeftRight, Check, ChevronDown, MapPin, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, LoadError, PageSkeleton } from '../components/ui';
import { fetchDivisions, formatTime } from '../lib/catalog';
import { recommendationReason } from '../lib/recommendationReason';
import { fetchRecommendedActivities } from '../lib/recommendationsApi';
import { hasTightTransfer, sessionState, type BoardSession } from '../lib/reservations';
import { useLoad } from '../lib/useLoad';
import { useReservationBoard } from '../lib/useReservationBoard';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import ConfirmSheet, { type ConfirmRequest } from './reservations/ConfirmSheet';
import SessionRow from './reservations/SessionRow';
import WindowNotice from './reservations/WindowNotice';

type Filter = { kind: 'all' } | { kind: 'foryou' } | { kind: 'live' } | { kind: 'division'; id: string };

/** Talleres: explore, see at a glance what has room / is live / clashes, and book in two taps. */
export default function Missions() {
  const { theme, term, text } = usePublicTheme();
  const { edition } = useEdition();
  const { board, error, loading, reload, reserve, change } = useReservationBoard(edition?.id);
  const divisions = useLoad(fetchDivisions, []);
  const recs = useLoad(() => fetchRecommendedActivities().catch(() => null), []);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const replacing = useMemo(() => {
    const id = params.get('cambiar');
    return board?.reservations.find((r) => r.id === id && r.status === 'vigente') ?? null;
  }, [board, params]);
  const replacingSession = replacing && board?.sessions.find((s) => s.id === replacing.session_id);

  const recommendations = recs.data?.recommendations ?? [];
  const recommendedIds = useMemo(() => new Set(recommendations.map((r) => r.activity_id)), [recommendations]);

  const workshops = useMemo(() => {
    const byActivity = new Map<string, BoardSession[]>();
    for (const s of board?.sessions ?? []) {
      if (s.status !== 'activa') continue;
      byActivity.set(s.activity_id, [...(byActivity.get(s.activity_id) ?? []), s]);
    }
    const list = [...byActivity.values()];
    // Recommended (and not yet attended) first, in the order the server ranked them; the rest keep their order.
    const rank = (w: BoardSession[]) => {
      const idx = recommendations.findIndex((r) => r.activity_id === w[0].activity_id);
      return idx >= 0 && !recommendations[idx].already_attended ? idx : Number.MAX_SAFE_INTEGER;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }, [board, recommendations]);

  if ((loading && !board) || (divisions.loading && !divisions.data)) return <PageSkeleton blocks={4} />;
  if (error || !board) return <LoadError error={error} onRetry={reload} />;
  if (divisions.error || !divisions.data) return <LoadError error={divisions.error} onRetry={divisions.reload} />;

  const divisionById = new Map(divisions.data.map((d) => [d.id, d]));
  const anyLive = workshops.some((w) => w.some((s) => s.in_progress));
  const visible = workshops.filter((w) => {
    if (filter.kind === 'foryou') return recommendedIds.has(w[0].activity_id);
    if (filter.kind === 'live') return w.some((s) => s.in_progress);
    if (filter.kind === 'division') return w[0].division_id === filter.id;
    return true;
  });
  const active = board.active_reservation_count;
  const full = active >= board.max_reservations;

  const ask = (s: BoardSession) => {
    const when = `${formatTime(s.starts_at)}–${formatTime(s.ends_at)}`;
    const warning = hasTightTransfer(s, replacing)
      ? `Traslado ajustado: tienes menos de ${board.travel_buffer_minutes} min entre este taller y otro de tu ruta. Puedes continuar.`
      : undefined;
    const summary = { title: s.title, when: s.in_progress ? `${when} · En curso, puedes entrar` : when, where: s.location || undefined };
    if (replacing && replacingSession) {
      setConfirm({
        title: 'Cambiar horario',
        body: `Cambiarás ${replacingSession.title} (${formatTime(replacingSession.starts_at)}) por ${s.title} (${when}). Si el nuevo lugar ya no está disponible, conservas tu reservación actual.`,
        confirmLabel: 'Confirmar cambio',
        summary,
        warning,
        action: async () => {
          await change(replacing.id, s.id);
          navigate('/ruta');
        },
      });
    } else {
      setConfirm({
        title: 'Reservar lugar',
        body: s.in_progress ? 'Ya está en curso: puedes entrar ahora.' : '',
        confirmLabel: 'Reservar',
        summary,
        warning,
        success: { title: 'Listo. Lo agregamos a tu ruta.', body: `${s.title} · ${when}`, link: { to: '/ruta', label: 'Ver mi ruta' } },
        action: () => reserve(s.id),
      });
    }
  };

  const chip = (on: boolean) =>
    `min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
      on ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-line bg-surface text-ink-muted hover:text-ink'
    }`;
  const isFilter = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  const toggleExpanded = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">{term('activity', true)}</h1>
        {!replacing && (
          <Link to="/ruta" className="mt-1 inline-flex min-h-11 items-center gap-3 text-sm text-ink-muted" aria-label={`Llevas ${active} de ${board.max_reservations} en ${term('route')}`}>
            <span className="flex gap-1.5" aria-hidden>
              {Array.from({ length: board.max_reservations }, (_, i) => (
                <span key={i} className={`h-2.5 w-7 rounded-full ${i < active ? 'bg-primary-500' : 'bg-line'}`} />
              ))}
            </span>
            <span>
              Llevas {active} de {board.max_reservations} en <span className="font-semibold text-fg-brand">{term('route')}</span>
            </span>
          </Link>
        )}
        {!replacing && <p className="sr-only">{text('activitiesIntro')}</p>}
      </header>

      {replacing && replacingSession ? (
        <div className="card flex items-center gap-3 border-primary-500/50 p-3">
          <ArrowLeftRight className="h-5 w-5 shrink-0 text-fg-brand" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Elige el nuevo horario para <strong>{replacingSession.title}</strong> ({formatTime(replacingSession.starts_at)}).
          </p>
          <button
            onClick={() => setParams({}, { replace: true })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
            aria-label="Cancelar cambio"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      ) : (
        <WindowNotice board={board} />
      )}

      {!replacing && full && board.window === 'open' && (
        <Alert>
          Tu ruta está completa ({active} de {board.max_reservations}). Para elegir otro, cambia o cancela uno desde{' '}
          <Link to="/ruta" className="font-semibold underline underline-offset-4">
            {term('route')}
          </Link>
          .
        </Alert>
      )}

      <div className="no-scrollbar sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 flex gap-2 overflow-x-auto overscroll-x-contain bg-surface-sunken/90 px-4 py-2 backdrop-blur" aria-label="Filtrar" role="group">
        <button className={chip(isFilter({ kind: 'all' }))} onClick={() => setFilter({ kind: 'all' })}>
          Todos
        </button>
        {recommendedIds.size > 0 && (
          <button className={chip(isFilter({ kind: 'foryou' }))} onClick={() => setFilter({ kind: 'foryou' })}>
            Para ti
          </button>
        )}
        {anyLive && (
          <button className={chip(isFilter({ kind: 'live' }))} onClick={() => setFilter({ kind: 'live' })}>
            En curso
          </button>
        )}
        {divisions.data.map((d) => (
          <button key={d.id} className={chip(isFilter({ kind: 'division', id: d.id }))} onClick={() => setFilter({ kind: 'division', id: d.id })}>
            {d.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Alert>{filter.kind === 'all' ? text('activitiesEmpty') : 'No hay talleres con este filtro.'}</Alert>
      ) : (
        <ul className="space-y-3">
          {visible.map((sessions, i) => {
            const first = sessions[0];
            const division = divisionById.get(first.division_id);
            const color = (division && theme.divisions[division.code]?.color) || theme.colors.secondary;
            const sharedLocation = sessions.every((s) => s.location === first.location) ? first.location : '';
            const rec = recommendations.find((r) => r.activity_id === first.activity_id);
            const why = rec ? recommendationReason(rec) : null;
            const open = expanded.has(first.activity_id);
            const longDescription = (first.description?.length ?? 0) > 90;
            return (
              <li key={first.activity_id} className="card animate-fade-up overflow-hidden" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <div className="h-1" style={{ background: color }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
                        {division?.name}
                      </p>
                      <h2 className="mt-0.5 text-base font-extrabold leading-snug">{first.title}</h2>
                    </div>
                    {rec?.already_attended ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-1 text-xs font-bold text-fg-success">
                        <Check className="h-3 w-3" aria-hidden />
                        Explorado
                      </span>
                    ) : rec?.already_reserved ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-500/15 px-2.5 py-1 text-xs font-bold text-fg-success">
                        <Check className="h-3 w-3" aria-hidden />
                        En tu ruta
                      </span>
                    ) : null}
                  </div>
                  {why && !rec?.already_attended && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-brand" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-bold text-fg-brand">{why.badge}</span>
                        {why.reason && <span className="line-clamp-2 break-words text-ink-muted">{why.reason}</span>}
                      </span>
                    </p>
                  )}
                  {sharedLocation && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-ink-muted">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 break-words">{sharedLocation}</span>
                    </p>
                  )}
                  {first.description && (
                    <div className="mt-2">
                      <p className={`text-sm text-ink-muted ${open ? '' : 'line-clamp-2'}`}>{first.description}</p>
                      {longDescription && (
                        <button
                          onClick={() => toggleExpanded(first.activity_id)}
                          aria-expanded={open}
                          className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-fg-brand"
                        >
                          {open ? 'Ver menos' : 'Ver más'}
                          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                        </button>
                      )}
                    </div>
                  )}
                  <ul className="mt-3 space-y-2">
                    {sessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        state={sessionState(board, s, replacing)}
                        actionLabel={replacing ? 'Cambiar aquí' : 'Reservar'}
                        onAction={() => ask(s)}
                        showLocation={!sharedLocation}
                        tightMinutes={hasTightTransfer(s, replacing) ? board.travel_buffer_minutes : null}
                      />
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirm && <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
