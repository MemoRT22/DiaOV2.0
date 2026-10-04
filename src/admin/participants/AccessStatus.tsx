import { CheckCircle2, LockOpen, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';

export type AccessState = { failed: number; locked: boolean; locked_until: string | null; last_success: string | null };

type Props = { participantId: string; hasBirthDate: boolean; access: AccessState; onChanged: () => void };

export default function AccessStatus({ participantId, hasBirthDate, access, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      await rpc('clear_access_lock', { p_id: participantId });
      onChanged();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const problems: string[] = [];
  if (!hasBirthDate) problems.push('No tiene fecha de nacimiento registrada, así que no puede entrar. Corrige sus datos para agregarla.');
  if (access.locked)
    problems.push(
      `Está bloqueado temporalmente por ${access.failed} intentos fallidos${access.locked_until ? ` (hasta ${formatDateTime(access.locked_until)})` : ''}.`,
    );

  return (
    <section className={`card p-5 ${problems.length ? 'border-warning-500/50' : ''}`}>
      <div className="flex items-start gap-3">
        {problems.length ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-400" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-400" aria-hidden />
        )}
        <div className="flex-1 space-y-2">
          <h2 className="font-semibold">{problems.length ? 'Tiene problemas para entrar' : 'Puede entrar con su correo y fecha de nacimiento'}</h2>
          {problems.map((p) => (
            <p key={p} className="text-sm text-ink-muted">
              {p}
            </p>
          ))}
          {!problems.length && (
            <p className="text-sm text-ink-muted">
              {access.failed > 0 ? `${access.failed} intento(s) fallido(s) recientes. ` : ''}
              {access.last_success ? `Último acceso: ${formatDateTime(access.last_success)}.` : 'Todavía no ha entrado.'}
            </p>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          {access.locked && (
            <Button variant="secondary" loading={busy} onClick={unlock}>
              <LockOpen className="h-4 w-4" aria-hidden />
              Retirar bloqueo
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
