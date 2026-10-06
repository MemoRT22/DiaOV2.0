import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import type { Career } from '../../lib/catalog';
import ParticipantForm, { type ParticipantValues } from './ParticipantForm';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));

const careers = [
  { id: 'c-1', code: 'PSI', name: 'Psicología', division_id: 'd', is_active: true, is_demo: false },
  { id: 'c-2', code: 'DER', name: 'Derecho', division_id: 'd', is_active: true, is_demo: false },
  { id: 'c-3', code: 'OLD', name: 'Carrera retirada', division_id: 'd', is_active: false, is_demo: false },
] as unknown as Career[];
const initial: ParticipantValues = {
  email: 'ana@correo.com', full_name: 'Ana López', phone: '9981234567', high_school: 'Colegio Ejemplo', high_school_id: 'h-1',
  high_school_grade: '3', entry_period: '2027-08', initial_career_id: 'c-1',
};

const onSaved = vi.fn();
const show = (values = initial) => render(<ParticipantForm participantId="p-1" initial={values} careers={careers} highSchools={[{ id: 'h-1', name: 'Colegio Ejemplo', is_active: true }, { id: 'h-2', name: 'Otra escuela', is_active: true }]} canEditHighSchool onClose={() => undefined} onSaved={onSaved} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rpc).mockResolvedValue(undefined as never);
});

test('is an edit form: name, email, phone, school, grade, period and initial career; no birth date and no signup mode', () => {
  show();
  expect(screen.getByRole('dialog', { name: 'Corregir datos' })).toBeInTheDocument();
  for (const label of ['Correo', 'Nombre completo', 'Teléfono', 'Escuela / preparatoria', 'Grado', 'Periodo de interés', 'Carrera de interés inicial']) {
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  }
  expect(screen.queryByLabelText(/nacimiento/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Alta presencial|Dar de alta|Consentimiento presencial|registro de prueba/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Segunda carrera/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
});

test('grade and period offer the stable Forms options and keep their stored values', () => {
  show();
  const grade = screen.getByLabelText('Grado') as HTMLSelectElement;
  const period = screen.getByLabelText('Periodo de interés') as HTMLSelectElement;
  expect(Array.from(grade.options).map((o) => [o.value, o.textContent])).toEqual([
    ['', 'Sin dato'], ['1', '1.º año'], ['2', '2.º año'], ['3', '3.º año'], ['graduado', 'Egresado'],
  ]);
  expect(Array.from(period.options).map((o) => o.value)).toEqual(['', '2027-01', '2027-08', '2028-01', '2028-08']);
  expect(grade.value).toBe('3');
  expect(period.value).toBe('2027-08');
});

test('saves only what changed through update_participant, with the stable values', async () => {
  show();
  await userEvent.selectOptions(screen.getByLabelText('Grado'), 'graduado');
  await userEvent.selectOptions(screen.getByLabelText('Periodo de interés'), '2028-01');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('update_participant', { p_id: 'p-1', p: { high_school_grade: 'graduado', entry_period: '2028-01' } }));
  expect(onSaved).toHaveBeenCalledWith('p-1');
  expect(vi.mocked(rpc).mock.calls.map(([name]) => name)).toEqual(['update_participant']);
});

test('does not call the server when nothing changed', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(rpc).not.toHaveBeenCalled();
});

test('changing the email asks for the reason and sends it with the change', async () => {
  show();
  const email = screen.getByLabelText('Correo');
  await userEvent.clear(email);
  await userEvent.type(email, 'ana.nueva@correo.com');
  await userEvent.type(await screen.findByLabelText(/Motivo del cambio de correo/), 'Error de captura');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('update_participant', { p_id: 'p-1', p: { email: 'ana.nueva@correo.com', email_reason: 'Error de captura' } }));
});

test('clearing the grade is sent as empty and server errors are shown in plain language', async () => {
  vi.mocked(rpc).mockRejectedValue(new Error('INVALID_GRADE'));
  show();
  await userEvent.selectOptions(screen.getByLabelText('Grado'), '');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Elige tu grado.');
  expect(rpc).toHaveBeenCalledWith('update_participant', { p_id: 'p-1', p: { high_school_grade: '' } });
  expect(onSaved).not.toHaveBeenCalled();
});

test('the initial career can be changed to any active career; a retired one is only offered if it is the current value', () => {
  show({ ...initial, initial_career_id: 'c-3' });
  const options = Array.from((screen.getByLabelText('Carrera de interés inicial') as HTMLSelectElement).options).map((o) => o.textContent);
  expect(options).toEqual(['Sin carrera', 'Psicología', 'Derecho', 'Carrera retirada']);
  const without = Array.from((screen.getByLabelText('Carrera de interés inicial') as HTMLSelectElement).options).length;
  expect(without).toBe(4);
});

test('changes the school by catalog ID and keeps an inactive historical school visible', async () => {
  show({ ...initial, high_school_id: 'h-3', high_school: 'Plantel retirado' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Escuela / preparatoria' }));
  expect(screen.getByRole('combobox', { name: 'Escuela / preparatoria' })).toHaveTextContent('Plantel retirado');
  fireEvent.click(screen.getByRole('button', { name: 'Otra escuela' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('update_participant', { p_id: 'p-1', p: { high_school_id: 'h-2' } }));
});
