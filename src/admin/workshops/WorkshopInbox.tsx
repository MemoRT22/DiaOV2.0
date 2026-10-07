import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, SelectField, Spinner } from '../../components/ui';
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

  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-extrabold">Talleres</h1>
      <p className="mt-1 text-sm text-ink-muted">Revisa los talleres recibidos y consulta los publicados.</p>
    </header>
    <div className="grid grid-cols-3 gap-2" aria-label="Estados de talleres">
      {GROUPS.map((group) => <button key={group} type="button" onClick={() => { setStatus(group); setPage(1); }}
        aria-pressed={status === group}
        className={`rounded-theme border p-3 text-left transition-colors ${status === group ? 'border-primary-500 bg-primary-500/10' : 'border-line bg-surface hover:border-secondary-400'}`}>
        <span className="block text-2xl font-bold tabular-nums">{data?.counts[group] ?? '—'}</span>
        <span className="text-xs text-ink-muted">{group === 'pending' ? 'Pendientes' : group === 'published' ? 'Publicados' : 'Descartados'}</span>
      </button>)}
    </div>
    <div className="grid gap-3 rounded-theme border border-line bg-surface p-4 md:grid-cols-[1fr_13rem]">
      <form onSubmit={submitSearch} className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Buscar talleres</span>
          <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} maxLength={120}
            placeholder="Título, responsable o correo"
            className="h-12 w-full rounded-theme border border-line bg-surface-raised px-4 text-ink placeholder:text-ink-muted" />
        </label>
        <Button type="submit" variant="secondary" aria-label="Buscar"><Search className="h-4 w-4" /></Button>
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
        {data.items.map((item) => <Link key={item.id} to={`/coordinacion/talleres/${item.id}`}
          className="card block p-4 transition-colors hover:border-secondary-400 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1"><h2 className="text-lg font-bold">{item.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{TYPE_LABELS[item.activity_type]}
                {item.activity_type === 'vida_universitaria' && item.experience_category ? ` · ${CATEGORY_LABELS[item.experience_category] ?? item.experience_category}` : ''}</p>
            </div>
            <Badge tone={TONES[groupForStatus(item.status)]}>{GROUP_LABELS[groupForStatus(item.status)]}</Badge>
          </div>
          <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div><dt className="text-ink-muted">Responsable</dt><dd>{item.facilitator_name}</dd></div>
            <div><dt className="text-ink-muted">Carreras o área</dt><dd className="line-clamp-1">{item.activity_type === 'vida_universitaria' ? CATEGORY_LABELS[item.experience_category ?? ''] ?? 'Vida Universitaria' : item.career_names?.join(', ') || `${item.career_count} carreras`}</dd></div>
            <div><dt className="text-ink-muted">Duración · cupo</dt><dd>{item.session_duration_minutes === 60 ? '1 hora' : '30 min'} · {item.capacity_per_session}</dd></div>
            <div><dt className="text-ink-muted">Ubicación</dt><dd>{item.building} · {item.room_space}</dd></div>
          </dl>
        </Link>)}
      </div>}
      {data.total > data.page_size && <nav className="flex items-center justify-between gap-3" aria-label="Paginación de talleres">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
        <span className="text-sm text-ink-muted">Página {page} de {Math.ceil(data.total / data.page_size)}</span>
        <Button variant="secondary" disabled={page * data.page_size >= data.total} onClick={() => setPage(page + 1)}>Siguiente</Button>
      </nav>}
    </>}
  </div>;
}
