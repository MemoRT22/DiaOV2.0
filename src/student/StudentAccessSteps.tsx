import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Field, SelectField, Spinner } from '../components/ui';
import HighSchoolPicker from '../components/HighSchoolPicker';
import { useEdition } from '../edition/EditionProvider';
import { isTemporaryAccessError } from '../lib/accessErrors';
import { friendlyError } from '../lib/errors';
import { GRADE_OPTIONS, PERIOD_OPTIONS, passwordProblem } from '../lib/participantFields';
import { studentAccess, type AccessCatalog, type CatalogCareer } from '../lib/studentAccess';
import AccessNotice from './AccessNotice';
import { useAccessAttempt } from './useAccessAttempt';

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
  const attempt = useAccessAttempt();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void attempt.run(async (signal) => {
      const clean = email.trim().toLowerCase();
      onContinue(clean, await studentAccess.identify(clean, { signal }));
    });
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
      {attempt.saturation && <AccessNotice saturation={attempt.saturation} busy={attempt.busy} onRetry={() => void attempt.retry()} />}
      {attempt.error && <Alert tone="error">{attempt.error}</Alert>}
      {!attempt.saturation && <Button type="submit" className="w-full" loading={attempt.busy}>Continuar</Button>}
    </Form>
  );
}

export function LoginStep({ email, onBack, onSignIn, notice }: {
  email: string; onBack: () => void; onSignIn: (password: string, signal?: AbortSignal) => Promise<void>; notice?: string;
}) {
  const [password, setPassword] = useState('');
  const attempt = useAccessAttempt();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void attempt.run((signal) => onSignIn(password, signal));
  };
  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Ingresa tu contraseña</h2>
        <ChangeEmail email={email} onBack={onBack} />
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
      <Field label="Contraseña" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      {attempt.saturation && <AccessNotice saturation={attempt.saturation} busy={attempt.busy} onRetry={() => void attempt.retry()} />}
      {attempt.error && <Alert tone="error">{attempt.error}</Alert>}
      {!attempt.saturation && <Button type="submit" className="w-full" loading={attempt.busy}>Entrar</Button>}
      <p className="text-center text-xs text-ink-muted">¿No recuerdas tu contraseña? Pide apoyo al personal del evento.</p>
    </Form>
  );
}

/**
 * Crear contraseña = dos pasos: crear la cuenta (una sola vez) y entrar. Si la cuenta ya se creó y solo falló la entrada (límite,
 * red), «Volver a intentar» repite SOLO la entrada con la misma contraseña; nunca se vuelve a crear ni se pierde lo escrito.
 */
export function SetupStep({ email, onBack, onCreate, onSignIn, onExistingAccount }: {
  email: string; onBack: () => void;
  onCreate: (password: string, signal?: AbortSignal) => Promise<void>;
  onSignIn: (password: string, signal?: AbortSignal) => Promise<void>;
  /** La cuenta ya tenía contraseña y no es la que se escribió: se pasa a «iniciar sesión» con el mismo correo. */
  onExistingAccount: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  // Refs (no estado): «Volver a intentar» repite la tarea guardada y esta debe ver siempre lo último, no una copia vieja.
  const createdRef = useRef<string | null>(null);
  const uncertain = useRef(false);
  const attempt = useAccessAttempt();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (createdRef.current === null) {
      const invalid = validatePasswords(password, confirm);
      if (invalid) return attempt.setError(invalid);
    }
    void attempt.run(async (signal) => {
      if (createdRef.current === null) {
        try {
          await onCreate(password, signal);
          createdRef.current = password;
          setCreated(password);
        } catch (cause) {
          if (isTemporaryAccessError(cause)) uncertain.current = true; // el servidor pudo haberlo completado aunque no lo supimos
          if (uncertain.current && cause instanceof Error && cause.message === 'ACCESS_ALREADY_CONFIGURED') {
            // Casi seguro es nuestro intento anterior: se prueba con la contraseña escrita. Si no es esa, la cuenta es de otra contraseña.
            try { await onSignIn(password, signal); return; } catch (second) {
              if (second instanceof Error && second.message === 'INVALID_CREDENTIALS') return onExistingAccount();
              throw second;
            }
          }
          throw cause;
        }
      }
      await onSignIn(createdRef.current ?? password, signal);
    });
  };
  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Encontramos tu prerregistro</h2>
        <p className="mt-1 text-sm text-ink-muted">Crea una contraseña para entrar a la plataforma.</p>
        <ChangeEmail email={email} onBack={onBack} />
      </div>
      <fieldset disabled={created !== null} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <PasswordPair password={password} confirm={confirm} setPassword={setPassword} setConfirm={setConfirm} />
      </fieldset>
      {created !== null && <Alert tone="success">Tu contraseña ya quedó creada. Solo falta entrar.</Alert>}
      {attempt.saturation && <AccessNotice saturation={attempt.saturation} busy={attempt.busy} onRetry={() => void attempt.retry()} />}
      {attempt.error && <Alert tone="error">{attempt.error}</Alert>}
      {!attempt.saturation && <Button type="submit" className="w-full" loading={attempt.busy}>{created === null ? 'Crear contraseña y entrar' : 'Entrar'}</Button>}
    </Form>
  );
}

type RegisterValues = {
  first_name: string; last_name: string; phone: string; high_school_id: string; high_school_grade: string;
  entry_period: string; initial_career_id: string;
};
const EMPTY: RegisterValues = { first_name: '', last_name: '', phone: '', high_school_id: '', high_school_grade: '', entry_period: '', initial_career_id: '' };

/** Autorregistro: exactamente los campos del Forms, con el Aviso de Privacidad como paso obligatorio. */
export function RegisterStep({ email, onBack, onCreate, onSignIn, onExistingAccount }: {
  email: string; onBack: () => void;
  onCreate: (data: RegisterValues & { password: string; consent_accepted: true }, signal?: AbortSignal) => Promise<void>;
  onSignIn: (password: string, signal?: AbortSignal) => Promise<void>;
  /** El correo ya tiene cuenta y no es la contraseña escrita: se pasa a «iniciar sesión» con el mismo correo. */
  onExistingAccount: () => void;
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
  const [locked, setLocked] = useState(false);
  const registered = useRef<string | null>(null); // contraseña con la que ya se creó la cuenta
  const uncertain = useRef(false);
  const access = useAccessAttempt();

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController(); // si abandona la pantalla, no se sigue pidiendo el catálogo en segundo plano
    setCatalogError('');
    studentAccess.catalog({ signal: controller.signal }).then(
      (snapshot) => { if (!cancelled) setCatalog(snapshot); },
      (cause) => { if (!cancelled) setCatalogError(friendlyError(cause)); },
    );
    return () => { cancelled = true; controller.abort(); };
  }, [attempt]);

  const byDivision = useMemo(() => {
    const groups = new Map<string, CatalogCareer[]>();
    for (const career of careers ?? []) groups.set(career.division ?? 'Otras', [...(groups.get(career.division ?? 'Otras') ?? []), career]);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [careers]);

  const set = (key: keyof RegisterValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (registered.current === null) {
      if (!catalog?.high_schools.some((school) => school.id === values.high_school_id)) return access.setError(friendlyError(new Error('INVALID_HIGH_SCHOOL')));
      if (!consent) return access.setError(friendlyError(new Error('CONSENT_REQUIRED')));
      const invalid = validatePasswords(password, confirm);
      if (invalid) return access.setError(invalid);
    }
    // Registrar es un solo envío; si ya se creó la cuenta y solo falló la entrada, el reintento repite SOLO la entrada.
    void access.run(async (signal) => {
      if (registered.current === null) {
        try {
          await onCreate({ ...values, password, consent_accepted: true }, signal);
          registered.current = password;
          setLocked(true);
        } catch (cause) {
          if (isTemporaryAccessError(cause)) uncertain.current = true; // pudo haberse creado aunque no lo supimos
          if (uncertain.current && cause instanceof Error && cause.message === 'EMAIL_EXISTS') {
            try { await onSignIn(password, signal); return; } catch (second) {
              if (second instanceof Error && second.message === 'INVALID_CREDENTIALS') return onExistingAccount();
              throw second;
            }
          }
          throw cause;
        }
      }
      await onSignIn(registered.current ?? password, signal);
    });
  };

  return (
    <Form onSubmit={submit}>
      <div>
        <h2 className="text-xl font-extrabold">Regístrate</h2>
        <p className="mt-1 text-sm text-ink-muted">No encontramos un prerregistro con este correo. Puedes registrarte ahora.</p>
      </div>
      <fieldset disabled={locked} className="m-0 min-w-0 space-y-4 border-0 p-0">
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
      </fieldset>

      {locked && <Alert tone="success">Tu registro ya quedó guardado. Solo falta entrar.</Alert>}
      {access.saturation && <AccessNotice saturation={access.saturation} busy={access.busy} onRetry={() => void access.retry()} />}
      {access.error && <Alert tone="error">{access.error}</Alert>}
      {!access.saturation && <Button type="submit" className="w-full" loading={access.busy} disabled={!consent || !careers}>{locked ? 'Entrar' : 'Registrarme y entrar'}</Button>}
    </Form>
  );
}
