import { useState } from 'react';
import { ArrowRight, RotateCcw, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/catalog';
import { friendlyError } from '../lib/errors';
import { preparationApi, type PreparationCounts } from '../lib/preparationApi';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { useTheme } from '../theme/ThemeProvider';
import PhraseConfirmModal from './PhraseConfirmModal';

const groups: { key: keyof PreparationCounts; label: string }[] = [
  { key: 'participants', label: 'Participantes' },
  { key: 'proposals', label: 'Propuestas de talleres' },
  { key: 'activities', label: 'Talleres y actividades' },
  { key: 'sessions', label: 'Sesiones' },
  { key: 'reservations', label: 'Reservaciones' },
  { key: 'attendances', label: 'Asistencias' },
  { key: 'interests', label: 'Intereses de carrera' },
  { key: 'imports', label: 'Importaciones' },
  { key: 'raffle_results', label: 'Resultados de sorteo' },
  { key: 'temporary_catalog', label: 'Elementos temporales de catálogo' },
  { key: 'temporary_staff', label: 'Cuentas temporales de personal' },
  { key: 'auth_identities', label: 'Accesos de participantes' },
];

export default function Operation() {
  const { edition, reloadEdition } = useTheme();
  const { data, error, loading, reload } = useLoad(preparationApi.preview, [edition?.mode]);
  const [modal, setModal] = useState<'reset' | 'activate' | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState('');

  if (loading && !data) return <Spinner />;
  if (error || !data || !edition) return <div className="space-y-4"><Alert tone="error">{friendlyError(error)}</Alert><Button variant="secondary" onClick={reload}>Reintentar</Button></div>;

  const real = data.mode === 'operacion_real';
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0) - data.counts.auth_identities;
  const canActivate = data.theme_ready && data.temporary_records_remaining === 0 && data.auth_cleanup_pending === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-primary-500">Coordinación · Puesta en marcha</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Preparación y puesta en marcha</h1>
        <p className="max-w-2xl text-sm text-ink-muted">Prepara el ambiente, reinicia los ensayos cuando lo necesites y activa la operación real al llegar el momento.</p>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}

      <section className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="rounded-theme bg-primary-500/10 p-2 text-primary-500"><ShieldCheck className="h-5 w-5" aria-hidden /></span><h2 className="text-lg font-bold">Estado del evento</h2></div>
          <Badge tone={real ? 'success' : 'warning'}>{real ? 'Operación real' : 'Preparación'}</Badge>
        </div>
        <p className="mt-4 text-sm text-ink-muted">{real
          ? `La operación real está activa desde ${edition.real_operation_at ? formatDateTime(edition.real_operation_at) : 'la activación'}. El ambiente ya no se puede reiniciar.`
          : 'El ambiente está en preparación. Puedes usarlo para ensayar y reiniciarlo antes de cargar la información definitiva.'}</p>
        {!real && data.last_reset_at && <p className="mt-3 text-xs font-semibold text-ink-muted">Último reinicio: {formatDateTime(data.last_reset_at)}</p>}
      </section>

      {!real && <>
        <section className="card p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="rounded-theme bg-warning-500/10 p-2 text-warning-300"><RotateCcw className="h-5 w-5" aria-hidden /></span>
            <div><p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Paso 1</p><h2 className="text-lg font-bold">Reiniciar ambiente de preparación</h2></div>
          </div>
          <p className="mt-4 text-sm text-ink-muted">Se eliminará la actividad generada durante los ensayos. La configuración del evento, la temática, el catálogo oficial, las reglas y las cuentas reales del personal se conservarán.</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-theme border border-line bg-surface-sunken px-4 py-3">
            <span className="text-sm text-ink-muted">Registros operativos por reiniciar</span><strong className="font-display text-2xl">{total}</strong>
          </div>
          <Button className="mt-5" variant="danger" onClick={() => setModal('reset')}><RotateCcw className="h-4 w-4" aria-hidden />Revisar y reiniciar</Button>
          {data.auth_cleanup_pending > 0 && <div className="mt-5 space-y-3"><Alert tone="warning">Quedan {data.auth_cleanup_pending} accesos de participantes pendientes de eliminar. Sus datos y acceso al evento ya fueron retirados.</Alert><Button variant="secondary" onClick={async () => { setBusy(true); setRetryError(''); try { const result = await preparationApi.retryAuthCleanup(); setNotice(result.auth_cleanup.pending ? 'La limpieza de accesos sigue pendiente.' : 'Se completó la limpieza de accesos.'); reload(); } catch (cause) { setRetryError(friendlyError(cause)); } finally { setBusy(false); } }} loading={busy}>Reintentar limpieza de accesos</Button>{retryError && <Alert tone="error">{retryError}</Alert>}</div>}
        </section>

        <section className="card p-6 sm:p-8">
          <div className="flex items-start gap-3"><span className="rounded-theme bg-success-500/10 p-2 text-success-300"><ArrowRight className="h-5 w-5" aria-hidden /></span><div><p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Paso 2</p><h2 className="text-lg font-bold">Activar operación real</h2></div></div>
          <p className="mt-4 text-sm text-ink-muted">Después del reinicio, carga la información definitiva. Cuando la temática esté publicada y todo esté listo, activa la operación real. Este paso es irreversible.</p>
          {!data.theme_ready && <p className="mt-3 text-sm text-warning-300">Publica una temática antes de continuar.</p>}
          {data.temporary_records_remaining > 0 && <p className="mt-3 text-sm text-warning-300">Antes de activar, retira los elementos temporales que aún quedan en el ambiente.</p>}
          {data.auth_cleanup_pending > 0 && <p className="mt-3 text-sm text-warning-300">Completa la limpieza de accesos pendiente antes de activar.</p>}
          <Button className="mt-5" onClick={() => setModal('activate')} disabled={!canActivate}>Activar operación real</Button>
        </section>
      </>}

      {modal === 'reset' && <PhraseConfirmModal title="Confirmar reinicio de preparación" phrase="REINICIAR PREPARACIÓN" confirmLabel="Reiniciar ambiente" danger onClose={() => setModal(null)} onConfirm={async (phrase) => {
        const result = await preparationApi.reset(phrase);
        setModal(null);
        setNotice(result.auth_cleanup.pending !== 0 ? 'El ambiente se reinició. Queda pendiente verificar la limpieza de algunos accesos de participantes.' : 'El ambiente quedó limpio y listo para cargar la información definitiva.');
        reload();
      }}>
        <p>Se eliminará la actividad de esta edición creada durante los ensayos. Esta acción no se puede deshacer.</p>
        <dl className="grid grid-cols-2 gap-2 rounded-theme bg-surface-sunken p-3">
          {groups.filter(({ key }) => data.counts[key] > 0).map(({ key, label }) => <div key={key} className="flex justify-between gap-2 text-sm"><dt>{label}</dt><dd className="font-bold text-ink">{data.counts[key]}</dd></div>)}
          {total === 0 && <p className="col-span-2 text-sm">No hay actividad operativa que retirar. El reinicio quedará registrado.</p>}
        </dl>
        <p>Se conservarán la edición, su temática, las reglas, el catálogo oficial, la configuración del sorteo, el personal real y la auditoría.</p>
      </PhraseConfirmModal>}

      {modal === 'activate' && <PhraseConfirmModal title="Activar operación real" phrase="ACTIVAR OPERACIÓN REAL" confirmLabel="Activar operación real" onClose={() => setModal(null)} onConfirm={async (phrase) => {
        const { error: cause } = await supabase.rpc('activate_real_operation', { p_phrase: phrase });
        if (cause) throw cause;
        setModal(null); setNotice('La operación real está activa.');
        await reloadEdition(); reload();
      }}><p>La temática quedará bloqueada y ya no podrás reiniciar el ambiente de preparación.</p><p>Este paso no se puede revertir.</p></PhraseConfirmModal>}
    </div>
  );
}
