import { Download, Eye, Pencil, Search, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, buttonClasses, Spinner } from '../../components/ui';
import { ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { fetchCareers, fetchHighSchools, type Career, type HighSchool } from '../../lib/catalog';
import { hasRole, useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';
import ParticipantForm, { type ParticipantValues } from './ParticipantForm';

type Hit = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  high_school: string | null;
  career_name: string | null;
  origin: string;
  is_demo: boolean;
  has_logged_in: boolean;
  access_configured: boolean;
  pending_conflicts?: number;
};

type EditableParticipant = ParticipantValues & { id: string; phone: string | null; high_school: string | null;
  high_school_id: string | null; high_school_grade: string | null; entry_period: string | null; initial_career_id: string | null };
type EditData = { id: string; initial: ParticipantValues; careers: Career[]; highSchools: HighSchool[] };

export default function Participants() {
  const { staff } = useAuth();
  const coordinacion = hasRole(staff, 'coordinacion');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<EditData | null>(null);
  const [editError, setEditError] = useState('');
  const editRequest = useRef(0);

  const closeEdit = () => { editRequest.current += 1; setEditingId(null); setEditData(null); setEditError(''); };
  const openEdit = async (id: string) => {
    const request = ++editRequest.current;
    setEditingId(id); setEditData(null); setEditError('');
    try {
      const [detail, careers, highSchools] = await Promise.all([
        rpc<EditableParticipant>('get_participant', { p_id: id }), fetchCareers(true), fetchHighSchools(true),
      ]);
      if (!detail || typeof detail.id !== 'string') throw new Error('NOT_FOUND');
      if (request !== editRequest.current) return;
      setEditData({ id, careers, highSchools, initial: {
        email: detail.email, full_name: detail.full_name, phone: detail.phone ?? '',
        high_school: detail.high_school ?? '', high_school_id: detail.high_school_id ?? '',
        high_school_grade: detail.high_school_grade ?? '', entry_period: detail.entry_period ?? '',
        initial_career_id: detail.initial_career_id ?? '',
      } });
    } catch (cause) {
      if (request === editRequest.current) setEditError(friendlyError(cause));
    } finally {
      if (request === editRequest.current) setEditingId(null);
    }
  };

  const q = query.trim();
  // Without a search the screen lists the most recent registrations (newest first), so a student who just signed up
  // shows up immediately. One character is not a search yet: keep what is on screen.
  const browsing = q.length === 0;

  useEffect(() => {
    if (q.length === 1) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const data = await rpc<Hit[]>('search_participants', { p_query: q });
        if (!cancelled) setHits(Array.isArray(data) ? data : []);
      } catch (cause) {
        if (!cancelled) setError(friendlyError(cause));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, browsing ? 0 : 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, browsing, revision]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1>Participantes</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Busca por nombre, correo o teléfono. Corrige datos desde la lista o abre el expediente para gestionar su acceso.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {coordinacion && (
            <>
              <Link to="importar" className={buttonClasses('secondary')}>
                <Upload className="h-4 w-4" aria-hidden />Importar participantes
              </Link>
              <Link to="exportar" className={buttonClasses('secondary')}>
                <Download className="h-4 w-4" aria-hidden />Exportar
              </Link>
            </>
          )}
        </div>
      </header>

      <label className="relative block max-w-3xl">
        <span className="mb-2 block text-sm font-semibold text-ink">Buscar participante</span>
        <Search className="pointer-events-none absolute bottom-3.5 left-4 h-4 w-4 text-ink-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ej. ana.lopez@correo.com, López o 998123"
          className="h-11 w-full rounded-theme border border-line bg-surface pl-11 pr-3 text-sm text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30"
        />
      </label>

      {error && <Alert tone="error">{error}</Alert>}
      {editError && <Alert tone="error">No se pudo abrir la edición: {editError}</Alert>}
      {editingId && <Spinner label="Cargando datos para editar" />}
      {searching && !hits && <Spinner label="Buscando" />}
      {browsing && hits && hits.length > 0 && (
        <p className="-mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Registros más recientes</p>
      )}
      {browsing && hits && hits.length === 0 && !searching && (
        <div className="card p-8 text-center text-sm text-ink-muted">Aún no hay participantes registrados en esta edición.</div>
      )}
      {!browsing && hits && hits.length === 0 && !searching && (
        <div className="card p-8 text-center text-sm text-ink-muted">
          <p>No hay ningún participante que coincida con <strong>{query.trim()}</strong>.</p>
          <p className="mt-1">
            Si dice que no puede entrar, quizá se registró con otro correo: prueba con su nombre o teléfono. Si no aparece, puede registrarse desde la pantalla de acceso.
          </p>
        </div>
      )}
      {hits && hits.length > 0 && (
        <div className={`card overflow-hidden transition-opacity ${searching ? 'opacity-60' : ''}`}>
          <table className="admin-participant-table w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-surface-raised text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Participante</th>
                <th scope="col" className="hidden px-4 py-3 md:table-cell">Teléfono</th>
                <th scope="col" className="hidden px-4 py-3 lg:table-cell">Carrera inicial</th>
                <th scope="col" className="px-4 py-3">Estado</th>
                <th scope="col" className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {hits.map((h) => (
                <tr key={h.id} className="transition-colors hover:bg-surface-raised">
                  <td className="px-4 py-3">
                    <Link to={h.id} className="font-semibold text-ink underline-offset-2 hover:text-fg-info hover:underline">
                      {h.full_name}
                    </Link>
                    <p className="text-xs text-ink-muted">{h.email}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{h.phone ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-ink-muted lg:table-cell">{h.career_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{ORIGIN_LABELS[h.origin] ?? h.origin}</Badge>
                      {h.is_demo && <Badge tone="warning">Prueba</Badge>}
                      {!h.access_configured && <Badge tone="neutral">Acceso no configurado</Badge>}
                      {!!h.pending_conflicts && <Badge tone="warning">Por revisar</Badge>}
                      {h.has_logged_in && <Badge tone="success">Ya entró</Badge>}
                    </div>
                  </td>
                  <td className="admin-participant-actions px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link to={h.id} className="admin-action-link" aria-label={`Ver expediente de ${h.full_name}`}><Eye className="h-4 w-4" aria-hidden />Ver</Link>
                      <button type="button" className="admin-action-link" data-primary="true" onClick={() => void openEdit(h.id)} disabled={!!editingId} aria-label={`Editar datos de ${h.full_name}`}>
                        <Pencil className="h-4 w-4" aria-hidden />Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hits.length === 50 && (
            <p className="p-3 text-center text-xs text-ink-muted">
              {browsing ? 'Se muestran los 50 registros más recientes. Busca para encontrar a otros.' : 'Se muestran 50 resultados. Afina la búsqueda.'}
            </p>
          )}
        </div>
      )}
      {editData && <ParticipantForm key={editData.id} participantId={editData.id} initial={editData.initial}
        careers={editData.careers} highSchools={editData.highSchools} canEditHighSchool={coordinacion}
        onClose={closeEdit} onSaved={() => { closeEdit(); setRevision((value) => value + 1); }} />}
    </div>
  );
}
