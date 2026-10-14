import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import ExitSurveyAdminPanel from './ExitSurveyAdmin';

vi.mock('../../lib/adminApi', () => ({ rpc: vi.fn() }));

const aggregate = (over = {}) => ({
  completed: 4, participants: 10, q1: { sin_idea: 3, entre_varias: 1 }, q2_rating: { '4': 4 }, q2_average: 4, q3: { ya_claro: 2, seguir_explorando: 2 },
  q4: { salud: 3, ninguna: 1 }, q5_average: 8.25, q5_promoters: 2, q5_passives: 1, q5_detractors: 1,
  comments: [{ text: 'Más talleres de robótica', completed_at: '2026-10-15T19:00:00Z' }], ...over,
});
let view: Record<string, unknown>;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  view = {
    version: 'exit-2026-v1', opens_at: '2026-10-15T18:00:00Z', custom: false, default_opens_at: '2026-10-15T18:00:00Z', timezone: 'America/Cancun',
    server_now: '2026-10-14T12:00:00Z', mode: 'preparacion', official: aggregate({ completed: 0, participants: 0, comments: [] }), rehearsal: aggregate(),
  };
  vi.mocked(rpc).mockImplementation(async (name: string) => (name === 'exit_survey_admin' ? view : { opens_at: '2026-10-15T19:30:00Z', custom: true }));
});
afterEach(() => vi.restoreAllMocks());

test('muestra la hora de apertura en hora de Cancún, el origen de la hora y los resultados del ensayo y del oficial por separado', async () => {
  render(<ExitSurveyAdminPanel />);
  expect(await screen.findByText('Por omisión')).toBeInTheDocument();
  expect(screen.getByText(/1:00 p\.m\./)).toBeInTheDocument();
  expect((screen.getByLabelText(/Nueva hora de apertura/) as HTMLInputElement).value).toBe('2026-10-15T13:00'); // Cancún, no la zona del dispositivo
  const rehearsal = screen.getByRole('heading', { name: 'Ensayo (cuentas de prueba)' }).closest('div')!.parentElement!;
  expect(within(rehearsal).getByText(/4 de 10 participantes/)).toBeInTheDocument();
  expect(within(rehearsal).getByText('Más talleres de robótica')).toBeInTheDocument();
  expect(within(rehearsal).getByText(/NPS/)).toHaveTextContent('2 promotores, 1 detractores');
  const official = screen.getByRole('heading', { name: 'Operación oficial' }).closest('div')!.parentElement!;
  expect(within(official).getByText('Todavía no hay respuestas.')).toBeInTheDocument();
  expect(screen.queryByText(/participant_id|@/)).toBeNull(); // sin identidades
});

test('Coordinación ajusta la hora sin tocar código: se manda en UTC−5 y la pantalla se actualiza', async () => {
  render(<ExitSurveyAdminPanel />);
  const input = (await screen.findByLabelText(/Nueva hora de apertura/)) as HTMLInputElement;
  const save = screen.getByRole('button', { name: 'Guardar hora' });
  expect(save).toBeDisabled(); // sin cambios
  fireEvent.change(input, { target: { value: '2026-10-15T14:30' } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_exit_survey_opens_at', { p_opens_at: '2026-10-15T19:30:00.000Z' }));
  expect(await screen.findByText('Hora de apertura actualizada.')).toBeInTheDocument();
});

test('restablece la hora por omisión y muestra el error del servidor si rechaza una hora absurda', async () => {
  view = { ...view, custom: true };
  render(<ExitSurveyAdminPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Restablecer a las 13:00' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_exit_survey_opens_at', { p_opens_at: null }));
  vi.mocked(rpc).mockImplementation(async (name: string) => { if (name === 'exit_survey_admin') return view; throw { message: 'INVALID_OPENING_TIME' }; });
  fireEvent.change(screen.getByLabelText(/Nueva hora de apertura/), { target: { value: '2031-01-01T00:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar hora' }));
  expect(await screen.findByText(/entre una semana antes y un mes después/)).toBeInTheDocument();
});
