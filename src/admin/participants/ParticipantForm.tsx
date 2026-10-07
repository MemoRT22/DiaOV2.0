import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Modal, SelectField } from '../../components/ui';
import HighSchoolPicker from '../../components/HighSchoolPicker';
import { rpc } from '../../lib/adminApi';
import type { Career, HighSchool } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { GRADE_OPTIONS, PERIOD_OPTIONS } from '../../lib/participantFields';

export type ParticipantValues = {
  email: string;
  full_name: string;
  phone: string;
  high_school: string;
  high_school_id: string;
  high_school_grade: string;
  entry_period: string;
  initial_career_id: string;
};

type Props = {
  participantId: string;
  initial: ParticipantValues;
  careers: Career[];
  highSchools: HighSchool[];
  canEditHighSchool: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
};

/**
 * Corregir los datos de un participante existente. Los participantes nuevos ya no se dan de alta aquí: llegan por la
 * importación oficial de Forms o se registran solos desde la pantalla de acceso.
 */
export default function ParticipantForm({ participantId, initial, careers, highSchools, canEditHighSchool, onClose, onSaved }: Props) {
  const [values, setValues] = useState(initial);
  const [emailReason, setEmailReason] = useState('');
  const emailChanged = values.email.trim().toLowerCase() !== initial.email.trim().toLowerCase();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ParticipantValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const changed = Object.fromEntries(
        (Object.keys(values) as (keyof ParticipantValues)[]).filter((k) => k !== 'high_school' && values[k] !== initial[k]).map((k) => [k, values[k]]),
      );
      if (Object.keys(changed).length) {
        const payload = emailChanged ? { ...changed, email_reason: emailReason.trim() } : changed;
        await rpc('update_participant', { p_id: participantId, p: payload });
      }
      onSaved(participantId);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectable = careers.filter((c) => c.is_active || c.id === initial.initial_career_id);

  return (
    <Modal title="Corregir datos" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert tone="info">Los campos que cambies quedan marcados como corrección manual. Si vuelves a importar el CSV, no se reemplazarán.</Alert>
        <Field label="Correo" type="email" required value={values.email} onChange={set('email')} autoComplete="off" />
        {emailChanged && (
          <Field
            label="Motivo del cambio de correo"
            value={emailReason}
            onChange={(e) => setEmailReason(e.target.value)}
            maxLength={300}
            placeholder="Ej. el aspirante escribió mal su correo en Forms"
            hint="El correo anterior se guarda para reconocer al aspirante en futuras importaciones. No servirá para entrar."
          />
        )}
        <Field label="Nombre completo" required minLength={3} value={values.full_name} onChange={set('full_name')} autoComplete="off" />
        <Field label="Teléfono" type="tel" inputMode="tel" value={values.phone} onChange={set('phone')} autoComplete="off" />
        <HighSchoolPicker options={highSchools} value={values.high_school_id} legacyName={values.high_school} disabled={!canEditHighSchool}
          onChange={(id) => setValues((v) => ({ ...v, high_school_id: id }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Grado" value={values.high_school_grade} onChange={set('high_school_grade')}>
            <option value="">Sin dato</option>
            {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectField>
          <SelectField label="Periodo de interés" value={values.entry_period} onChange={set('entry_period')}>
            <option value="">Sin dato</option>
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectField>
        </div>
        <SelectField label="Carrera de interés inicial" value={values.initial_career_id} onChange={set('initial_career_id')}>
          <option value="">Sin carrera</option>
          {selectable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Modal>
  );
}
