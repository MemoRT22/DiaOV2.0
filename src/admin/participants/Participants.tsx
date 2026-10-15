import { Download, Pencil, Upload, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, buttonClasses, Spinner } from '../../components/ui';
import { ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { fetchCareers, fetchHighSchools, type Career, type HighSchool } from '../../lib/catalog';
import { hasRole, useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';
import { accountWithTheirData, fetchOrientation, lastSeenLabel, type Orientation } from '../../lib/participantOrientation';
import ParticipantCreate from './ParticipantCreate';
import ParticipantForm, { type ParticipantValues } from './ParticipantForm';
import { DataPanel, EmptyState, PageHeader, SearchField } from '../design/Primitives';
import ParticipantsDashboard from './ParticipantsDashboard';

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
  // Activity of each listed person and their other accounts (same phone). Never blocks or breaks the list.
  const [orientation, setOrientation] = useState<Map<string, Orientation>>(new Map());
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<EditData | null>(null);
  const [editError, setEditError] = useState('');
  const editRequest = useRef(0);
  const navigate = useNavigate();
  // Set by the participant file after a deletion.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [creating, setCreating] = useState<{ careers: Career[]; highSchools: HighSchool[] } | null>(null);
  const [openingCreate, setOpeningCreate] = useState(false);
  const openCreate = async () => {
    setOpeningCreate(true); setEditError('');
    try {
      const [careers, highSchools] = await Promise.all([fetchCareers(), fetchHighSchools()]);
      setCreating({ careers, highSchools });
    } catch (cause) { setEditError(friendlyError(cause)); }
    finally { setOpeningCreate(false); }
  };

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
        const list = Array.isArray(data) ? data : [];
        if (!cancelled) setHits(list);
        fetchOrientation(list.map((h) => h.id)).then((map) => { if (!cancelled) setOrientation(map); }, () => { if (!cancelled) setOrientation(new Map()); });
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
    <div className="ad-page">
      <PageHeader eyebrow="Gestión de registros" title="Participantes"
        description="Consulta expedientes, corrige datos y gestiona el acceso de cada alumno."
        action={coordinacion && <Button onClick={() => void openCreate()} loading={openingCreate}><UserPlus aria-hidden />Nuevo participante</Button>} />

      <div className="ad-toolbar">
        <SearchField label="Buscar participante" value={query} onChange={setQuery} autoFocus placeholder="Buscar por nombre, correo o teléfono" />
        {coordinacion && <div className="ad-toolbar-actions">
          <Link to="importar" className={buttonClasses('secondary')}><Upload aria-hidden />Importar participantes</Link>
          <Link to="exportar" className={buttonClasses('secondary')}><Download aria-hidden />Exportar</Link>
        </div>}
      </div>

      <ParticipantsDashboard />
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {editError && <Alert tone="error">No se pudo abrir el formulario: {editError}</Alert>}
      {editingId && <Spinner label="Cargando datos para editar" />}
      {searching && !hits && <Spinner label="Buscando" />}
      {browsing && hits && hits.length > 0 && (
        <p className="ad-list-caption">Registros más recientes <span>{hits.length} mostrados</span></p>
      )}
      {browsing && hits && hits.length === 0 && !searching && (
        <DataPanel><EmptyState title="Aún no hay participantes registrados en esta edición." description="Los registros aparecerán aquí en cuanto se incorporen a la edición." /></DataPanel>
      )}
      {!browsing && hits && hits.length === 0 && !searching && (
        <DataPanel><EmptyState title={<>No hay ningún participante que coincida con <strong>{query.trim()}</strong>.</>}
          description="Si dice que no puede entrar, quizá se registró con otro correo: prueba con su nombre o teléfono. Si no aparece, puede registrarse desde la pantalla de acceso." /></DataPanel>
      )}
      {hits && hits.length > 0 && (
        <DataPanel className={`ad-participants ${searching ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th scope="col">Participante</th>
                <th scope="col" className="ad-col-phone">Teléfono</th>
                <th scope="col" className="ad-col-career">Carrera inicial</th>
                <th scope="col">Estado</th>
                <th scope="col" className="ad-col-actions">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td className="ad-participant-identity">
                    <Link to={h.id} className="ad-person-link">
                      {h.full_name}
                    </Link>
                    <p>{h.email}</p>
                    <p className="ad-mobile-meta">{h.phone ?? 'Sin teléfono'}{h.career_name ? ` · ${h.career_name}` : ''}</p>
                    <OrientationBlock info={orientation.get(h.id)} />
                  </td>
                  <td className="ad-col-phone">{h.phone ?? '—'}</td>
                  <td className="ad-col-career">{h.career_name ?? '—'}</td>
                  <td className="ad-participant-status">
                    <span className="ad-origin">{ORIGIN_LABELS[h.origin] ?? h.origin}{h.is_demo && ' · Prueba'}</span>
                    {!!h.pending_conflicts ? <Badge tone="warning">Por revisar</Badge> : !h.access_configured ? <Badge tone="neutral">Acceso no configurado</Badge> : h.has_logged_in ? <Badge tone="success">Ya entró</Badge> : null}
                  </td>
                  <td className="ad-col-actions">
                    <Link to={h.id} className="ad-row-action" aria-label={`Ver expediente de ${h.full_name}`}>Expediente</Link>
                    <button type="button" className="ad-icon-action" onClick={() => void openEdit(h.id)} disabled={!!editingId} aria-label={`Editar datos de ${h.full_name}`} title="Editar datos">
                      <Pencil size={16} aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hits.length === 50 && (
            <p className="ad-table-footnote">
              {browsing ? 'Se muestran los 50 registros más recientes. Busca para encontrar a otros.' : 'Se muestran 50 resultados. Afina la búsqueda.'}
            </p>
          )}
        </DataPanel>
      )}
      {creating && <ParticipantCreate careers={creating.careers} highSchools={creating.highSchools}
        onClose={() => setCreating(null)} onCreated={(id) => navigate(id, { state: { created: true } })} />}
      {editData && <ParticipantForm key={editData.id} participantId={editData.id} initial={editData.initial}
        careers={editData.careers} highSchools={editData.highSchools} canEditHighSchool={coordinacion}
        onClose={closeEdit} onSaved={() => { closeEdit(); setRevision((value) => value + 1); }} />}
    </div>
  );
}

/** What orients a student at the desk: their activity, and the other accounts they may have (same phone) with the one holding their route first. */
function OrientationBlock({ info }: { info: Orientation | undefined }) {
  if (!info) return null;
  const holder = accountWithTheirData(info);
  return (
    <>
      <div className="ad-orient" aria-label="Actividad de la cuenta">
        <span className={`ad-orient-chip ${info.reservations_active === 0 ? 'is-empty' : ''}`}>{info.reservations_active} {info.reservations_active === 1 ? 'reservación' : 'reservaciones'}</span>
        <span className={`ad-orient-chip ${info.stamps === 0 ? 'is-empty' : ''}`}>{info.stamps} {info.stamps === 1 ? 'sello' : 'sellos'}</span>
        {info.category && <span className="ad-orient-chip">Sorteo: {info.category}</span>}
        <span className="ad-orient-chip is-empty">Última actividad: {lastSeenLabel(info.last_seen_at)}</span>
      </div>
      {holder && (
        <p className="ad-hint-route" role="note">Esta cuenta está vacía. Su ruta está en <b>{holder.email}</b> ({holder.reservations_active} {holder.reservations_active === 1 ? 'reservación' : 'reservaciones'}, {holder.stamps} sellos): debe entrar con ese correo.</p>
      )}
      {info.others.length > 0 && (
        <div className="ad-others">
          <strong>{info.others.length === 1 ? 'Otra cuenta con el mismo teléfono' : `${info.others.length} cuentas más con el mismo teléfono`}</strong>
          <ul>
            {info.others.map((o) => (
              <li key={o.id}>
                <Link to={o.id} className="ad-person-link"><b>{o.full_name}</b></Link> · {o.email} · {ORIGIN_LABELS[o.origin] ?? o.origin}
                {' · '}{o.has_login ? `entró ${lastSeenLabel(o.last_seen_at)}` : 'nunca ha entrado'}
                {' · '}<span className={o.reservations_active > 0 || o.attendances > 0 ? 'ad-has-route' : ''}>{o.reservations_active} {o.reservations_active === 1 ? 'reservación' : 'reservaciones'}, {o.stamps} sellos</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
