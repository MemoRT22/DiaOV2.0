import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession, MyReservation } from '../lib/reservations';
import MyRoute from './MyRoute';

const state = vi.hoisted(() => ({ board: null as unknown, reserve: vi.fn(), cancel: vi.fn(), change: vi.fn() }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: { colors: { secondary: '#888888' }, divisions: {} },
    term: (key: string) => (key === 'route' ? 'Trazar tu ruta' : key === 'activity' ? 'Talleres' : key === 'division' ? 'Cuadrante' : key),
    text: () => '',
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({
    board: state.board, error: null, loading: false, reload: vi.fn(), reserve: state.reserve, cancel: state.cancel, change: state.change,
  }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchDivisions: vi.fn().mockResolvedValue([{ id: 'd', code: 'DEMO', name: 'División Demo' }]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: vi.fn().mockResolvedValue({ recommendations: [] }) }));

const session = (over: Partial<BoardSession>): BoardSession => ({
  id: 's', activity_id: 'a', title: 'Taller', description: '', division_id: 'd', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z',
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const reservation = (over: Partial<MyReservation>): MyReservation => ({
  id: 'r', session_id: 's', activity_id: 'a', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active',
  credits_granted: null, ...over,
});
const board = (over: Partial<Board>): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10,
  sessions: [], reservations: [], ...over,
});

const renderRoute = async (b: Board) => {
  state.board = b;
  render(<MemoryRouter><MyRoute /></MemoryRouter>);
  await screen.findByText(/misiones reservadas/); // divisions load asynchronously
};
beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------- Mi Ruta

test('the header recommends — never imposes — the transfer time', async () => {
  await renderRoute(board({ active_reservation_count: 1 }));
  expect(screen.getByText(/1 de 4 misiones reservadas · Deja 10 min entre misiones para llegar/)).toBeInTheDocument();
  expect(screen.queryByText(/para trasladarte/)).not.toBeInTheDocument();
});

test('Mi ruta adds the potential stamps without touching the reservations indicator, and a cancellation updates them', async () => {
  const done = session({ id: 'done', activity_id: 'a-done', title: 'Completada', credits: 2, ended: true, started: true, attended: true, my_reservation_id: 'r0' });
  const one = session({ id: 'one', activity_id: 'a-one', title: 'Una', credits: 1, my_reservation_id: 'r1' });
  const two = session({ id: 'two', activity_id: 'a-two', title: 'Dos', credits: 2, ends_at: '2026-10-15T16:00:00Z', my_reservation_id: 'r2' });
  const rows = [
    reservation({ id: 'r0', session_id: 'done', activity_id: 'a-done', derived_status: 'completed', credits_granted: 2 }),
    reservation({ id: 'r1', session_id: 'one', activity_id: 'a-one' }),
    reservation({ id: 'r2', session_id: 'two', activity_id: 'a-two' }),
  ];
  state.board = board({ active_reservation_count: 2, sessions: [done, one, two], reservations: rows });
  const view = render(<MemoryRouter><MyRoute /></MemoryRouter>);
  await screen.findByText(/2 de 4 misiones reservadas · 1 completada/); // the reservations indicator keeps its meaning
  const plan = screen.getByRole('img', { name: /2 stamp obtenidos, 3 stamp posibles si asistes/ });
  expect(plan.querySelectorAll('[data-stamp="earned"]')).toHaveLength(2);
  expect(plan.querySelectorAll('[data-stamp="planned"]')).toHaveLength(2);
  expect(plan).toHaveTextContent('+1'); // 5 in total: no extra positions, the real total is kept
  view.unmount();

  // the student cancels the 2-credit mission: the projection follows the board
  state.board = board({ active_reservation_count: 1, sessions: [done, one, two], reservations: [rows[0], rows[1]] });
  render(<MemoryRouter><MyRoute /></MemoryRouter>);
  await screen.findByText(/1 de 4 misiones reservadas · 1 completada/);
  const after = screen.getByRole('img', { name: /2 stamp obtenidos, 1 stamp posible si asistes/ });
  expect(after.querySelectorAll('[data-stamp="planned"]')).toHaveLength(1);
});

test('a session in progress can still be changed and cancelled', async () => {
  const s = session({ id: 'live', title: 'En curso ahora', started: true, in_progress: true, my_reservation_id: 'r1' });
  await renderRoute(board({ active_reservation_count: 1, sessions: [s], reservations: [reservation({ id: 'r1', session_id: 'live', derived_status: 'in_progress' })] }));
  const item = screen.getByRole('heading', { name: 'En curso ahora' }).closest('li') as HTMLElement;
  expect(within(item).getByText('En curso')).toBeInTheDocument();
  expect(within(item).getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
  expect(within(item).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
});

test('a completed or ended reservation offers no change or cancel', async () => {
  const done = session({ id: 'done', title: 'Completada', ended: true, started: true, attended: true, my_reservation_id: 'r1' });
  const over = session({ id: 'over', activity_id: 'a2', title: 'Terminó sin asistencia', ended: true, started: true, my_reservation_id: 'r2' });
  await renderRoute(board({
    sessions: [done, over],
    reservations: [
      reservation({ id: 'r1', session_id: 'done', activity_id: 'a', derived_status: 'completed', credits_granted: 1 }),
      reservation({ id: 'r2', session_id: 'over', activity_id: 'a2', derived_status: 'ended' }),
    ],
  }));
  expect(screen.queryByRole('button', { name: 'Cambiar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  expect(screen.getByText('Completada', { selector: 'span' })).toBeInTheDocument();
  expect(screen.getByText(/puedes reservar otra sesión de esta misión/)).toBeInTheDocument();
});

test('two reservations with a tight transfer show a non-blocking warning on each', async () => {
  const a = session({ id: 'first', activity_id: 'a1', title: 'Primero', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z', my_reservation_id: 'r1', tight_transfer_with: ['r2'] });
  const b = session({ id: 'second', activity_id: 'a2', title: 'Segundo', starts_at: '2026-10-15T15:35:00Z', ends_at: '2026-10-15T16:05:00Z', my_reservation_id: 'r2', tight_transfer_with: ['r1'] });
  await renderRoute(board({
    active_reservation_count: 2, sessions: [a, b],
    reservations: [reservation({ id: 'r1', session_id: 'first', activity_id: 'a1' }), reservation({ id: 'r2', session_id: 'second', activity_id: 'a2' })],
  }));
  const first = screen.getByRole('heading', { name: 'Primero' }).closest('li') as HTMLElement;
  const second = screen.getByRole('heading', { name: 'Segundo' }).closest('li') as HTMLElement;
  expect(within(first).getByText(/tienes menos de 10 min para llegar a tu siguiente misión/)).toBeInTheDocument();
  expect(within(second).getByText(/llegas con menos de 10 min desde tu misión anterior/)).toBeInTheDocument();
});
