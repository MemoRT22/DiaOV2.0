import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { rpc } from '../../lib/adminApi';
import { importSummary } from './CsvImport';
import ParticipantImport from './ParticipantImport';

vi.mock('../../lib/adminApi', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/adminApi')>(), rpc: vi.fn() }));
// The CSV step is covered elsewhere: here it only reports that an import finished with rows needing review.
vi.mock('./CsvImport', async (importOriginal) => ({
  ...await importOriginal<typeof import('./CsvImport')>(),
  default: ({ onImported }: { onImported?: (r: unknown) => void }) => (
    <button onClick={() => onImported?.({ counts: { update: 1842, new: 17, conflict: 1 }, rows: [] })}>Simular importación</button>
  ),
}));

let pending: Array<Record<string, unknown>>;
const conflict = { id: 'c-1', participant_id: 'p-1', field: 'phone', full_name: 'Ana López', email: 'ana@correo.com',
  imported_value: '998111', current_value: '998222', corrected_by: 'Ena', corrected_at: '2026-10-05T10:00:00Z', created_at: '2026-10-06T10:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  vi.mocked(rpc).mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'list_import_conflicts') return [...pending] as never;
    if (name === 'resolve_import_conflict') { pending = pending.filter((c) => c.id !== args?.p_id); return undefined as never; }
    return undefined as never;
  });
});

const show = () => render(<MemoryRouter><ParticipantImport /></MemoryRouter>);

test('summarises an import as updated, new and needing review', () => {
  expect(importSummary({ update: 1842, new: 17, conflict: 3, unchanged: 5 })).toBe('1,842 actualizados · 17 nuevos · 3 requieren revisión');
  expect(importSummary({ update: 1, new: 0, conflict: 1 })).toBe('1 actualizado · 1 requiere revisión');
  expect(importSummary({ unchanged: 4 })).toBe('No hubo cambios que guardar.');
});

test('import lives under Participantes and there is no separate conflicts screen to visit', async () => {
  show();
  expect(screen.getByRole('heading', { name: 'Importar participantes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simular importación' })).toBeInTheDocument();
  for (const hidden of ['Estado del padrón', 'Declarar padrón oficial', 'Reabrir importación']) {
    expect(screen.queryByText(hidden)).not.toBeInTheDocument();
  }
  expect(screen.getByRole('link', { name: 'Participantes' })).toHaveAttribute('href', '/');
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('list_import_conflicts'));
  expect(screen.queryByRole('link', { name: /Conflictos/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

test('records left for review by earlier imports are resolved on the import page itself', async () => {
  pending = [conflict];
  show();
  const review = await screen.findByRole('region', { name: 'Registros que requieren revisión' });
  expect(within(review).getByText('1 dato requiere revisión')).toBeInTheDocument();
  expect(within(review).getByText('998222')).toBeInTheDocument();
  expect(within(review).getByText('998111')).toBeInTheDocument();
  fireEvent.click(within(review).getByRole('button', { name: 'Usar dato del archivo' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('resolve_import_conflict', { p_id: 'c-1', p_accept: true }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Registros que requieren revisión' })).not.toBeInTheDocument());
});

test('after importing, the rows that need review show up right there without leaving the page', async () => {
  show();
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  pending = [conflict]; // the import just left one manual correction in conflict
  fireEvent.click(screen.getByRole('button', { name: 'Simular importación' }));
  expect(await screen.findByRole('region', { name: 'Registros que requieren revisión' })).toBeInTheDocument();
  expect(screen.getByText('Conservar corrección manual')).toBeInTheDocument();
});

test('keeping the manual correction rejects the file value and keeps the audit path (RPC)', async () => {
  pending = [conflict];
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Conservar corrección manual' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('resolve_import_conflict', { p_id: 'c-1', p_accept: false }));
});
