import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { friendlyError } from '../lib/errors';
import { supabase } from '../lib/supabase';

export default function Account() {
  const { staff } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (password.length < 10) return setStatus({ tone: 'error', msg: friendlyError(new Error('WEAK_PASSWORD')) });
    if (password !== confirm) return setStatus({ tone: 'error', msg: friendlyError(new Error('PASSWORD_MISMATCH')) });
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirm('');
      setStatus({ tone: 'success', msg: 'Contraseña actualizada.' });
    } catch (cause) {
      setStatus({ tone: 'error', msg: friendlyError(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Mi cuenta</h1>
        <p className="mt-1 text-sm text-ink-muted">{staff?.full_name}</p>
      </header>
      <form onSubmit={submit} className="card space-y-4 p-6">
        <h2 className="text-lg font-semibold">Cambiar contraseña</h2>
        <Field
          label="Nueva contraseña"
          type="password"
          autoComplete="new-password"
          hint="Mínimo 10 caracteres."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field label="Confirmar contraseña" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {status && <Alert tone={status.tone}>{status.msg}</Alert>}
        <Button type="submit" loading={busy}>
          Guardar
        </Button>
      </form>
    </div>
  );
}
