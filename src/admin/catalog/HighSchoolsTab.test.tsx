import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { fetchHighSchools } from '../../lib/catalog';
import HighSchoolsTab from './HighSchoolsTab';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
vi.mock('../../lib/catalog', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/catalog')>(), fetchHighSchools: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchHighSchools).mockResolvedValue([
    { id: 'h-1', name: 'Colegio Boston (Cancún)', is_active: true },
    { id: 'h-2', name: 'Otra escuela', is_active: true },
    { id: 'h-3', name: 'Preparatoria antigua', is_active: false },
  ]);
  vi.mocked(rpc).mockResolvedValue('h-4' as never);
});

test('shows active count, searches names and keeps inactive entries visible to coordination', async () => {
  render(<HighSchoolsTab />);
  expect(await screen.findByText('2 activas')).toBeInTheDocument();
  expect(screen.getByText('Preparatoria antigua')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Buscar preparatorias'), 'Boston');
  expect(screen.getByText('Colegio Boston (Cancún)')).toBeInTheDocument();
  expect(screen.queryByText('Otra escuela')).not.toBeInTheDocument();
});

test('creates a school through the coordination RPC and explains duplicates', async () => {
  vi.mocked(rpc).mockRejectedValueOnce(new Error('HIGH_SCHOOL_EXISTS'));
  render(<HighSchoolsTab />);
  await screen.findByText('2 activas');
  fireEvent.click(screen.getByRole('button', { name: 'Nueva preparatoria' }));
  await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Nombre'), 'Colegio Boston (Cancún)');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una preparatoria con ese nombre.');
  expect(rpc).toHaveBeenCalledWith('save_high_school', { p: { id: null, name: 'Colegio Boston (Cancún)', is_active: true } });
});

test('deactivates an existing school without a delete action', async () => {
  render(<HighSchoolsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar Colegio Boston (Cancún)' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Activa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('save_high_school', { p: { id: 'h-1', name: 'Colegio Boston (Cancún)', is_active: false } }));
  expect(screen.queryByRole('button', { name: /Eliminar preparatoria/ })).not.toBeInTheDocument();
});
