import { CheckCircle2, LockOpen, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';

export type AccessState = { failed: number; locked: boolean; locked_until: string | null; last_success: string | null };

type Props = {
  participantId: string;
  hasBirthDate: boolean;
  hasLoggedIn: boolean;
  platformConsentAt: string | null;
  access: AccessState;
  onChanged: () => void;
  /** Opens the data-correction form (to add the birth date, for instance). */
  onCorrect?: () => void;
};

type Check = { ok: boolean; label: string; detail?: string };

/**
 * "This participant can't get in": the diagnosis lives in the expediente, right next to the data that can fix it.
 * Access is blocked by a missing birth date or by a temporary lock after repeated failed attempts.
 */
export default function AccessDiagnosis({ participantId, hasBirthDate, hasLoggedIn, platformConsentAt, access, onChanged, onCorrect }: Props) {
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

  const blocked = !hasBirthDate || access.locked;
  const checks: Check[] = [
    {
      ok: hasBirthDate,
      label: hasBirthDate ? 'Tiene fecha de nacimiento' : 'Falta la fecha de nacimiento',
      detail: hasBirthDate ? undefined : 'Sin ella no puede entrar. Corrige sus datos para agregarla.',
    },
    {
      ok: !access.locked,
      label: access.locked ? 'Bloqueado temporalmente' : 'Sin bloqueo de acceso',
      detail: access.locked
        ? `Por ${access.failed} intentos fallidos${access.locked_until ? `, hasta ${formatDateTime(access.locked_until)}` : ''}`
        : access.failed > 0 ? `${access.failed} intento(s) fallido(s) recientes` : undefined,
    },
  ];

  return (
    <section aria-label="Diagnóstico de acceso" className={`card p-5 ${blocked ? 'border-warning-500/50' : ''}`}>
      <div className="flex items-start gap-3">
        {blocked ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-fg-warning" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-fg-success" aria-hidden />
        )}
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="font-semibold">{blocked ? 'Tiene problemas para entrar' : 'Puede entrar con su correo y fecha de nacimiento'}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {hasLoggedIn
                ? `Ya entró${access.last_success ? ` (último acceso: ${formatDateTime(access.last_success)})` : ''}.`
                : 'Todavía no ha entrado a la plataforma.'}
              {' '}
              {platformConsentAt ? 'Aceptó el aviso de privacidad.' : hasLoggedIn ? 'Aún no acepta el aviso de privacidad.' : ''}
            </p>
          </div>
          <ul className="space-y-1.5">
            {checks.map(({ ok, label, detail }) => (
              <li key={label} className="flex items-start gap-2 text-sm">
                {ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-fg-success" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-fg-error" aria-hidden />
                )}
                <span>
                  <span className="font-medium">{label}</span>
                  {detail && <span className="text-ink-muted"> · {detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {error && <Alert tone="error">{error}</Alert>}
          {(access.locked || (!hasBirthDate && onCorrect)) && (
            <div className="flex flex-wrap gap-3">
              {access.locked && (
                <Button variant="secondary" loading={busy} onClick={unlock}>
                  <LockOpen className="h-4 w-4" aria-hidden />
                  Retirar bloqueo
                </Button>
              )}
              {!hasBirthDate && onCorrect && (
                <Button variant="secondary" onClick={onCorrect}>Corregir datos</Button>
              )}
            </div>
          )}
          {!blocked && (
            <p className="text-xs text-ink-muted">
              Si todo está en orden, confirma que escriba la fecha de nacimiento tal como se registró. No compartas la fecha con el aspirante; pídele que la diga.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
