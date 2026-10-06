import { CheckCircle2, Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Modal } from '../../components/ui';
import { formatDateTime } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { resetParticipantPassword } from '../../lib/participantAdminApi';
import { passwordProblem } from '../../lib/participantFields';

type Props = {
  participantId: string;
  accessConfigured: boolean;
  hasLoggedIn: boolean;
  platformConsentAt: string | null;
  onChanged: () => void;
};

type Mode = 'generate' | 'define';

function ResetModal({ participantId, accessConfigured, onClose, onDone }: {
  participantId: string; accessConfigured: boolean; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('generate');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // La contraseña generada vive solo en este estado mientras el operador la ve; al cerrar se descarta.
  const [shown, setShown] = useState<{ generated: boolean; password?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'define' && passwordProblem(password)) return setError(friendlyError(new Error('INVALID_PASSWORD')));
    setBusy(true);
    setError('');
    try {
      const result = await resetParticipantPassword(participantId, mode === 'define' ? password : undefined);
      setPassword('');
      setShown(result.generated ? { generated: true, password: result.password } : { generated: false });
      onDone();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shown?.password) return;
    try {
      await navigator.clipboard.writeText(shown.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (shown) {
    return (
      <Modal title={accessConfigured ? 'Contraseña restablecida' : 'Contraseña configurada'} onClose={onClose}>
        <div className="space-y-4">
          {shown.generated && shown.password ? (
            <>
              <p className="text-sm text-ink-muted">Díctasela o compártela solo con la persona. Se muestra una sola vez y no se guarda en ninguna parte.</p>
              <div className="flex items-center justify-between gap-3 rounded-theme border border-line bg-surface-raised p-4">
                <code aria-label="Contraseña generada" className="select-all break-all font-mono text-xl font-bold tracking-wider">{shown.password}</code>
                <Button type="button" variant="secondary" onClick={copy}>
                  <Copy className="h-4 w-4" aria-hidden />
                  {copied ? 'Copiada' : 'Copiar'}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Listo. La nueva contraseña ya funciona; compártela solo con la persona.</p>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Listo</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Restablecer contraseña" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">
          {accessConfigured
            ? 'La contraseña anterior dejará de funcionar. No se envía ningún correo ni código: tú se la compartes a la persona.'
            : 'Esta persona todavía no tiene contraseña. Puedes crearla aquí; no se envía ningún correo ni código.'}
        </p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Cómo restablecerla</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-theme border border-line p-3 text-sm">
            <input type="radio" name="mode" className="mt-0.5 h-4 w-4 accent-primary-500" checked={mode === 'generate'} onChange={() => setMode('generate')} />
            <span><span className="font-semibold">Generar una contraseña</span><span className="block text-ink-muted">Se crea una contraseña fácil de dictar.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-theme border border-line p-3 text-sm">
            <input type="radio" name="mode" className="mt-0.5 h-4 w-4 accent-primary-500" checked={mode === 'define'} onChange={() => setMode('define')} />
            <span><span className="font-semibold">Definir una contraseña</span><span className="block text-ink-muted">Escribe la que la persona prefiera.</span></span>
          </label>
        </fieldset>
        {mode === 'define' && (
          <Field label="Nueva contraseña" type="password" autoComplete="new-password" required autoFocus value={password}
            onChange={(e) => setPassword(e.target.value)} hint="Entre 8 y 72 caracteres." />
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy}>Restablecer contraseña</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Estado del acceso del participante y restablecimiento de contraseña (Staff y Coordinación). */
export default function PasswordAccess({ participantId, accessConfigured, hasLoggedIn, platformConsentAt, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Acceso a la plataforma" className={`card p-5 ${accessConfigured ? '' : 'border-warning-500/50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {accessConfigured ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-fg-success" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-fg-warning" aria-hidden />
          )}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Acceso a la plataforma</h2>
              <Badge tone={accessConfigured ? 'success' : 'warning'}>{accessConfigured ? 'Cuenta activa' : 'Acceso no configurado'}</Badge>
            </div>
            <p className="text-sm text-ink-muted">
              {accessConfigured
                ? 'Entra con su correo y su contraseña.'
                : 'Todavía no crea su contraseña. Puede hacerlo desde la pantalla de acceso con su correo.'}{' '}
              {hasLoggedIn ? 'Ya entró a la plataforma.' : 'Aún no entra a la plataforma.'}{' '}
              {platformConsentAt ? `Aceptó el aviso de privacidad (${formatDateTime(platformConsentAt)}).` : hasLoggedIn ? 'Aún no acepta el aviso de privacidad.' : ''}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <KeyRound className="h-4 w-4" aria-hidden />
          Restablecer contraseña
        </Button>
      </div>
      {open && <ResetModal participantId={participantId} accessConfigured={accessConfigured} onClose={() => setOpen(false)} onDone={onChanged} />}
    </section>
  );
}
