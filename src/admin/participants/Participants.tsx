import { FileSpreadsheet, LockOpen, Search, Upload, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, buttonClasses, Spinner } from '../../components/ui';
import { ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { hasRole, useAuth } from '../../lib/auth';
import { fetchCareers } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import ParticipantForm, { EMPTY_VALUES } from './ParticipantForm';

type Hit = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  high_school: string | null;
  career_name: string | null;
  origin: string;
  is_demo: boolean;
  has_birth_date: boolean;
  has_logged_in: boolean;
  /** Added with the access diagnosis in the search (absent on older servers). */
  access_locked?: boolean;
  pending_conflicts?: number;
};

export default function Participants() {
  const navigate = useNavigate();
  const { staff } = useAuth();
  const coordinacion = hasRole(staff, 'coordinacion');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const careers = useLoad(() => fetchCareers(true), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
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
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, refresh]);

  const unlock = async (id: string) => {
    setUnlocking(id);
    setError('');
    try {
      await rpc('clear_access_lock', { p_id: id });
      setRefresh((n) => n + 1);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setUnlocking(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Participantes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Busca por nombre, correo o teléfono. Si alguien no puede entrar, búscalo aquí: verás qué le impide el acceso y podrás corregirlo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {coordinacion && (
            <>
              <Link to="importar" className={buttonClasses('secondary')}>
                <Upload className="h-4 w-4" aria-hidden />
                Importar padrón
              </Link>
              <Link to="exportar" className={buttonClasses('secondary')}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
                Exportar
              </Link>
            </>
          )}
          <Button onClick={() => setCreating(true)} disabled={!careers.data}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Dar de alta
          </Button>
        </div>
      </header>

      <label className="relative block">
        <span className="sr-only">Buscar participante</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ej. ana.lopez@correo.com, López o 998123"
          className="h-14 w-full rounded-theme border border-line bg-surface-raised pl-12 pr-4 text-base text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30"
        />
      </label>

      {error && <Alert tone="error">{error}</Alert>}
      {searching && !hits && <Spinner label="Buscando" />}
      {hits && hits.length === 0 && !searching && (
        <div className="card p-8 text-center text-sm text-ink-muted">
          <p>No hay ningún participante que coincida con <strong>{query.trim()}</strong>.</p>
          <p className="mt-1">
            Si dice que no puede entrar, quizá se registró con otro correo: prueba con su nombre o teléfono. Si no aparece, dalo de alta.
          </p>
        </div>
      )}
      {hits && hits.length > 0 && (
        <div className={`card overflow-hidden transition-opacity ${searching ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-raised text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="hidden px-4 py-3 md:table-cell">Teléfono</th>
                <th className="hidden px-4 py-3 lg:table-cell">Carrera inicial</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {hits.map((h) => (
                <tr key={h.id} className="cursor-pointer transition-colors hover:bg-surface-raised" onClick={() => navigate(h.id)}>
                  <td className="px-4 py-3">
                    <Link to={h.id} className="font-semibold hover:text-fg-info" onClick={(e) => e.stopPropagation()}>
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
                      {!h.has_birth_date && <Badge tone="error">Sin fecha</Badge>}
                      {h.access_locked && <Badge tone="error">Bloqueado</Badge>}
                      {!!h.pending_conflicts && <Badge tone="warning">Por revisar</Badge>}
                      {h.has_logged_in && <Badge tone="success">Ya entró</Badge>}
                    </div>
                    {h.access_locked && (
                      <button
                        type="button"
                        disabled={unlocking === h.id}
                        onClick={(e) => { e.stopPropagation(); unlock(h.id); }}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-fg-info hover:underline disabled:opacity-60"
                      >
                        <LockOpen className="h-3.5 w-3.5" aria-hidden />
                        Retirar bloqueo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hits.length === 50 && <p className="p-3 text-center text-xs text-ink-muted">Se muestran 50 resultados. Afina la búsqueda.</p>}
        </div>
      )}

      {creating && careers.data && (
        <ParticipantForm
          initial={{ ...EMPTY_VALUES, email: query.includes('@') ? query.trim().toLowerCase() : '' }}
          careers={careers.data}
          onClose={() => setCreating(false)}
          onSaved={(id) => navigate(id)}
        />
      )}
    </div>
  );
}
