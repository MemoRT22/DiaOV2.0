import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, buttonClasses, Spinner } from '../../components/ui';
import { ORIGIN_LABELS, rpc } from '../../lib/adminApi';
import { hasRole, useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';

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

export default function Participants() {
  const navigate = useNavigate();
  const { staff } = useAuth();
  const coordinacion = hasRole(staff, 'coordinacion');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

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
  }, [q, browsing]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h1>Participantes</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Aquí aparecen los registros más recientes; busca por nombre, correo o teléfono. Desde su expediente puedes corregir sus datos y restablecer su contraseña.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {coordinacion && (
            <>
              <Link to="importar" className={buttonClasses('secondary')}>
                Importar participantes
              </Link>
              <Link to="exportar" className={buttonClasses('secondary')}>
                Exportar
              </Link>
            </>
          )}
        </div>
      </header>

      <label className="block max-w-3xl">
        <span className="mb-2 block text-sm font-semibold text-ink">Buscar participante</span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ej. ana.lopez@correo.com, López o 998123"
          className="h-11 w-full rounded-theme border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 focus:border-secondary-400 focus:outline-none focus:ring-2 focus:ring-secondary-500/30"
        />
      </label>

      {error && <Alert tone="error">{error}</Alert>}
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
                      {!h.access_configured && <Badge tone="neutral">Acceso no configurado</Badge>}
                      {!!h.pending_conflicts && <Badge tone="warning">Por revisar</Badge>}
                      {h.has_logged_in && <Badge tone="success">Ya entró</Badge>}
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
    </div>
  );
}
