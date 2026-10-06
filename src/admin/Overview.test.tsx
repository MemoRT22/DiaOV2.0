import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { supabase } from '../lib/supabase';
import { workshopAdminApi, type WorkshopList } from '../lib/workshopAdminApi';
import { useEdition } from '../edition/EditionProvider';
import Overview from './Overview';

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../lib/workshopAdminApi', () => ({ workshopAdminApi: { list: vi.fn() } }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: vi.fn() }));

const summary = { participants_total: 120, activities: 8, sessions: 22, attendances: 45,
  pending_conflicts: 0 };
const list = (counts: WorkshopList['counts']): WorkshopList => ({ items: [], total: 0, page: 1, page_size: 25, counts });
const show = () => render(<MemoryRouter><Overview /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useEdition).mockReturnValue({ edition: {
    name: 'Día OV 2026', event_date: '2026-10-20', start_time: '09:00', venue: 'Campus Cancún', mode: 'preparacion',
  } } as ReturnType<typeof useEdition>);
  vi.mocked(supabase.rpc).mockResolvedValue({ data: summary, error: null } as never);
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list({}));
});

test('shows reliable pending work with links to its resolution area', async () => {
  vi.mocked(supabase.rpc).mockResolvedValue({ data: { ...summary, pending_conflicts: 3 }, error: null } as never);
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list({ submitted: 2, in_review: 1, approved: 4, changes_requested: 7 }));
  show();
  const section = await screen.findByRole('region', { name: 'Pendientes' });
  expect(within(section).getAllByRole('link')).toHaveLength(3);
  expect(within(section).getByText('3 datos de importación por revisar').closest('a'))
    .toHaveAttribute('href', '/coordinacion/participantes/importar');
  expect(within(section).queryByText(/fecha de nacimiento/)).not.toBeInTheDocument();
  expect(within(section).getByText('3 propuestas por revisar').closest('a')).toHaveAttribute('href', '/coordinacion/talleres');
  expect(within(section).getByText('4 propuestas listas para publicar').closest('a')).toHaveAttribute('href', '/coordinacion/talleres');
  expect(within(section).queryByText(/7 cambios solicitados/)).not.toBeInTheDocument();
  expect(supabase.rpc).toHaveBeenCalledWith('coordination_summary');
  expect(workshopAdminApi.list).toHaveBeenCalledWith({});
});

test('shows a calm empty state, event context and useful indicators', async () => {
  show();
  expect(await screen.findByText('Sin pendientes conocidos')).toBeInTheDocument();
  expect(screen.getByText('Día OV 2026')).toBeInTheDocument();
  expect(screen.getByText('Campus Cancún')).toBeInTheDocument();
  expect(screen.getByText('Preparación')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'realiza la puesta en marcha y activa la operación real' }))
    .toHaveAttribute('href', '/coordinacion/configuracion/preparacion');
  expect(screen.queryByText(/retira los datos de prueba/)).not.toBeInTheDocument();
  expect(screen.getByText('120')).toBeInTheDocument();
  expect(screen.getByText('22')).toBeInTheDocument();
  expect(screen.getByText('45')).toBeInTheDocument();
});

test('quick actions lead to the three main destinations', async () => {
  show();
  const actions = await screen.findByRole('region', { name: 'Accesos rápidos' });
  expect(within(actions).getByRole('link', { name: /Gestionar participantes/ })).toHaveAttribute('href', '/coordinacion/participantes');
  expect(within(actions).getByRole('link', { name: /Gestionar talleres/ })).toHaveAttribute('href', '/coordinacion/talleres');
  expect(within(actions).getByRole('link', { name: /Abrir operación del evento/ })).toHaveAttribute('href', '/coordinacion/operacion-en-vivo');
});

test('does not claim all clear when workshop counts are unavailable', async () => {
  vi.mocked(workshopAdminApi.list).mockRejectedValue(new Error('NETWORK'));
  show();
  expect(await screen.findByText(/No se pudieron consultar los pendientes/)).toBeInTheDocument();
  expect(screen.queryByText('Sin pendientes conocidos')).not.toBeInTheDocument();
  expect(screen.getByText('120')).toBeInTheDocument();
});

test('uses singular labels for one pending item', async () => {
  vi.mocked(workshopAdminApi.list).mockResolvedValue(list({ approved: 1 }));
  show();
  expect(await screen.findByText('1 propuesta lista para publicar')).toBeInTheDocument();
});
