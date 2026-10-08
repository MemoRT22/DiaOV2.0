import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession, MyReservation } from '../lib/reservations';
import Missions from './Missions';
import StudentWorkshopDetail from './StudentWorkshopDetail';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const m = vi.hoisted(() => ({ board: null as unknown, boardError: null as unknown, boardLoading: false, reload: vi.fn(), fetchDetail: vi.fn(), reserve: vi.fn(), change: vi.fn() }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'edition' } }) }));
vi.mock('../theme/PublicThemeProvider', () => ({ usePublicTheme: () => ({
  theme: { colors: { secondary: '#888' }, divisions: {} },
  term: (key: string) => key === 'activity' ? 'Talleres' : key === 'route' ? 'Mi ruta' : key,
  text: () => '',
}) }));
vi.mock('../lib/useReservationBoard', () => ({ useReservationBoard: () => ({
  board: m.board, error: m.boardError, loading: m.boardLoading, reload: m.reload, reserve: m.reserve, change: m.change,
}) }));
vi.mock('../lib/workshopDetailApi', () => ({ fetchWorkshopDetail: m.fetchDetail }));
vi.mock('../lib/catalog', async (original) => ({ ...(await original<typeof import('../lib/catalog')>()),
  fetchDivisions: vi.fn().mockResolvedValue([
    { id: 'd1', code: 'ONE', name: 'Ingenierías' },
    { id: 'd2', code: 'TWO', name: 'Negocios' },
  ]),
}));
vi.mock('../lib/recommendationsApi', () => ({ fetchRecommendedActivities: vi.fn().mockResolvedValue({ recommendations: [] }) }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: vi.fn(), subscribeParticipantChanges: () => () => {} }));

const slot = (id: string, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: A, title: 'Taller de prototipos', description: 'Construye una idea con tus manos.', division_id: null, division_ids: ['d1', 'd2'],
  starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:45:00Z', location: 'Laboratorio 1', credits: 1,
  status: 'activa', capacity: 30, reserved: 5, remaining: 25, started: false, ended: false, in_progress: false,
  attended: false, my_reservation_id: null, conflicts_with: [], tight_transfer_with: [], ...over,
});
const board = (sessions: BoardSession[], over: Partial<Board> = {}): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0,
  travel_buffer_minutes: 10, sessions, reservations: [], ...over,
});
const reservation = (id: string, sessionId: string, activityId = B): MyReservation => ({
  id, session_id: sessionId, activity_id: activityId, status: 'vigente', created_at: '', ended_at: null,
  resolved: false, derived_status: 'active', credits_granted: null,
});
const metadata = {
  activity_id: A, title: 'Taller de prototipos', student_pitch: 'Construye una idea con tus manos.', activity_type: 'academica',
  experience_category: null, objective: 'Diseñar una solución.', takeaway: 'Un prototipo propio.', requirements: 'Trae zapatos cerrados.',
  careers: [{ id: 'c1', name: 'Ingeniería Mecatrónica' }], divisions: [{ id: 'd1', name: 'Ingenierías' }, { id: 'd2', name: 'Negocios' }],
};

function mount(path: string, data: Board) {
  m.board = data;
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/misiones" element={<Missions />} />
    <Route path="/misiones/:activityId" element={<StudentWorkshopDetail />} />
    <Route path="/ruta" element={<h1>Mi ruta</h1>} />
  </Routes></MemoryRouter>);
}
const detailPath = `/misiones/${A}`;

beforeEach(() => {
  vi.clearAllMocks();
  m.boardError = null;
  m.boardLoading = false;
  m.fetchDetail.mockResolvedValue(metadata);
  m.reserve.mockResolvedValue(undefined);
  m.change.mockResolvedValue(undefined);
});

test('catalogue has one compact card per activity, a clamped pitch, all divisions, and no session controls', async () => {
  mount('/misiones', board([slot('one'), slot('two', { location: 'Laboratorio 2' })]));
  const heading = await screen.findByRole('heading', { name: 'Taller de prototipos' });
  const card = heading.closest('li') as HTMLElement;
  expect(screen.getAllByRole('heading', { name: 'Taller de prototipos' })).toHaveLength(1);
  expect(within(card).getByText('Ingenierías · Negocios')).toBeInTheDocument();
  expect(within(card).getByText('Construye una idea con tus manos.').className).toMatch(/line-clamp-3/);
  expect(within(card).getByText('Ubicaciones según horario')).toBeInTheDocument();
  expect(within(card).getByText('2 horarios disponibles')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Ver taller' })).toHaveAttribute('href', detailPath);
  expect(within(card).queryByRole('button', { name: 'Reservar' })).not.toBeInTheDocument();
  expect(within(card).queryByText(/Ver más|Ver menos/)).not.toBeInTheDocument();
  expect(m.fetchDetail).not.toHaveBeenCalled();
});

test('a large catalogue does not request editorial detail for its cards', async () => {
  const many = Array.from({ length: 65 }, (_, i) => slot(`session-${i}`, {
    activity_id: `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    title: `Taller ${i}`,
  }));
  mount('/misiones', board(many));
  await screen.findByRole('heading', { name: 'Taller 0' });
  expect(screen.getAllByRole('link', { name: 'Ver taller' })).toHaveLength(65);
  expect(m.fetchDetail).not.toHaveBeenCalled();
});

test('catalogue preserves division and change context on the way to the detail and back', async () => {
  mount('/misiones?f=division&d=d2&cambiar=r1', board([slot('one'), slot('old', { activity_id: B, title: 'Otro', division_id: 'd1', division_ids: ['d1'] })], {
    reservations: [reservation('r1', 'old')],
  }));
  const card = (await screen.findByRole('heading', { name: 'Taller de prototipos' })).closest('li') as HTMLElement;
  expect(screen.queryByRole('heading', { name: 'Otro' })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('link', { name: 'Ver taller' }));
  const back = await screen.findByRole('link', { name: 'Volver a Talleres' });
  expect(back).toHaveAttribute('href', '/misiones?f=division&d=d2&cambiar=r1');
  expect(screen.getByRole('button', { name: 'Cambiar aquí' })).toBeInTheDocument();
  fireEvent.click(back);
  expect(await screen.findByRole('button', { name: 'Negocios' })).toHaveAttribute('aria-pressed', 'true');
});

test('En curso filter only shows workshops with a live session and a single division has one name', async () => {
  mount('/misiones', board([
    slot('live', { in_progress: true, division_id: 'd1', division_ids: ['d1'] }),
    slot('later', { activity_id: B, title: 'Después', division_id: 'd2', division_ids: ['d2'] }),
  ]));
  const live = (await screen.findByRole('heading', { name: 'Taller de prototipos' })).closest('li') as HTMLElement;
  expect(within(live).getByText('Ingenierías')).toBeInTheDocument();
  expect(within(live).getByText('En curso')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'En curso' }));
  expect(screen.queryByRole('heading', { name: 'Después' })).not.toBeInTheDocument();
});

test('detail loads editorial fields and the board sessions, with visible time, duration, seats and location', async () => {
  mount(detailPath, board([slot('one'), slot('two', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', location: 'Laboratorio 2' })]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(m.fetchDetail).toHaveBeenCalledTimes(1);
  expect(m.fetchDetail).toHaveBeenCalledWith(A);
  expect(screen.getByText('Diseñar una solución.')).toBeInTheDocument();
  expect(screen.getByText(/Un prototipo propio/)).toBeInTheDocument();
  expect(screen.getByText(/Ingeniería Mecatrónica/)).toBeInTheDocument();
  expect(screen.getByText(/Ingenierías · Negocios/)).toBeInTheDocument();
  expect(screen.getByText('Trae zapatos cerrados.')).toBeInTheDocument();
  expect(screen.getAllByText('25 de 30 lugares')).toHaveLength(2);
  expect(screen.getAllByText(/45 min/).length).toBeGreaterThan(0);
  expect(screen.getByText('Laboratorio 1')).toBeInTheDocument();
  expect(screen.getByText('Laboratorio 2')).toBeInTheDocument();
});

test('legacy detail omits absent editorial sections and a failed editorial RPC leaves operational sessions usable', async () => {
  m.fetchDetail.mockRejectedValueOnce(new Error('RPC unavailable'));
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.queryByRole('heading', { name: 'Qué vas a hacer' })).not.toBeInTheDocument();
  expect(screen.getByText(/No pudimos cargar toda la información/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reservar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'reintentar' }));
  await waitFor(() => expect(m.fetchDetail).toHaveBeenCalledTimes(2));
});

test('legacy metadata with null editorial fields opens without empty sections', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, objective: null, takeaway: null, requirements: null, careers: [], divisions: [] });
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.queryByRole('heading', { name: 'Qué vas a hacer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Para quién' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Antes de ir' })).toBeInTheDocument();
});

test('experience type and category are shown only when the editorial projection provides them', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, activity_type: 'vida_universitaria', experience_category: 'deportiva' });
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getByText('Vida universitaria · Deporte')).toBeInTheDocument();
});

test('missing activity shows a useful return path', async () => {
  mount(`/misiones/${B}`, board([slot('one')]));
  expect(screen.getByText('Este taller no está disponible.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Volver a Talleres' })).toHaveAttribute('href', '/misiones');
});

test('board loading and failure provide a retry path', async () => {
  m.boardLoading = true;
  m.board = null;
  const view = render(<MemoryRouter initialEntries={[detailPath]}><Routes><Route path="/misiones/:activityId" element={<StudentWorkshopDetail />} /></Routes></MemoryRouter>);
  expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument();
  view.unmount();
  m.boardLoading = false;
  m.boardError = new Error('offline');
  mount(detailPath, board([slot('one')]));
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(m.reload).toHaveBeenCalledTimes(1);
});

test('booking uses the existing confirmation, supports in-progress entry, and failed booking shows the server error', async () => {
  m.reserve.mockRejectedValueOnce(new Error('SESSION_FULL'));
  mount(detailPath, board([slot('live', { started: true, in_progress: true })]));
  await screen.findByText('En curso · puedes entrar');
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  expect(within(dialog).getByText('Ya está en curso: puedes entrar ahora.')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  expect(await within(dialog).findByText(/acaba de llenarse/)).toBeInTheDocument();
  expect(m.reserve).toHaveBeenCalledWith('live');
});

test('full, conflict and maximum reservation states keep their existing block rules', async () => {
  mount(detailPath, board([
    slot('full', { remaining: 0, reserved: 30 }),
    slot('conflict', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', conflicts_with: ['r9'] }),
  ], { active_reservation_count: 4 }));
  await screen.findByText('Llena');
  expect(screen.getByText('Choca con tu ruta')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reservar' })).not.toBeInTheDocument();
});

test('maximum reservations blocks a free session; a reserved session remains visibly reserved', async () => {
  mount(detailPath, board([
    slot('free'),
    slot('mine', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', my_reservation_id: 'r2' }),
  ], { active_reservation_count: 4, reservations: [{ ...reservation('r2', 'mine', A), derived_status: 'ended' }] }));
  await screen.findByText('Ruta completa');
  expect(screen.getByText('Reservada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reservar' })).not.toBeInTheDocument();
});

test('tight transfer remains advice within confirmation, not a block', async () => {
  mount(detailPath, board([slot('tight', { tight_transfer_with: ['r9'] })]));
  await screen.findByText(/Traslado ajustado · menos de 10 min/);
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  expect(within(dialog).getByText(/Traslado ajustado: tienes menos de 10 min/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  await waitFor(() => expect(m.reserve).toHaveBeenCalledWith('tight'));
});

test('successful change navigates to Mi ruta; failed change keeps old reservation and context', async () => {
  m.change.mockRejectedValueOnce(new Error('SESSION_FULL'));
  const old = slot('old', { activity_id: B, title: 'Taller anterior', my_reservation_id: 'r1' });
  const data = board([old, slot('new')], { active_reservation_count: 1, reservations: [reservation('r1', 'old')] });
  mount(`${detailPath}?cambiar=r1`, data);
  await screen.findByRole('button', { name: 'Cambiar aquí' });
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar aquí' }));
  const dialog = await screen.findByRole('dialog', { name: 'Cambiar horario' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cambio' }));
  expect(await within(dialog).findByText(/acaba de llenarse/)).toBeInTheDocument();
  expect(data.reservations[0]).toMatchObject({ id: 'r1', session_id: 'old', status: 'vigente' });
  expect(screen.getByRole('link', { name: 'Volver a Talleres' })).toHaveAttribute('href', '/misiones?cambiar=r1');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar aquí' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Cambiar horario' })).getByRole('button', { name: 'Confirmar cambio' }));
  expect(await screen.findByRole('heading', { name: 'Mi ruta' })).toBeInTheDocument();
  expect(m.change).toHaveBeenCalledTimes(2);
  expect(m.change).toHaveBeenCalledWith('r1', 'new');
});
