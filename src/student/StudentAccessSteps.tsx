import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Field, SelectField, Spinner } from '../components/ui';
import HighSchoolPicker from '../components/HighSchoolPicker';
import { useEdition } from '../edition/EditionProvider';
import { friendlyError } from '../lib/errors';
import { GRADE_OPTIONS, PERIOD_OPTIONS, passwordProblem } from '../lib/participantFields';
import { studentAccess, type AccessCatalog, type CatalogCareer } from '../lib/studentAccess';

const Form = ({ onSubmit, children }: { onSubmit: (e: FormEvent) => void; children: ReactNode }) => (
  <form onSubmit={onSubmit} className="space-y-4">
    {children}
  </form>
);

function ChangeEmail({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <p className="text-sm text-ink-muted">
      <span className="font-semibold text-ink">{email}</span>{' '}
      <button type="button" onClick={onBack} className="font-semibold text-secondary-300 underline underline-offset-4">
        Cambiar correo
      </button>
    </p>
  );
}

function PasswordPair({ password, confirm, setPassword, setConfirm }: {
  password: string; confirm: string; setPassword: (v: string) => void; setConfirm: (v: string) => void;
}) {
  return (
    <>
      <Field
        label="Contraseña"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="Mínimo 8 caracteres."
      />
      <Field
        label="Confirmar contraseña"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
    </>
  );
}

function validatePasswords(password: string, confirm: string): string {
  const problem = passwordProblem(password);
  if (problem) return friendlyError(new Error(problem));
  if (password !== confirm) return friendlyError(new Error('PASSWORD_MISMATCH'));
  return '';
}

/** Un solo campo: el sistema decide qué sigue (iniciar sesión, crear contraseña o registrarse). */
export function EmailStep({ title, initial, onContinue }: { title: string; initial: string; onContinue: (email: string, state: Awaited<ReturnType<typeof studentAccess.identify>>) => void }) {
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const clean = email.trim().toLowerCase();
      onContinue(clean, await studentAccess.identify(clean));
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">{title}</h2>
        <p className="mt-1 text-sm text-ink-muted">Escribe tu correo electrónico para continuar.</p>
      </div>
      <Field
        label="Correo electrónico"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tucorreo@ejemplo.com"
      />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>Continuar</Button>
    </Form>
  );
}

export function LoginStep({ email, onBack, onSignIn }: { email: string; onBack: () => void; onSignIn: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSignIn(password);
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Ingresa tu contraseña</h2>
        <ChangeEmail email={email} onBack={onBack} />
      </div>
      <Field label="Contraseña" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>Entrar</Button>
      <p className="text-center text-xs text-ink-muted">¿No recuerdas tu contraseña? Pide apoyo al personal del evento.</p>
    </Form>
  );
}

export function SetupStep({ email, onBack, onSetup }: { email: string; onBack: () => void; onSetup: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const invalid = validatePasswords(password, confirm);
    if (invalid) return setError(invalid);
    setError('');
    setBusy(true);
    try {
      await onSetup(password);
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Encontramos tu prerregistro</h2>
        <p className="mt-1 text-sm text-ink-muted">Crea una contraseña para entrar a la plataforma.</p>
        <ChangeEmail email={email} onBack={onBack} />
      </div>
      <PasswordPair password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy}>Crear contraseña y entrar</Button>
    </Form>
  );
}

type RegisterValues = {
  first_name: string; last_name: string; phone: string; high_school_id: string; high_school_grade: string;
  entry_period: string; initial_career_id: string;
};
const EMPTY: RegisterValues = { first_name: '', last_name: '', phone: '', high_school_id: '', high_school_grade: '', entry_period: '', initial_career_id: '' };

/** Autorregistro: exactamente los campos del Forms, con el Aviso de Privacidad como paso obligatorio. */
export function RegisterStep({ email, onBack, onRegister }: {
  email: string; onBack: () => void; onRegister: (data: RegisterValues & { password: string; consent_accepted: true }) => Promise<void>;
}) {
  const { edition } = useEdition();
  const [values, setValues] = useState(EMPTY);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const careers = catalog?.careers ?? null;
  const [catalogError, setCatalogError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCatalogError('');
    studentAccess.catalog().then(
      (snapshot) => { if (!cancelled) setCatalog(snapshot); },
      (cause) => { if (!cancelled) setCatalogError(friendlyError(cause)); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  const byDivision = useMemo(() => {
    const groups = new Map<string, CatalogCareer[]>();
    for (const career of careers ?? []) groups.set(career.division ?? 'Otras', [...(groups.get(career.division ?? 'Otras') ?? []), career]);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [careers]);

  const set = (key: keyof RegisterValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!catalog?.high_schools.some((school) => school.id === values.high_school_id)) return setError(friendlyError(new Error('INVALID_HIGH_SCHOOL')));
    if (!consent) return setError(friendlyError(new Error('CONSENT_REQUIRED')));
    const invalid = validatePasswords(password, confirm);
    if (invalid) return setError(invalid);
    setError('');
    setBusy(true);
    try {
      await onRegister({ ...values, password, consent_accepted: true });
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Regístrate</h2>
        <p className="mt-1 text-sm text-ink-muted">No encontramos un prerregistro con este correo. Puedes registrarte ahora.</p>
      </div>
      <Field label="Nombre" required autoComplete="given-name" maxLength={75} value={values.first_name} onChange={set('first_name')} />
      <Field label="Apellidos" required autoComplete="family-name" maxLength={75} value={values.last_name} onChange={set('last_name')} />
      <Field label="Correo" type="email" readOnly value={email} hint="Si no es tu correo, cámbialo." />
      <button type="button" onClick={onBack} className="-mt-2 text-sm font-semibold text-secondary-300 underline underline-offset-4">
        Cambiar correo
      </button>
      <Field label="Teléfono con WhatsApp" type="tel" inputMode="tel" autoComplete="tel" required value={values.phone} onChange={set('phone')} />
      {catalog && <HighSchoolPicker options={catalog.high_schools} value={values.high_school_id} onChange={(id) => setValues((v) => ({ ...v, high_school_id: id }))} label="Escuela/preparatoria" required />}
      <SelectField label="Grado" required value={values.high_school_grade} onChange={set('high_school_grade')}>
        <option value="">Elige tu grado…</option>
        {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </SelectField>
      <SelectField label="Periodo de interés" required value={values.entry_period} onChange={set('entry_period')}>
        <option value="">Elige el periodo…</option>
        {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </SelectField>
      {catalogError ? (
        <Alert tone="error">
          {catalogError}{' '}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold underline underline-offset-4">Reintentar</button>
        </Alert>
      ) : !careers ? (
        <Spinner label="Cargando licenciaturas" />
      ) : (
        <SelectField label="Licenciatura" required value={values.initial_career_id} onChange={set('initial_career_id')}>
          <option value="">Elige la licenciatura de tu interés…</option>
          {byDivision.map(([division, list]) => (
            <optgroup key={division} label={division}>
              {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </SelectField>
      )}
      <PasswordPair password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />

      <section className="space-y-2 rounded-theme border border-line p-4" aria-label="Aviso de Privacidad">
        <h3 className="text-sm font-semibold">Aviso de Privacidad</h3>
        {edition?.privacy_notice_summary && <p className="text-xs text-ink-muted">{edition.privacy_notice_summary}</p>}
        {edition?.privacy_notice_url && (
          <a href={edition.privacy_notice_url} target="_blank" rel="noopener noreferrer"
            className="inline-block text-sm font-semibold text-secondary-300 underline underline-offset-4">
            Leer el Aviso de Privacidad completo
          </a>
        )}
        <label className="flex cursor-pointer items-start gap-3 pt-1 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-primary-500))]" />
          <span>He leído y acepto el Aviso de Privacidad.</span>
        </label>
      </section>

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" className="w-full" loading={busy} disabled={!consent || !careers}>Registrarme y entrar</Button>
    </Form>
  );
}
