import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Modal } from '../../components/ui';
import { ROLE_LABELS, staffAccounts } from '../../lib/adminApi';
import type { StaffRole } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';

export type StaffAccount = {
  user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_demo: boolean;
  created_at: string;
  roles: StaffRole[];
};

const ROLE_HELP: Record<StaffRole, string> = {
  coordinacion: 'Todo el panel: importaciones, catálogo, exportación, personal y operación.',
  staff: 'Buscar participantes, dar de alta, corregir datos y resolver accesos.',
  sorteo: 'Reservado para el sorteo. Por ahora no tiene pantallas.',
};

function useSubmit(action: () => Promise<unknown>, onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await action();
      onSaved();
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

type AccountProps = { account: StaffAccount | null; isSelf: boolean; onClose: () => void; onSaved: () => void };

export function AccountModal({ account, isSelf, onClose, onSaved }: AccountProps) {
  const [fullName, setFullName] = useState(account?.full_name ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>(account?.roles ?? ['staff']);
  const [active, setActive] = useState(account?.is_active ?? true);
  const { busy, error, submit } = useSubmit(
    () =>
      account
        ? staffAccounts({ action: 'update', user_id: account.user_id, full_name: fullName.trim(), roles, is_active: active })
        : staffAccounts({ action: 'create', email: email.trim().toLowerCase(), full_name: fullName.trim(), roles, password }),
    onSaved,
  );

  const toggle = (role: StaffRole) => setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <Modal title={account ? 'Editar cuenta' : 'Nueva cuenta del personal'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        {account ? (
          <p className="text-sm text-ink-muted">Correo: {account.email}</p>
        ) : (
          <>
            <Field label="Correo" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Field
              label="Contraseña temporal"
              type="text"
              autoComplete="new-password"
              hint="Mínimo 10 caracteres. La persona puede cambiarla en Mi cuenta."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
            />
          </>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Roles</legend>
          {(Object.keys(ROLE_HELP) as StaffRole[]).map((role) => (
            <label key={role} className="flex items-start gap-3 rounded-theme border border-line p-3 text-sm has-[:checked]:border-primary-500/60">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                onChange={() => toggle(role)}
                disabled={isSelf && role === 'coordinacion'}
                className="mt-0.5 h-5 w-5 accent-primary-500"
              />
              <span>
                <span className="font-semibold">{ROLE_LABELS[role]}</span>
                <span className="block text-xs text-ink-muted">{ROLE_HELP[role]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {account && !isSelf && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mt-0.5 h-5 w-5 accent-primary-500" />
            <span>
              Cuenta activa
              <span className="block text-xs text-ink-muted">Una cuenta desactivada no puede iniciar sesión. Su historial se conserva.</span>
            </span>
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={roles.length === 0}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type PasswordProps = { account: StaffAccount; onClose: () => void; onSaved: () => void };

export function PasswordModal({ account, onClose, onSaved }: PasswordProps) {
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(() => staffAccounts({ action: 'reset_password', user_id: account.user_id, password }), onSaved);

  return (
    <Modal title={`Nueva contraseña para ${account.full_name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Contraseña temporal"
          type="text"
          autoComplete="new-password"
          hint="Mínimo 10 caracteres. Compártela en persona."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          required
        />
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Cambiar contraseña
          </Button>
        </div>
      </form>
    </Modal>
  );
}
