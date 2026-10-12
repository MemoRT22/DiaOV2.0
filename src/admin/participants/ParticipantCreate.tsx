import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Modal, SelectField } from '../../components/ui';
import HighSchoolPicker from '../../components/HighSchoolPicker';
import type { Career, HighSchool } from '../../lib/catalog';
import { friendlyError } from '../../lib/errors';
import { createParticipant } from '../../lib/participantAdminApi';
import { GRADE_OPTIONS, PERIOD_OPTIONS } from '../../lib/participantFields';

type Props = { careers: Career[]; highSchools: HighSchool[]; onClose: () => void; onCreated: (id: string) => void };

/**
 * Alta manual de un participante por Coordinación. Solo correo y nombre son obligatorios. No se captura
 * consentimiento ni contraseña: el participante acepta el Aviso de Privacidad y configura su acceso al entrar (o
 * Coordinación le genera una contraseña desde su expediente).
 */
export default function ParticipantCreate({ careers, highSchools, onClose, onCreated }: Props) {
  const [values, setValues] = useState({
    email: '', full_name: '', phone: '', high_school_id: '', high_school_grade: '', entry_period: '', initial_career_id: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Empty optional fields are simply not sent.
      const filled = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
      onCreated(await createParticipant({ ...filled, email: values.email.trim(), full_name: values.full_name.trim() }));
    } catch (cause) {
      setError(friendlyError(cause));
      setBusy(false);
    }
  };

  const selectable = careers.filter((c) => c.is_active && !c.is_demo);

  return (
    <Modal title="Nuevo participante" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="ad-modal-form space-y-4">
        <Alert tone="info">
          Al entrar por primera vez, la persona configura su contraseña y acepta el Aviso de Privacidad. Si ya existe un participante con ese correo, no se crea otro.
        </Alert>
        <Field label="Correo" type="email" required value={values.email} onChange={set('email')} autoComplete="off" />
        <Field label="Nombre completo" required minLength={3} maxLength={150} value={values.full_name} onChange={set('full_name')} autoComplete="off" />
        <Field label="Teléfono" type="tel" inputMode="tel" value={values.phone} onChange={set('phone')} autoComplete="off" hint="Opcional" />
        <HighSchoolPicker options={highSchools.filter((h) => h.is_active)} value={values.high_school_id} legacyName=""
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
          {selectable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" loading={busy}>Crear participante</Button>
        </div>
      </form>
    </Modal>
  );
}
