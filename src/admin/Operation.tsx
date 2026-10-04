import { useState } from 'react';
import { Alert, Badge, Button, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';
import PhraseConfirmModal from './PhraseConfirmModal';

type Counts = Record<'participants' | 'attendances' | 'sessions' | 'activities' | 'careers' | 'divisions' | 'staff', number>;
type Preview = { mode: string; counts: Counts; blockers: { kind: string; count: number }[] };

const COUNT_LABELS: Record<keyof Counts, string> = {
  participants: 'Participantes de prueba',
  attendances: 'Asistencias de prueba',
  sessions: 'Horarios de prueba',
  activities: 'Talleres de prueba',
  careers: 'Carreras de prueba',
  divisions: 'Divisiones de prueba',
  staff: 'Cuentas de personal de prueba (se desactivan)',
};

const BLOCKER_LABELS: Record<string, string> = {
  real_participant_demo_career: 'participantes reales tienen como carrera inicial una carrera de prueba',
  real_interest_demo_career: 'intereses de participantes reales apuntan a carreras de prueba',
  real_career_demo_division: 'carreras reales pertenecen a una división de prueba',
  real_activity_demo_division: 'talleres reales pertenecen a una división de prueba',
  real_session_demo_activity: 'horarios reales pertenecen a un taller de prueba',
  real_attendance_demo_session: 'asistencias de participantes reales están en horarios de prueba',
};

export default function Operation() {
  const { edition, reloadEdition } = useTheme();
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: p, error: e } = await supabase.rpc('demo_purge_preview');
    if (e) throw e;
    if (!p || !p.counts || !Array.isArray(p.blockers)) throw new Error('INVALID_PREVIEW');
    return p as Preview;
  }, [edition?.mode]);
  const [modal, setModal] = useState<'purge' | 'activate' | null>(null);
  const [notice, setNotice] = useState('');

  if (loading) return <Spinner />;
  if (error || !data || !edition) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{friendlyError(error)}</Alert>
        <Button variant="secondary" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  const real = edition.mode === 'operacion_real';
  const totalDemo = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const blocked = data.blockers.length > 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Operación y datos de prueba</h1>
        <p className="mt-1 text-sm text-ink-muted">Controla el paso de preparación a operación real del evento.</p>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Modo actual</h2>
          <Badge tone={real ? 'success' : 'warning'}>{real ? 'Operación real' : 'Preparación'}</Badge>
        </div>
        {real ? (
          <p className="text-sm text-ink-muted">
            Activada el {edition.real_operation_at ? formatDateTime(edition.real_operation_at) : '—'}. Este cambio es definitivo: la
            temática queda bloqueada, las reglas de rangos no se pueden modificar y la limpieza de datos de prueba ya no está disponible.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Antes de activar la operación real debes retirar todos los datos de prueba y tener una temática publicada. La activación
              es definitiva y queda registrada en la auditoría.
            </p>
            <Button onClick={() => setModal('activate')} disabled={totalDemo > 0}>
              Activar operación real
            </Button>
            {totalDemo > 0 && <p className="text-xs text-warning-300">Primero retira los datos de prueba.</p>}
          </>
        )}
      </section>

      {!real && (
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Retirar datos de prueba</h2>
          <p className="text-sm text-ink-muted">
            Solo se eliminan registros marcados como prueba. Los participantes importados o dados de alta como reales nunca se tocan.
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(COUNT_LABELS) as (keyof Counts)[]).map((k) => (
              <div key={k} className="flex items-center justify-between rounded-theme border border-line bg-surface-sunken px-4 py-3">
                <dt className="text-sm text-ink-muted">{COUNT_LABELS[k]}</dt>
                <dd className="font-display text-lg font-extrabold">{data.counts[k]}</dd>
              </div>
            ))}
          </dl>
          {blocked && (
            <Alert tone="error">
              <p className="font-semibold">No se puede limpiar todavía porque hay datos reales ligados a datos de prueba:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.blockers.map((b) => (
                  <li key={b.kind}>
                    {b.count} {BLOCKER_LABELS[b.kind] ?? 'registros reales dependen de datos de prueba'}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <Button variant="danger" onClick={() => setModal('purge')} disabled={blocked || totalDemo === 0}>
            {totalDemo === 0 ? 'No hay datos de prueba' : 'Retirar datos de prueba'}
          </Button>
        </section>
      )}

      {modal === 'purge' && (
        <PhraseConfirmModal
          title="Retirar datos de prueba"
          phrase="BORRAR DATOS DE PRUEBA"
          confirmLabel="Retirar definitivamente"
          danger
          onClose={() => setModal(null)}
          onConfirm={async (phrase) => {
            const { error: e } = await supabase.rpc('purge_demo_data', { p_phrase: phrase });
            if (e) throw e;
            setModal(null);
            setNotice('Los datos de prueba se retiraron correctamente.');
            reload();
          }}
        >
          <p>Se eliminarán {totalDemo} registros de prueba. Esta acción no se puede deshacer y quedará registrada.</p>
        </PhraseConfirmModal>
      )}

      {modal === 'activate' && (
        <PhraseConfirmModal
          title="Activar operación real"
          phrase="ACTIVAR OPERACIÓN REAL"
          confirmLabel="Activar"
          onClose={() => setModal(null)}
          onConfirm={async (phrase) => {
            const { error: e } = await supabase.rpc('activate_real_operation', { p_phrase: phrase });
            if (e) throw e;
            setModal(null);
            setNotice('La operación real está activa.');
            await reloadEdition();
          }}
        >
          <p>A partir de este momento la temática quedará bloqueada y ya no se podrán cargar ni limpiar datos de prueba.</p>
          <p>Este paso no se puede revertir.</p>
        </PhraseConfirmModal>
      )}
    </div>
  );
}
