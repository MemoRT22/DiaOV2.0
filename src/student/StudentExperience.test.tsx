import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Division } from '../lib/catalog';
import type { Board, BoardSession, MyReservation } from '../lib/reservations';
import { neutralTheme } from '../theme/neutralTheme';
import appSource from '../App.tsx?raw';
import BottomNav from './BottomNav';
import Home from './Home';
import MyRoute from './MyRoute';
import StampCollection from './StampCollection';
import ConfirmSheet from './reservations/ConfirmSheet';

const m = vi.hoisted(() => ({ board: null as unknown, fetchProgress: vi.fn(), fetchDivisions: vi.fn(), raffle: vi.fn() }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Ana López' }, signOut: vi.fn() }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    term: (key: 'stamp' | 'division' | 'rank' | 'passport' | 'route' | 'activity' | 'interests', plural = false) =>
      (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: vi.fn(), reserve: vi.fn(), change: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchProgress: m.fetchProgress,
  fetchDivisions: m.fetchDivisions,
}));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.raffle }));

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const session = (id: string, startOffset: number, endOffset: number, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: `a-${id}`, title: `Taller ${id}`, description: '', division_id: 'd1', starts_at: iso(startOffset), ends_at: iso(endOffset), location: `Salón ${id}`,
  credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: startOffset <= 0, ended: endOffset <= 0, in_progress: startOffset <= 0 && endOffset > 0,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const reservation = (id: string, sessionId: string, derived: string, over: Partial<MyReservation> = {}): MyReservation => ({
  id, session_id: sessionId, activity_id: `a-${sessionId}`, status: 'vigente', created_at: '', ended_at: null, resolved: false, derived_status: derived,
  credits_granted: null, ...over,
});
const board = (sessions: BoardSession[], reservations: MyReservation[], over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: reservations.filter((r) => ['active', 'in_progress'].includes(r.derived_status)).length,
  travel_buffer_minutes: 10, sessions, reservations, ...over,
});
const progress = (over: Record<string, unknown> = {}) => ({
  level: 1, stamps: 0, attended_workshops: 0, reserved_workshops: 0, division_ids: [], next: null, consent_accepted: true,
  post_event_interests_prompt: false, post_event_interests_open: false, post_event_interests_completed: false, ...over,
});
const divisions: Division[] = [
  { id: 'd1', code: 'A', name: 'Ciencias de la Salud', sort_order: 1, is_demo: false },
  { id: 'd2', code: 'B', name: 'Negocios', sort_order: 2, is_demo: false },
];

beforeEach(() => {
  // Mid-morning in Cancún, so «hoy»/«empieza en» never depend on the hour the suite happens to run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
  vi.clearAllMocks();
  m.fetchProgress.mockResolvedValue(progress());
  m.fetchDivisions.mockResolvedValue(divisions);
  m.raffle.mockResolvedValue({ has_won: false, raffle_category_name: null, academic_tickets: 0, leadership_tickets: 0 });
});

afterEach(() => vi.useRealTimers());

const renderAt = (path: string, ui: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

// ------------------------------------------------------------------ navegación inferior

test('the bottom navigation always offers Escanear, one tap away, and marks the active tab', () => {
  renderAt('/misiones', <BottomNav />);
  const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
  const scan = within(nav).getByRole('link', { name: 'Escanear asistencia' });
  expect(scan).toHaveAttribute('href', '/escanear');
  expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/bitacora', '/misiones', '/escanear', '/ruta', '/pasaporte']);
  expect(within(nav).getByRole('link', { name: /Misiones/ })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByRole('link', { name: /Inicio/ })).not.toHaveAttribute('aria-current');
});

test('the mission detail keeps Misiones selected in the bottom navigation', () => {
  renderAt('/misiones/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', <BottomNav />);
  expect(screen.getByRole('link', { name: /Misiones/ })).toHaveAttribute('aria-current', 'page');
});

test('Escanear is available from every student screen', () => {
  for (const path of ['/bitacora', '/misiones', '/ruta', '/pasaporte', '/destinos', '/escanear']) {
    const { unmount } = renderAt(path, <BottomNav />);
    expect(screen.getByRole('link', { name: 'Escanear asistencia' })).toHaveAttribute('href', '/escanear');
    unmount();
  }
});

test('Intereses is contextual: it keeps Bitácora highlighted instead of being a permanent tab', () => {
  renderAt('/destinos', <BottomNav />);
  expect(screen.getByRole('link', { name: /Bitácora/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: /Intereses/ })).not.toBeInTheDocument();
});

test('the former routes are still registered (bookmarks keep working) and the new one exists', () => {
  for (const path of ['/bitacora', '/misiones', '/ruta', '/escanear', '/destinos', '/pasaporte']) {
    expect(appSource).toContain(`path="${path}"`);
  }
});

// ------------------------------------------------------------------ inicio

test('Inicio puts the next activity first: what, when, where and how to see the route', async () => {
  m.board = board([session('1', 20 * 60_000, HOUR, { my_reservation_id: 'r1' })], [reservation('r1', '1', 'active')]);
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(within(hero).getByText('Tu siguiente misión')).toBeInTheDocument();
  expect(within(hero).getByRole('heading', { name: 'Taller 1' })).toBeInTheDocument();
  expect(within(hero).getByText(/Empieza en (19|20) min/)).toBeInTheDocument();
  expect(within(hero).getByText('Salón 1')).toBeInTheDocument();
  expect(within(hero).getByRole('link', { name: 'Ver mi ruta' })).toHaveAttribute('href', '/ruta');
  expect(screen.getByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument();
});

test('Inicio with an activity in progress makes it unmistakable and offers the scan', async () => {
  m.board = board([session('1', -10 * 60_000, 20 * 60_000, { my_reservation_id: 'r1' })], [reservation('r1', '1', 'in_progress')]);
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Misión en curso' });
  expect(within(hero).getByText('En curso ahora')).toBeInTheDocument();
  expect(within(hero).getByText(/En curso · termina en/)).toBeInTheDocument();
  expect(within(hero).getByRole('link', { name: 'Escanear asistencia' })).toHaveAttribute('href', '/escanear');
});

test('Inicio without reservations guides to pick workshops instead of showing dead space', async () => {
  m.board = board([], []);
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(within(hero).getByRole('heading', { name: 'Arma tu ruta del día' })).toBeInTheDocument();
  expect(within(hero).getByRole('link', { name: /Explorar misiones/ })).toHaveAttribute('href', '/misiones');
});

// -- Inicio: ONE main action, in human priority order (in progress > imminent > pending attendance > next > pick workshops)
const MIN = 60_000;
const ended = session('old', -2 * HOUR, -HOUR, { my_reservation_id: 'rp' });
const pendingRes = reservation('rp', 'old', 'ended');

test('Home A: an activity in progress beats an old pending attendance, which stays as a secondary notice', async () => {
  m.board = board(
    [ended, session('live', -10 * MIN, 20 * MIN, { my_reservation_id: 'rl' })],
    [pendingRes, reservation('rl', 'live', 'in_progress')],
  );
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Misión en curso' });
  expect(within(hero).getByRole('heading', { name: 'Taller live' })).toBeInTheDocument();
  expect(screen.getByText('¿Ya fuiste a Taller old?')).toBeInTheDocument();
});

test('Home B: next activity in 5 minutes beats the pending attendance (never make them late); pending stays reachable', async () => {
  m.board = board(
    [ended, session('soon', 5 * MIN, 35 * MIN, { my_reservation_id: 'rs' })],
    [pendingRes, reservation('rs', 'soon', 'active')],
  );
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(within(hero).getByRole('heading', { name: 'Taller soon' })).toBeInTheDocument();
  expect(within(hero).getByText(/Empieza en [45] min/)).toBeInTheDocument();
  const reminder = screen.getByRole('link', { name: /¿Ya fuiste a Taller old\?/ });
  expect(reminder).toHaveAttribute('href', '/escanear');
});

test('Home C: next activity in 2 hours → the main action is registering the pending attendance (no contradictory second instruction)', async () => {
  m.board = board(
    [ended, session('later', 2 * HOUR, 3 * HOUR, { my_reservation_id: 'rt' })],
    [pendingRes, reservation('rt', 'later', 'active')],
  );
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Asistencia pendiente' });
  expect(within(hero).getByRole('heading', { name: 'Taller old' })).toBeInTheDocument();
  expect(within(hero).getByText('Falta registrar tu asistencia')).toBeInTheDocument();
  expect(within(hero).getByText(/Terminó a las/)).toBeInTheDocument();
  expect(within(hero).getByRole('link', { name: 'Escanear asistencia' })).toHaveAttribute('href', '/escanear');
  expect(within(hero).getByRole('link', { name: 'Ver mi ruta' })).toHaveAttribute('href', '/ruta');
  // it is not presented as running, nor as a stamp earned, and the same reminder is not repeated below the hero
  expect(within(hero).queryByText(/En curso/)).not.toBeInTheDocument();
  expect(within(hero).queryByText(/sello/i)).not.toBeInTheDocument();
  expect(screen.queryByText('¿Ya fuiste a Taller old?')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Tu siguiente misión' })).not.toBeInTheDocument();
});

test('Home D: with only a pending attendance, that is the main action', async () => {
  m.board = board([ended], [pendingRes]);
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Asistencia pendiente' });
  expect(within(hero).getByRole('link', { name: 'Escanear asistencia' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Elige tu siguiente misión' })).not.toBeInTheDocument();
});

test('Home E: nothing booked and nothing pending → pick workshops', async () => {
  m.board = board([], []);
  renderAt('/bitacora', <Home />);
  const hero = await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(within(hero).getByRole('heading', { name: 'Arma tu ruta del día' })).toBeInTheDocument();
  expect(within(hero).getByRole('link', { name: /Explorar misiones/ })).toHaveAttribute('href', '/misiones');
  expect(screen.queryByText(/¿Ya fuiste a/)).not.toBeInTheDocument();
});

test('Inicio shows progress with a clear hierarchy: rank, stamps and a collection of divisions', async () => {
  m.board = board([], []);
  m.fetchProgress.mockResolvedValue(progress({ level: 2, stamps: 3, attended_workshops: 2, division_ids: ['d1'], next: { level: 3, required_attendances: 5, required_divisions: 0 } }));
  renderAt('/bitacora', <Home />);
  expect(await screen.findByRole('region', { name: 'Tu avance' })).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: /Avance hacia el siguiente/ })).toHaveAttribute('aria-valuenow', '60');
  expect(screen.getByLabelText('Ciencias de la Salud: conseguido')).toBeInTheDocument();
  expect(screen.getByLabelText('Negocios: pendiente')).toBeInTheDocument();
});

// ------------------------------------------------------------------ sellos

test('collected and pending stamps differ by shape and label, not only by colour', () => {
  render(<StampCollection divisions={divisions} visited={new Set(['d1'])} />);
  const collected = screen.getByLabelText('Ciencias de la Salud: conseguido');
  const pending = screen.getByLabelText('Negocios: pendiente');
  expect(collected.querySelector('.border-dashed')).toBeNull();
  expect(pending.querySelector('.border-dashed')).not.toBeNull();
  expect(screen.getByText('1 de 2 divisiones conseguidas', { exact: false })).toBeInTheDocument();
});

// ------------------------------------------------------------------ mi ruta

test('Mi ruta tells apart what is happening now, what is next, what comes later and what is done', async () => {
  m.board = board(
    [
      session('done', -3 * HOUR, -2 * HOUR, { my_reservation_id: 'r0', attended: true }),
      session('now', -10 * 60_000, 20 * 60_000, { my_reservation_id: 'r1' }),
      session('next', HOUR, 2 * HOUR, { my_reservation_id: 'r2' }),
      session('later', 3 * HOUR, 4 * HOUR, { my_reservation_id: 'r3' }),
    ],
    [reservation('r0', 'done', 'completed', { credits_granted: 1 }), reservation('r1', 'now', 'in_progress'), reservation('r2', 'next', 'active'), reservation('r3', 'later', 'active')],
  );
  renderAt('/ruta', <MyRoute />);
  await screen.findByText(/misiones reservadas/);
  const regionOf = (name: string) => screen.getByRole('region', { name });
  expect(within(regionOf('Ahora')).getByRole('heading', { name: 'Taller now' })).toBeInTheDocument();
  expect(within(regionOf('Siguiente')).getByRole('heading', { name: 'Taller next' })).toBeInTheDocument();
  expect(within(regionOf('Después')).getByRole('heading', { name: 'Taller later' })).toBeInTheDocument();
  expect(within(regionOf('Completadas')).getByRole('heading', { name: 'Taller done' })).toBeInTheDocument();
  // the live stop leads with the scan; Cambiar/Cancelar stay small and secondary
  expect(within(regionOf('Ahora')).getByRole('link', { name: 'Escanear asistencia' })).toBeInTheDocument();
  expect(within(regionOf('Completadas')).queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
});

// ------------------------------------------------------------------ reservar

test('after booking, the sheet confirms «Listo. Lo agregamos a tu ruta.» and offers to continue', async () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ConfirmSheet
        onClose={onClose}
        request={{
          title: 'Reservar lugar', body: 'Taller X · 10:00–10:30', confirmLabel: 'Reservar', action,
          summary: { title: 'Taller X', when: '10:00–10:30', where: 'Salón 4' },
          warning: 'Traslado ajustado: tienes menos de 10 min.',
          success: { title: 'Listo. Lo agregamos a tu ruta.', link: { to: '/ruta', label: 'Ver mi ruta' } },
        }}
      />
    </MemoryRouter>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Reservar lugar' });
  expect(within(dialog).getByText('Salón 4')).toBeInTheDocument();
  // a tight transfer is advice (status), never an error alert
  expect(within(dialog).getByRole('status')).toHaveTextContent('Traslado ajustado');
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const done = await screen.findByRole('dialog', { name: 'Listo. Lo agregamos a tu ruta.' });
  expect(within(done).getByRole('link', { name: 'Ver mi ruta' })).toHaveAttribute('href', '/ruta');
  await act(async () => fireEvent.click(within(done).getByRole('button', { name: 'Seguir explorando' })));
  expect(onClose).toHaveBeenCalledWith(true);
});

test('a failed booking shows the reason and never the success feedback', async () => {
  const action = vi.fn().mockRejectedValue(new Error('SESSION_FULL'));
  render(
    <MemoryRouter>
      <ConfirmSheet
        onClose={vi.fn()}
        request={{ title: 'Reservar lugar', body: 'x', confirmLabel: 'Reservar', action, success: { title: 'Listo. Lo agregamos a tu ruta.' } }}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/llenarse/);
  expect(screen.queryByText('Listo. Lo agregamos a tu ruta.')).not.toBeInTheDocument();
});

test('Routes smoke: Inicio renders inside the router without the old Pasaporte scan button', async () => {
  m.board = board([], []);
  render(
    <MemoryRouter initialEntries={['/bitacora']}>
      <Routes>
        <Route path="/bitacora" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(screen.queryByRole('link', { name: 'Escanear asistencia' })).not.toBeInTheDocument();
});
