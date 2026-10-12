import { useState, type FormEvent } from 'react';
import { ArrowUpRight, MapPin, Pencil, Plus, Search } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert, Badge, Button, buttonClasses, SelectField, Spinner } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import {
  CATEGORY_LABELS, GROUP_LABELS, TYPE_LABELS, groupForStatus, workshopAdminApi,
  type WorkshopGroup, type WorkshopType,
} from '../../lib/workshopAdminApi';

const GROUPS: WorkshopGroup[] = ['pending', 'published', 'archived'];
const TONES = { pending: 'warning', published: 'success', archived: 'neutral' } as const;

export default function WorkshopInbox() {
  const [status, setStatus] = useState<WorkshopGroup>('pending');
  const [type, setType] = useState<WorkshopType | ''>('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => workshopAdminApi.list({ status, type, search, page }), [status, type, search, page]);
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); };
  // Set by the detail screen after a deletion, so the result is confirmed where the workshop used to be listed.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
      <h1>Talleres</h1>
      <p className="mt-2 text-sm text-ink-muted">Crea talleres, revisa propuestas, edítalos desde esta lista y consulta los publicados.</p>
      </div>
      <Link to="/coordinacion/talleres/nuevo" className={buttonClasses('primary')}><Plus className="h-4 w-4" aria-hidden />Nuevo taller</Link>
    </header>
    {notice && <Alert tone="success">{notice}</Alert>}
    <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Estados de talleres">
      {GROUPS.map((group) => <button key={group} type="button" onClick={() => { setStatus(group); setPage(1); }}
        aria-pressed={status === group}
        className="admin-filter-choice text-left">
        <span className="block text-xl font-semibold tabular-nums">{data?.counts[group] ?? '—'}</span>
        <span className="text-xs font-semibold text-ink-muted">{group === 'pending' ? 'Pendientes' : group === 'published' ? 'Publicados' : 'Descartados'}</span>
      </button>)}
    </div>
    <div className="card grid items-end gap-3 p-4 md:grid-cols-[1fr_13rem]">
      <form onSubmit={submitSearch} className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Buscar talleres</span>
          <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} maxLength={120}
            placeholder="Título, responsable o correo"
            className="h-12 w-full rounded-theme border border-line bg-surface-raised px-4 text-ink placeholder:text-ink-muted" />
        </label>
        <Button type="submit" variant="secondary"><Search className="h-4 w-4" aria-hidden />Buscar</Button>
      </form>
      <SelectField label="Tipo" value={type} onChange={(e) => { setType(e.target.value as WorkshopType | ''); setPage(1); }}>
        <option value="">Todos los tipos</option>
        <option value="academica">Taller académico</option>
        <option value="vida_universitaria">Vida Universitaria</option>
      </SelectField>
    </div>
    {loading && <Spinner label="Cargando talleres" />}
    {!!error && <Alert tone="error">{friendlyError(error)} <button onClick={reload} className="font-semibold underline">Reintentar</button></Alert>}
    {!loading && !error && data && <>
      {data.items.length === 0 ? <div className="card px-6 py-12 text-center">
        <h2 className="text-lg font-bold">{status === 'pending' ? 'No hay talleres pendientes.' : status === 'published' ? 'No hay talleres publicados.' : 'No hay talleres descartados.'}</h2>
        <p className="mt-2 text-sm text-ink-muted">{search || type ? 'Prueba otra búsqueda o tipo.' : status === 'pending' ? 'Los envíos del formulario aparecerán aquí.' : 'Los talleres aparecerán aquí cuando cambien de estado.'}</p>
      </div> : <div className="space-y-3" aria-label="Bandeja de talleres">
        {data.items.map((item) => {
          const group = groupForStatus(item.status);
          return <article key={item.id} className="card admin-workshop-card overflow-hidden" data-group={group}>
            <Link to={`/coordinacion/talleres/${item.id}`} className="block p-4 focus-visible:outline-offset-[-3px] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">{TYPE_LABELS[item.activity_type]}</p>
                  <h2 className="text-lg font-bold leading-snug">{item.title}</h2>
                  {item.activity_type === 'vida_universitaria' && item.experience_category && <p className="mt-1 text-sm text-ink-muted">{CATEGORY_LABELS[item.experience_category] ?? item.experience_category}</p>}
                </div>
                <Badge tone={TONES[group]}>{GROUP_LABELS[group]}</Badge>
              </div>
              <dl className="mt-4 grid gap-x-4 gap-y-3 border-t border-line/80 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div><dt className="text-xs text-ink-muted">Responsable</dt><dd className="mt-0.5 font-medium">{item.facilitator_name}</dd></div>
                <div><dt className="text-xs text-ink-muted">Carreras o área</dt><dd className="mt-0.5 line-clamp-1 font-medium">{item.activity_type === 'vida_universitaria' ? CATEGORY_LABELS[item.experience_category ?? ''] ?? 'Vida Universitaria' : item.career_names?.join(', ') || `${item.career_count} carreras`}</dd></div>
                <div><dt className="text-xs text-ink-muted">Duración · cupo</dt><dd className="mt-0.5 font-medium">{item.session_duration_minutes === 60 ? '1 hora' : `${item.session_duration_minutes} min`} · {item.capacity_per_session} lugares</dd></div>
                <div><dt className="text-xs text-ink-muted">Ubicación</dt><dd className="mt-0.5 flex items-center gap-1 font-medium"><MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />{item.building} · {item.room_space}</dd></div>
              </dl>
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-raised/55 px-4 py-3 sm:px-5">
              <span className="text-xs text-ink-muted">{group === 'pending' ? 'Requiere revisión antes de publicarse' : group === 'published' ? 'Visible para alumnos' : 'Fuera del programa'}</span>
              <div className="flex flex-wrap gap-2">
                <Link to={`/coordinacion/talleres/${item.id}`} className="admin-action-link">
                  {group === 'pending' ? 'Revisar y decidir' : 'Ver detalle'} <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
                {group !== 'archived' && <Link to={`/coordinacion/talleres/${item.id}/editar`} className="admin-action-link" data-primary="true" aria-label={`Editar taller ${item.title}`}>
                  <Pencil className="h-4 w-4" aria-hidden />Editar
                </Link>}
              </div>
            </div>
          </article>;
        })}
      </div>}
      {data.total > data.page_size && <nav className="flex items-center justify-between gap-3" aria-label="Paginación de talleres">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
        <span className="text-sm text-ink-muted">Página {page} de {Math.ceil(data.total / data.page_size)}</span>
        <Button variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Siguiente</Button>
      </nav>}
    </>}
  </div>;
}
