import { KeyRound, Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Spinner } from '../../components/ui';
import { ROLE_LABELS, staffAccounts } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';
import { friendlyError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { AccountModal, PasswordModal, type StaffAccount } from './StaffModals';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·';

export default function StaffAccounts() {
  const { staff } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const res = await staffAccounts<{ accounts: StaffAccount[] }>({ action: 'list' });
    if (!Array.isArray(res.accounts)) throw new Error('SERVER_ERROR');
    return res.accounts;
  }, []);
  const [editing, setEditing] = useState<StaffAccount | 'new' | null>(null);
  const [resetting, setResetting] = useState<StaffAccount | null>(null);
  const [notice, setNotice] = useState('');

  const saved = (message: string) => {
    setEditing(null);
    setResetting(null);
    setNotice(message);
    reload();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Personal</h1>
          <p className="mt-1 text-sm text-ink-muted">Cuentas de Coordinación, staff y sorteo. Una persona puede tener varios roles.</p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Nueva cuenta
        </Button>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}
      {loading && !data && <Spinner />}
      {!!error && (
        <Alert tone="error">
          {friendlyError(error)}{' '}
          <button className="font-semibold underline" onClick={reload}>
            Reintentar
          </button>
        </Alert>
      )}

      {data && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((a) => (
            <li key={a.user_id} className={`card flex flex-col gap-4 p-5 ${a.is_active ? '' : 'bg-surface-raised'}`}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white shadow-md ring-2 ring-white ${
                    a.is_active ? 'bg-gradient-to-br from-neutral-600 to-neutral-900' : 'bg-neutral-400'
                  }`}
                >
                  {initials(a.full_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`break-words font-semibold leading-snug ${a.is_active ? '' : 'text-ink-muted'}`}>
                    {a.full_name} {a.user_id === staff?.user_id && <span className="text-xs font-normal text-ink-muted">(tú)</span>}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-ink-muted">{a.email}</p>
                </div>
                <div className="-mr-1 -mt-1 flex shrink-0 gap-0.5">
                  <button onClick={() => setEditing(a)} className="rounded-full p-2 text-ink-muted transition-colors hover:bg-neutral-500/10 hover:text-ink" aria-label={`Editar ${a.full_name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setResetting(a)}
                    className="rounded-full p-2 text-ink-muted transition-colors hover:bg-neutral-500/10 hover:text-ink"
                    aria-label={`Cambiar contraseña de ${a.full_name}`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {a.roles.map((r) => (
                  <Badge key={r} tone={r === 'coordinacion' ? 'info' : 'neutral'}>
                    {ROLE_LABELS[r] ?? r}
                  </Badge>
                ))}
                {!a.is_active && <Badge tone="error">Desactivada</Badge>}
                {a.is_demo && <Badge tone="warning">Prueba</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AccountModal
          account={editing === 'new' ? null : editing}
          isSelf={editing !== 'new' && editing.user_id === staff?.user_id}
          onClose={() => setEditing(null)}
          onSaved={() => saved(editing === 'new' ? 'Cuenta creada. Comparte la contraseña temporal en persona.' : 'Cuenta actualizada.')}
        />
      )}
      {resetting && <PasswordModal account={resetting} onClose={() => setResetting(null)} onSaved={() => saved('Contraseña actualizada.')} />}
    </div>
  );
}
