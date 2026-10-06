import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { preparationApi, type PreparationPreview } from '../lib/preparationApi';
import { supabase } from '../lib/supabase';
import { useEdition } from '../edition/EditionProvider';
import Operation from './Operation';

vi.mock('../lib/preparationApi', () => ({ preparationApi: { preview: vi.fn(), reset: vi.fn(), retryAuthCleanup: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: vi.fn() }));

const counts = { participants: 2, proposals: 1, activities: 1, sessions: 2, reservations: 3,
  attendances: 1, interests: 2, imports: 1, raffle_results: 1, temporary_catalog: 1,
  temporary_staff: 0, auth_identities: 1 };
const preview: PreparationPreview = { edition_id: 'ed', mode: 'preparacion', counts, last_reset_at: null,
  auth_cleanup_pending: 0, theme_ready: true, temporary_records_remaining: 0 };
const show = () => render(<Operation />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useEdition).mockReturnValue({ edition: { mode: 'preparacion' }, reloadEdition: vi.fn() } as unknown as ReturnType<typeof useEdition>);
  vi.mocked(preparationApi.preview).mockResolvedValue(preview);
  vi.mocked(preparationApi.reset).mockResolvedValue({ reset: { reset_at: '2026-10-06T15:00:00Z', counts },
    auth_cleanup: { deleted: 1, failed: 0, pending: 0 } });
  vi.mocked(supabase.rpc).mockResolvedValue({ error: null } as never);
});

test('shows a simple preparation flow and a backend-calculated reset preview', async () => {
  show();
  expect(await screen.findByRole('heading', { name: 'Preparación y puesta en marcha' })).toBeInTheDocument();
  expect(screen.getByText(/La configuración del evento, la temática/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Revisar y reiniciar/ }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Propuestas de talleres')).toBeInTheDocument();
  expect(within(dialog).getByText('Reservaciones')).toBeInTheDocument();
  expect(within(dialog).getByText('Accesos de participantes')).toBeInTheDocument();
  expect(preparationApi.reset).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('requires the exact phrase and blocks a second submission while reset is running', async () => {
  let finish!: (value: Awaited<ReturnType<typeof preparationApi.reset>>) => void;
  vi.mocked(preparationApi.reset).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  show();
  await screen.findByRole('button', { name: /Revisar y reiniciar/ });
  fireEvent.click(screen.getByRole('button', { name: /Revisar y reiniciar/ }));
  const dialog = screen.getByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Reiniciar ambiente' });
  expect(submit).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'REINICIAR PREPARACIÓN' } });
  fireEvent.click(submit);
  expect(preparationApi.reset).toHaveBeenCalledTimes(1);
  expect(submit).toBeDisabled();
  finish({ reset: { reset_at: '2026-10-06T15:00:00Z', counts }, auth_cleanup: { deleted: 1, failed: 0, pending: 0 } });
  expect(await screen.findByText(/El ambiente quedó limpio/)).toBeInTheDocument();
  await waitFor(() => expect(preparationApi.preview).toHaveBeenCalledTimes(2));
});

test('keeps the modal open and shows an error if reset fails', async () => {
  vi.mocked(preparationApi.reset).mockRejectedValue(new Error('RESET_DISABLED'));
  show();
  await screen.findByRole('button', { name: /Revisar y reiniciar/ });
  fireEvent.click(screen.getByRole('button', { name: /Revisar y reiniciar/ }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'REINICIAR PREPARACIÓN' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reiniciar ambiente' }));
  expect(await within(dialog).findByText(/ya está en operación real/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('activation is distinct, needs a published theme and enters read-only mode', async () => {
  vi.mocked(preparationApi.preview).mockResolvedValueOnce({ ...preview, theme_ready: false }).mockResolvedValue({ ...preview, mode: 'operacion_real' });
  const view = show();
  expect(await screen.findByRole('button', { name: 'Activar operación real' })).toBeDisabled();
  view.unmount();
  vi.mocked(preparationApi.preview).mockResolvedValueOnce(preview).mockResolvedValue({ ...preview, mode: 'operacion_real' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Activar operación real' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'ACTIVAR OPERACIÓN REAL' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Activar operación real' }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('activate_real_operation', { p_phrase: 'ACTIVAR OPERACIÓN REAL' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Revisar y reiniciar/ })).not.toBeInTheDocument());
});

test('real operation hides preparation controls on refresh', async () => {
  vi.mocked(preparationApi.preview).mockResolvedValue({ ...preview, mode: 'operacion_real' });
  vi.mocked(useEdition).mockReturnValue({ edition: { mode: 'operacion_real', real_operation_at: '2026-10-06T15:00:00Z' },
    reloadEdition: vi.fn() } as unknown as ReturnType<typeof useEdition>);
  show();
  expect(await screen.findByText(/El ambiente ya no se puede reiniciar/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Revisar y reiniciar/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Activar operación real' })).not.toBeInTheDocument();
});

test('shows pending participant access cleanup and retries without another reset', async () => {
  vi.mocked(preparationApi.preview).mockResolvedValue({ ...preview, auth_cleanup_pending: 2 });
  vi.mocked(preparationApi.retryAuthCleanup).mockResolvedValue({ auth_cleanup: { deleted: 2, failed: 0, pending: 0 } });
  show();
  expect(await screen.findByText(/Quedan 2 accesos de participantes/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activar operación real' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar limpieza de accesos' }));
  await waitFor(() => expect(preparationApi.retryAuthCleanup).toHaveBeenCalledTimes(1));
  expect(preparationApi.reset).not.toHaveBeenCalled();
});

test('keeps activation confirmation open when the backend rejects activation', async () => {
  vi.mocked(supabase.rpc).mockResolvedValue({ error: new Error('NO_PUBLISHED_THEME') } as never);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Activar operación real' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'ACTIVAR OPERACIÓN REAL' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Activar operación real' }));
  expect(await within(dialog).findByText(/Publica una temática/)).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
