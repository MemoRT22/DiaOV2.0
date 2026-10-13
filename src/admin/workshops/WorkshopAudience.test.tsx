import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import WorkshopAudience from './WorkshopAudience';
import { rpc } from '../../lib/adminApi';

vi.mock('../../lib/adminApi', () => ({ rpc: vi.fn() }));
const call = vi.mocked(rpc);
beforeEach(() => vi.resetAllMocks());

test('coordination reads and explicitly changes the audience', async () => {
  let audience = 'students';
  call.mockImplementation(async (name, args) => {
    if (name === 'set_activity_audience') { audience = String(args?.p_audience); return null; }
    return audience;
  });
  render(<WorkshopAudience activityId="workshop" />);
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Guardar público' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByRole('combobox'), 'educators');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar público' }));
  expect(await screen.findByText('Público del taller actualizado.')).toBeInTheDocument();
  expect(call).toHaveBeenCalledWith('set_activity_audience', { p_activity: 'workshop', p_audience: 'educators' });
});

test('backend authorization rejection is explained and does not show success', async () => {
  call.mockImplementation(async (name) => {
    if (name === 'set_activity_audience') throw new Error('NOT_AUTHORIZED');
    return 'students';
  });
  render(<WorkshopAudience activityId="workshop" />);
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
  await userEvent.selectOptions(screen.getByRole('combobox'), 'educators');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar público' }));
  expect(await screen.findByText('No tienes permiso para realizar esta acción.')).toBeInTheDocument();
  expect(screen.queryByText('Público del taller actualizado.')).not.toBeInTheDocument();
});
