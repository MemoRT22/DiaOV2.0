import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Modal, SelectField } from '../../components/ui';
import { rpc } from '../../lib/adminApi';
import type { Career } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { useTheme } from '../../theme/ThemeProvider';

export type ParticipantValues = {
  email: string;
  full_name: string;
  birth_date: string;
  phone: string;
  high_school: string;
  initial_career_id: string;
  initial_career_id_2: string;
};

export const EMPTY_VALUES: ParticipantValues = { email: '', full_name: '', birth_date: '', phone: '', high_school: '', initial_career_id: '', initial_career_id_2: '' };

type Props = {
  participantId?: string;
  initial: ParticipantValues;
  careers: Career[];
  onClose: () => void;
  onSaved: (id: string) => void;
};

export default function ParticipantForm({ participantId, initial, careers, onClose, onSaved }: Props) {
  const { edition } = useTheme();
  const editing = !!participantId;
  const [values, setValues] = useState(initial);
  const [consent, setConsent] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [emailReason, setEmailReason] = useState('');
  const emailChanged = editing && values.email.trim().toLowerCase() !== initial.email.trim().toLowerCase();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ParticipantValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editing) {
        const changed = Object.fromEntries(
          (Object.keys(values) as (keyof ParticipantValues)[]).filter((k) => values[k] !== initial[k]).map((k) => [k, values[k]]),
        );
        if (Object.keys(changed).length) {
          const payload = emailChanged ? { ...changed, email_reason: emailReason.trim() } : changed;
          await rpc('update_participant', { p_id: participantId, p: payload });
        }
        onSaved(participantId);
      } else {
        const id = await rpc<string>('create_participant_manual', { p: { ...values, consent_confirmed: consent, is_demo: isDemo } });
        if (typeof id !== 'string') throw new Error('SERVER_ERROR');
        onSaved(id);
      }
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const active = editing
    ? careers.filter((c) => c.is_active || c.id === initial.initial_career_id)
    : careers.filter((c) => c.is_active && (isDemo || !c.is_demo));
  const activeForSecond = editing
    ? careers.filter((c) => c.is_active || c.id === initial.initial_career_id_2)
    : careers.filter((c) => c.is_active && (isDemo || !c.is_demo));
  const missingRequired =
    !editing && (['email', 'full_name', 'birth_date', 'phone', 'high_school', 'initial_career_id'] as const).some((k) => !values[k].trim());

  return (
    <Modal title={editing ? 'Corregir datos' : 'Alta presencial de aspirante'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!editing && (
          <p className="text-sm text-ink-muted">
            Para aspirantes que no hicieron el prerregistro. Todos los datos son obligatorios; con su correo y fecha de nacimiento podrá entrar
            desde su teléfono en cuanto lo registres.
          </p>
        )}
        {editing && (
          <Alert tone="info">Los campos que cambies quedan marcados como corrección manual. Si el padrón se vuelve a cargar durante la preparación, no los reemplazará.</Alert>
        )}
        <Field label="Correo" type="email" required value={values.email} onChange={set('email')} autoComplete="off" />
        {emailChanged && (
          <Field
            label="Motivo del cambio de correo"
            value={emailReason}
            onChange={(e) => setEmailReason(e.target.value)}
            maxLength={300}
            placeholder="Ej. el aspirante escribió mal su correo en Forms"
            hint="El correo anterior se guarda solo para reconocer al aspirante si el padrón se vuelve a cargar durante la preparación. No servirá para entrar."
          />
        )}
        <Field label="Nombre completo" required minLength={3} value={values.full_name} onChange={set('full_name')} autoComplete="off" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Fecha de nacimiento"
            type="date"
            required={!editing}
            value={values.birth_date}
            onChange={set('birth_date')}
            hint="Es necesaria para que el aspirante pueda entrar."
          />
          <Field
            label="Teléfono"
            type="tel"
            inputMode="tel"
            required={!editing}
            value={values.phone}
            onChange={set('phone')}
            autoComplete="off"
          />
        </div>
        <Field label="Preparatoria" required={!editing} value={values.high_school} onChange={set('high_school')} autoComplete="off" />
        <SelectField
          label="Carrera de interés inicial"
          required={!editing}
          value={values.initial_career_id}
          onChange={set('initial_career_id')}
        >
          <option value="">{editing ? 'Sin carrera' : 'Elige una carrera del catálogo oficial…'}</option>
          {active.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Segunda carrera de interés (opcional)"
          value={values.initial_career_id_2}
          onChange={set('initial_career_id_2')}
          disabled={!values.initial_career_id}
          hint={values.initial_career_id ? '' : 'Primero elige la carrera principal'}
        >
          <option value="">{editing ? 'Sin segunda carrera' : 'Opcional…'}</option>
          {activeForSecond.filter((c) => c.id !== values.initial_career_id).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {!editing && (
          <div className="space-y-3 rounded-theme border border-line p-4">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary-500" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Consentimiento presencial: el aspirante leyó y aceptó el aviso de privacidad (versión {edition?.privacy_notice_version ?? 'vigente'}).
              </span>
            </label>
            {edition?.mode === 'preparacion' && (
              <label className="flex items-center gap-3 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary-500"
                  checked={isDemo}
                  onChange={(e) => {
                    setIsDemo(e.target.checked);
                    setValues((v) => ({ ...v, initial_career_id: '', initial_career_id_2: '' }));
                  }}
                />
                Es un registro de prueba
              </label>
            )}
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!editing && (!consent || missingRequired)}>
            {editing ? 'Guardar cambios' : 'Dar de alta'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
