import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import ParticipantImport from './ParticipantImport';

vi.mock('../../lib/adminApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn(),
}));
vi.mock('../../edition/EditionProvider', () => ({
  useEdition: () => ({ edition: { roster_status: 'oficial', mode: 'operacion_real' } }),
}));
vi.mock('../../lib/catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/catalog')>(),
  fetchCareers: vi.fn().mockResolvedValue([]), fetchHighSchools: vi.fn().mockResolvedValue([]),
}));

test('CSV preview and import remain available even when the stored roster status is official', async () => {
  const result = { counts: { new: 1 }, rows: [{ row: 2, status: 'new', errors: [], warnings: [], name: 'Ana', email: 'ana@example.com' }] };
  vi.mocked(rpc).mockImplementation(async (name: string) => {
    if (name === 'list_import_conflicts') return [] as never;
    if (name === 'preview_participant_import' || name === 'commit_participant_import') return result as never;
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const { container } = render(<MemoryRouter><ParticipantImport /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Importar participantes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Elegir archivo CSV' })).toBeInTheDocument();
  expect(screen.queryByText(/Estado del padrón|Declarar padrón oficial|Reabrir importación/)).not.toBeInTheDocument();

  const file = new File(['Nombre,Correo\nAna,ana@example.com'], 'participantes.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'Nombre,Correo\nAna,ana@example.com' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(await screen.findByText('Vista previa de participantes.csv')).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith('preview_participant_import', expect.objectContaining({ p_is_demo: false }));

  fireEvent.click(screen.getByRole('button', { name: 'Importar participantes' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('commit_participant_import', expect.objectContaining({ p_file_name: 'participantes.csv' })));
});
