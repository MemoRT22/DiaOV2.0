import { CheckCircle2, LockOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button } from '../../components/ui';
import { formatDateTime } from '../../lib/catalog';
import { rpc } from '../../lib/adminApi';
import { useEdition } from '../../edition/EditionProvider';
import PhraseConfirmModal from '../PhraseConfirmModal';

export default function RosterStatus() {
  const { edition, reloadEdition } = useEdition();
  const [modal, setModal] = useState<'declare' | 'reopen' | null>(null);
  const [notice, setNotice] = useState('');
  if (!edition) return null;
  const official = edition.roster_status === 'oficial';

  return (
    <section className="card space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-fg-info" aria-hidden />
          <h2 className="text-lg font-semibold">Estado del padrón</h2>
          <Badge tone={official ? 'success' : 'warning'}>{official ? 'Oficial' : 'En preparación'}</Badge>
        </div>
        {official ? (
          <Button variant="secondary" onClick={() => setModal('reopen')}>
            <LockOpen className="h-4 w-4" aria-hidden />
            Reabrir importación
          </Button>
        ) : (
          <Button onClick={() => setModal('declare')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Declarar padrón oficial
          </Button>
        )}
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">
        {official
          ? `Padrón declarado oficial${edition.roster_declared_at ? ` el ${formatDateTime(edition.roster_declared_at)}` : ''}. La plataforma es la fuente de verdad: las correcciones se hacen en cada participante y los nuevos aspirantes se dan de alta con el formulario presencial.`
          : 'Puedes cargar y repetir el CSV de Forms mientras validas el padrón. Cuando esté completo y revisado, declara el padrón oficial.'}
      </p>
      {notice && <Alert tone="success">{notice}</Alert>}

      {modal === 'declare' && (
        <PhraseConfirmModal
          title="Declarar padrón oficial"
          phrase="DECLARAR PADRÓN OFICIAL"
          confirmLabel="Declarar oficial"
          onClose={() => setModal(null)}
          onConfirm={async (phrase) => {
            await rpc('declare_official_roster', { p_phrase: phrase });
            await reloadEdition();
            setModal(null);
            setNotice('El padrón quedó declarado como oficial.');
          }}
        >
          <p>Al declararlo oficial, la carga de archivos de Forms queda bloqueada y la plataforma pasa a ser la fuente de verdad de participantes.</p>
          <p>Las correcciones y las altas presenciales siguen funcionando con normalidad.</p>
        </PhraseConfirmModal>
      )}
      {modal === 'reopen' && (
        <PhraseConfirmModal
          title="Reabrir importación"
          phrase="REABRIR IMPORTACIÓN"
          confirmLabel="Reabrir importación"
          danger
          withReason
          onClose={() => setModal(null)}
          onConfirm={async (phrase, reason) => {
            await rpc('reopen_roster_import', { p_phrase: phrase, p_reason: reason });
            await reloadEdition();
            setModal(null);
            setNotice('La importación quedó reabierta. Vuelve a declarar el padrón oficial al terminar.');
          }}
        >
          <Alert tone="warning">
            Esta es una acción excepcional. Una nueva carga de Forms puede actualizar datos de participantes que ya se están usando en el evento.
          </Alert>
          <p>Quedará registrado quién la reabrió, cuándo y por qué.</p>
        </PhraseConfirmModal>
      )}
    </section>
  );
}
