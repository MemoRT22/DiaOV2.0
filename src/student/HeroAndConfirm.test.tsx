import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import type { Board, BoardSession } from '../lib/reservations';
import { buildJourney } from '../lib/studentJourney';
import ConfirmSheet from './reservations/ConfirmSheet';
import NextStopCard from './NextStopCard';

vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({ theme: { assets: {}, meta: { guideName: 'Leonel' }, colors: { secondary: '#888' }, divisions: {} }, term: (k: string) => k, text: () => '' }),
}));

const session = (id: string, activity: string, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: activity, title: `Misión ${id}`, description: '', division_id: 'd1', division_ids: ['d1'], starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:30:00Z',
  location: 'Salón', credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: false, ended: false, in_progress: false, attended: false,
  my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10,
  sessions: [session('a', 'x'), session('b', 'y'), session('c', 'y', { starts_at: '2026-10-15T17:00:00Z' })], reservations: [], ...over,
});
const areas = [
  { id: 'd1', name: 'Ciencias de la Salud', color: '#14B8A6' },
  { id: 'd2', name: 'Negocios', color: '#F5B400' },
];
const hero = (b: Board, extra: Partial<React.ComponentProps<typeof NextStopCard>> = {}) =>
  render(
    <MemoryRouter>
      <NextStopCard board={b} journey={buildJourney(b)} now={Date.parse('2026-10-15T14:00:00Z')} areas={areas} lifeColor="#8b3dff" {...extra} />
    </MemoryRouter>,
  );

test('with nothing booked, Inicio invites to explore: what there is, one main action and a way in through each area', () => {
  hero(board());
  const region = screen.getByRole('region', { name: 'Tu siguiente misión' });
  expect(within(region).getByRole('heading', { name: 'Elige tu primera misión' })).toBeInTheDocument();
  const facts = within(region).getByRole('list', { name: 'Qué hay por descubrir' });
  expect(facts).toHaveTextContent('2 misiones'); // distinct activities, not sessions
  expect(facts).toHaveTextContent('2 áreas');
  expect(facts).toHaveTextContent('hasta 4 en tu ruta');
  expect(within(region).getByRole('link', { name: /Explorar misiones/ })).toHaveAttribute('href', '/misiones');
  expect(within(region).getByRole('link', { name: 'Misiones de Negocios' })).toHaveAttribute('href', '/misiones?f=division&d=d2');
  expect(within(region).getByRole('link', { name: 'Misiones de Vida Universitaria' })).toHaveAttribute('href', '/misiones?f=life');
});

test('when reservations are not open (or already closed) the area shortcuts are not offered, and nothing is promised', () => {
  hero(board({ window: 'not_open' }));
  expect(screen.queryByRole('link', { name: 'Misiones de Negocios' })).not.toBeInTheDocument();
  expect(screen.getByText(/aún no abren/)).toBeInTheDocument();
});

test('the empty state never claims anything about reservations the student does not have', () => {
  hero(board());
  expect(screen.queryByText(/reservaste|tu siguiente misión es/i)).not.toBeInTheDocument();
});

test('once something is booked the hero is about THAT mission, not decoration', () => {
  const booked = session('a', 'x', { my_reservation_id: 'r1', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z' });
  const b = board({
    sessions: [booked], active_reservation_count: 1,
    reservations: [{ id: 'r1', session_id: 'a', activity_id: 'x', status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: 'active', credits_granted: null }],
  });
  hero(b);
  expect(screen.getByRole('heading', { name: 'Misión a' })).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Qué hay por descubrir' })).not.toBeInTheDocument();
  expect(screen.queryByText('O empieza por un área')).not.toBeInTheDocument();
});

const sheet = (action: () => Promise<unknown>, progress?: () => { active: number; max: number }) =>
  render(
    <MemoryRouter>
      <ConfirmSheet
        request={{ title: 'Reservar lugar', body: '', confirmLabel: 'Reservar', success: { title: '¡Listo! Misión agregada a tu ruta', progress }, action }}
        onClose={() => undefined}
      />
    </MemoryRouter>,
  );

test('the celebration appears only after the server accepted, and shows the route as the server now has it', async () => {
  const progress = vi.fn(() => ({ active: 2, max: 4 }));
  let accept!: () => void;
  sheet(() => new Promise<void>((resolve) => { accept = resolve; }), progress);
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  // still waiting for the server: no success, no route, nothing read yet
  expect(screen.queryByText('¡Listo! Misión agregada a tu ruta')).not.toBeInTheDocument();
  expect(progress).not.toHaveBeenCalled();
  accept();
  expect(await screen.findByText('¡Listo! Misión agregada a tu ruta')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Tu ruta: 2 de 4 misiones reservadas' })).toBeInTheDocument();
});

test('a rejected reservation shows the error and never the celebration or the route', async () => {
  const progress = vi.fn(() => ({ active: 3, max: 4 }));
  sheet(() => Promise.reject(new Error('SESSION_FULL')), progress);
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  expect(await screen.findByText(/acaba de llenarse/)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('¡Listo! Misión agregada a tu ruta')).not.toBeInTheDocument());
  expect(progress).not.toHaveBeenCalled();
});

test('without progress (or with an empty route) the success is just the success', async () => {
  sheet(() => Promise.resolve());
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  expect(await screen.findByText('¡Listo! Misión agregada a tu ruta')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /Tu ruta/ })).not.toBeInTheDocument();
});
