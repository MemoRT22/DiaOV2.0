import { Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Field } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import { friendlyError } from '../../lib/errors';
import AccessStatus, { type AccessState } from './AccessStatus';

type Diagnosis =
  | { found: false }
  | { found: true; participant_id: string; full_name: string; has_birth_date: boolean; has_logged_in: boolean; access: AccessState };

export default function AccessHelp() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [checked, setChecked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const diagnose = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await rpc<Diagnosis>('access_diagnosis', { p_email: value });
      if (!data || typeof data.found !== 'boolean') throw new Error('SERVER_ERROR');
      setResult(data);
      setChecked(value);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (value) diagnose(value);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Ayuda de acceso</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Escribe el correo con el que el aspirante intenta entrar para saber qué le impide el acceso.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          className="flex-1"
          label="Correo del aspirante"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" loading={busy}>
          <Search className="h-4 w-4" aria-hidden />
          Revisar
        </Button>
      </form>

      {error && <Alert tone="error">{error}</Alert>}

      {result && !result.found && (
        <Alert tone="warning">
          No hay ningún registro con <strong>{checked}</strong>. Pregunta si usó otro correo o búscalo por nombre en{' '}
          <Link to="../participantes" relative="path" className="font-semibold underline">
            Participantes
          </Link>
          . Si no aparece, puedes darlo de alta ahí mismo.
        </Alert>
      )}

      {result && result.found && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{result.full_name}</p>
            <Link to={`../participantes/${result.participant_id}`} relative="path" className="text-sm font-semibold text-secondary-300 hover:underline">
              Ver expediente
            </Link>
          </div>
          <AccessStatus
            participantId={result.participant_id}
            hasBirthDate={result.has_birth_date}
            access={result.access}
            onChanged={() => diagnose(checked)}
          />
          <p className="text-xs text-ink-muted">
            Si todo está en orden, confirma que escriba la fecha de nacimiento tal como se registró. No compartas la fecha con el aspirante; pídele que la diga.
          </p>
        </div>
      )}
    </div>
  );
}
