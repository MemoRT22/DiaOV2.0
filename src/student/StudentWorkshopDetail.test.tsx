import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  term: (key: string, plural?: boolean) => key === 'activity' ? 'Talleres' : key === 'route' ? 'Mi ruta' : key === 'stamp' ? (plural ? 'Sellos' : 'Sello') : key,
  text: () => '',
  rankName: (level: number) => ['Explorador', 'Piloto', 'Navegante', 'Comandante', 'Capitán'][level - 1],
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
/** One of the facts of the summary card (Duración · Horarios · Lugares). */
const factOf = (label: string) => within(screen.getByRole('list', { name: 'Datos de la misión' })).getByText(new RegExp(`^${label}`)).closest('li') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  m.boardError = null;
  m.boardLoading = false;
  m.fetchDetail.mockResolvedValue(metadata);
  m.reserve.mockResolvedValue(undefined);
  m.change.mockResolvedValue(undefined);
});

test('catalogue has one compact card per activity, a clamped pitch, all divisions, and no session controls', async () => {
  mount('/misiones?f=all', board([slot('one'), slot('two', { location: 'Laboratorio 2' })]));
  const heading = await screen.findByRole('heading', { name: 'Taller de prototipos' });
  const card = heading.closest('li') as HTMLElement;
  expect(screen.getAllByRole('heading', { name: 'Taller de prototipos' })).toHaveLength(1);
  expect(within(card).getByText('Ingenierías · Negocios')).toBeInTheDocument();
  expect(within(card).getByText('Construye una idea con tus manos.').className).toMatch(/line-clamp-2/);
  // the card says what and how long; where is the detail's job (less metadata on the card)
  expect(within(card).queryByText('Ubicaciones según horario')).not.toBeInTheDocument();
  expect(within(card).getByText('45 min')).toBeInTheDocument();
  expect(within(card).getByText('2 horarios disponibles')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Ver misión' })).toHaveAttribute('href', `${detailPath}?f=all`); // the way back keeps the list
  expect(within(card).queryByRole('button', { name: 'Reservar' })).not.toBeInTheDocument();
  expect(within(card).queryByText(/Ver más|Ver menos/)).not.toBeInTheDocument();
  expect(m.fetchDetail).not.toHaveBeenCalled();
});

test('a large catalogue does not request editorial detail for its cards', async () => {
  const many = Array.from({ length: 65 }, (_, i) => slot(`session-${i}`, {
    activity_id: `a0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    title: `Taller ${i}`,
  }));
  mount('/misiones?f=all', board(many));
  await screen.findByRole('heading', { name: 'Taller 0' });
  expect(screen.getAllByRole('link', { name: 'Ver misión' })).toHaveLength(65);
  expect(m.fetchDetail).not.toHaveBeenCalled();
});

test('a Vida Universitaria card without academic divisions has a useful label and no per-card detail request', async () => {
  mount('/misiones?f=all', board([slot('life', { title: 'Yoga en campus', division_id: null, division_ids: [] })]));
  const card = (await screen.findByRole('heading', { name: 'Yoga en campus' })).closest('li') as HTMLElement;
  expect(within(card).getByText('Vida Universitaria')).toBeInTheDocument();
  expect(within(card).queryByText(/Ingenierías|Negocios/)).not.toBeInTheDocument();
  expect(m.fetchDetail).not.toHaveBeenCalled();
});

test('catalogue preserves division and change context on the way to the detail and back', async () => {
  mount('/misiones?f=division&d=d2&cambiar=r1', board([slot('one', { ends_at: '2026-10-15T15:15:00Z' }), slot('old', { activity_id: B, title: 'Otro', division_id: 'd1', division_ids: ['d1'] })], {
    reservations: [reservation('r1', 'old')],
  }));
  const card = (await screen.findByRole('heading', { name: 'Taller de prototipos' })).closest('li') as HTMLElement;
  expect(screen.queryByRole('heading', { name: 'Otro' })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('link', { name: 'Ver misión' }));
  const back = await screen.findByRole('button', { name: 'Volver a Misiones' });
  expect(screen.getByRole('button', { name: 'Cambiar aquí' })).toBeInTheDocument();
  fireEvent.click(back);
  expect(await screen.findByRole('heading', { name: 'Misiones' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Otro' })).not.toBeInTheDocument();
  // The original catalogue entry is recovered (not reconstructed): its division and change-flow query still filter the same content.
  expect(screen.getByText(/Elige el nuevo horario para/)).toHaveTextContent('Otro');
  fireEvent.click(within((await screen.findByRole('heading', { name: 'Taller de prototipos' })).closest('li') as HTMLElement).getByRole('link', { name: 'Ver misión' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cambiar aquí' }));
  const dialog = await screen.findByRole('dialog', { name: 'Cambiar horario' });
  expect(within(dialog).getByText('10:00–10:15 · 15 min')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Volver' }));
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Misiones' }));
  expect(await screen.findByRole('button', { name: 'Negocios' })).toHaveAttribute('aria-pressed', 'true');
});

test('En curso filter only shows workshops with a live session and a single division has one name', async () => {
  mount('/misiones?f=all', board([
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

test('Vida Universitaria 10:00–10:15 appears in card and detail, then enters the normal booking flow', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, title: 'Yoga en campus', student_pitch: 'Relájate con una sesión breve.',
    activity_type: 'vida_universitaria', experience_category: 'deportiva', careers: [], divisions: [] });
  mount('/misiones?f=all', board([slot('life', { title: 'Yoga en campus', description: 'Relájate con una sesión breve.',
    division_id: null, division_ids: [], starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:15:00Z',
    location: 'Terraza', capacity: 20, reserved: 5, remaining: 15 })]));
  const card = (await screen.findByRole('heading', { name: 'Yoga en campus' })).closest('li') as HTMLElement;
  expect(within(card).getByText('Vida Universitaria')).toBeInTheDocument();
  expect(within(card).getByText('15 min')).toBeInTheDocument();
  expect(within(card).getByText('1 horario disponible')).toBeInTheDocument();
  fireEvent.click(within(card).getByRole('link', { name: 'Ver misión' }));
  expect(await screen.findByText('Misión · Vida Universitaria · Deportiva')).toBeInTheDocument();
  expect(screen.getByText(/10:00.*15 min/)).toBeInTheDocument();
  expect(screen.getByText('15 de 20 lugares')).toBeInTheDocument();
  expect(screen.getAllByText('Terraza').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  expect(within(dialog).getByText('10:00–10:15 · 15 min')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  await waitFor(() => expect(m.reserve).toHaveBeenCalledWith('life'));
});

test.each([[30, '2026-10-15T15:30:00Z'], [60, '2026-10-15T16:00:00Z']])('academic %i-minute session keeps its actual duration', async (minutes, endsAt) => {
  mount(detailPath, board([slot('academic', { ends_at: endsAt })]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getAllByText(new RegExp(`${minutes} min`)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  expect(within(dialog).getByText(new RegExp(`${minutes} min`))).toBeInTheDocument();
});

test('legacy detail omits absent editorial sections and a failed editorial RPC leaves operational sessions usable', async () => {
  m.fetchDetail.mockRejectedValueOnce(new Error('RPC unavailable'));
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.queryByRole('heading', { name: 'Qué vas a vivir' })).not.toBeInTheDocument();
  expect(screen.getByText(/No pudimos cargar toda la información/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reservar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'reintentar' }));
  await waitFor(() => expect(m.fetchDetail).toHaveBeenCalledTimes(2));
});

test('legacy metadata with null editorial fields opens without empty sections', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, objective: null, takeaway: null, requirements: null, careers: [], divisions: [] });
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.queryByRole('heading', { name: 'Qué vas a vivir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Ideal si te interesa' })).not.toBeInTheDocument();
  // No requirements → no «Antes de ir» block; the place is still shown with the logistics.
  expect(screen.queryByRole('heading', { name: 'Antes de ir' })).not.toBeInTheDocument();
  expect(screen.getAllByText('Laboratorio 1').length).toBeGreaterThan(0);
});

test('experience type and category are shown only when the editorial projection provides them', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, activity_type: 'vida_universitaria', experience_category: 'deportiva' });
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getByText('Misión · Vida Universitaria · Deportiva')).toBeInTheDocument();
});

test('the general Vida Universitaria category is not repeated beside its type', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, activity_type: 'vida_universitaria', experience_category: 'vida_universitaria' });
  mount(detailPath, board([slot('one')]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getByText('Misión · Vida Universitaria')).toBeInTheDocument();
  expect(screen.queryByText(/Vida Universitaria · Vida universitaria/i)).not.toBeInTheDocument();
});

test('a fresh detail read reflects post-publication edits from the activity and editorial submission', async () => {
  m.fetchDetail.mockResolvedValue({ ...metadata, title: 'Título editado', student_pitch: 'Descripción editada',
    objective: 'Objetivo editado', takeaway: 'Aprendizaje editado', requirements: 'Equipo editado' });
  mount(detailPath, board([slot('edited', { title: 'Título editado', description: 'Descripción editada', location: 'Aula nueva' })]));
  expect(await screen.findByRole('heading', { name: 'Título editado' })).toBeInTheDocument();
  expect(screen.getByText('Descripción editada')).toBeInTheDocument();
  expect(screen.getByText('Objetivo editado')).toBeInTheDocument();
  expect(screen.getByText(/Aprendizaje editado/)).toBeInTheDocument();
  expect(screen.getByText('Equipo editado')).toBeInTheDocument();
  expect(screen.getAllByText('Aula nueva').length).toBeGreaterThan(0);
});

test('missing activity shows a useful return path', async () => {
  mount(`/misiones/${B}`, board([slot('one')]));
  expect(screen.getByText('Esta misión no está disponible.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Misiones' }));
  expect(await screen.findByRole('heading', { name: 'Misiones' })).toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Volver a Misiones' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar aquí' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Cambiar horario' })).getByRole('button', { name: 'Confirmar cambio' }));
  expect(await screen.findByRole('heading', { name: 'Mi ruta' })).toBeInTheDocument();
  expect(m.change).toHaveBeenCalledTimes(2);
  expect(m.change).toHaveBeenCalledWith('r1', 'new');
});

// ---------------------------------------------------------------- campus map

test('one shared place → the detail shows building, room and floor with one «Ver en el mapa»', async () => {
  mount(detailPath, board([
    slot('one', { location: 'Negocios 3304, Tercer piso' }),
    slot('two', { location: 'Negocios 3304, Tercer piso', starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z' }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getByText('Escuela Internacional de Negocios')).toBeInTheDocument();
  expect(screen.getByText('Salón 3304 · Tercer piso')).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: /Ver en el mapa/ });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/mapa?sesion=one');
});

test('sessions in different places: each schedule opens ITS own place, never the first session for all', async () => {
  mount(detailPath, board([
    slot('aulas', { location: '1 Sala de Juicios Orales, Planta baja' }),
    slot('rect', { location: 'Rectoría Auditorio San Juan Pablo II', starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z' }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(screen.getByText('Ubicaciones según horario')).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: /Ver en el mapa/ }).map((l) => l.getAttribute('href'));
  expect(links).toEqual(['/mapa?sesion=aulas', '/mapa?sesion=rect']);
  expect(screen.getByText('Edificio de Aulas')).toBeInTheDocument();
  expect(screen.getByText('Administración · Rectoría')).toBeInTheDocument();
});

const CLOSED_MESSAGE = 'Esta misión ya comenzó y terminó su periodo de inscripción. Explora otros horarios disponibles.';

test('a session past its enrollment tolerance explains it and offers no reservation; one inside it shows its limit', async () => {
  mount(detailPath, board([
    slot('late', { started: true, in_progress: true, enrollment_open: false, enrollment_closes_at: '2026-10-15T15:10:00Z' }),
    slot('inside', { starts_at: '2026-10-15T15:30:00Z', ends_at: '2026-10-15T16:00:00Z', started: true, in_progress: true, enrollment_open: true, enrollment_closes_at: '2026-10-15T15:40:00Z' }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(await screen.findAllByText('Inscripción cerrada')).not.toHaveLength(0);
  expect(screen.getByText(CLOSED_MESSAGE)).toBeInTheDocument();
  expect(screen.getByText('Puedes inscribirte hasta las 10:40.')).toBeInTheDocument();
  // Only the open one can be reserved.
  expect(screen.getAllByRole('button', { name: 'Reservar' })).toHaveLength(1);
});

test('the same screen drops the button when enrollment closes while it stays open (board updated by the clock)', async () => {
  const open = board([slot('live', { started: true, in_progress: true, enrollment_open: true, enrollment_closes_at: '2026-10-15T15:10:00Z' })]);
  const view = mount(detailPath, open);
  await screen.findByRole('button', { name: 'Reservar' });
  m.board = board([slot('live', { started: true, in_progress: true, enrollment_open: false, enrollment_closes_at: '2026-10-15T15:10:00Z' })]);
  view.rerender(<MemoryRouter initialEntries={[detailPath]}><Routes>
    <Route path="/misiones/:activityId" element={<StudentWorkshopDetail />} />
  </Routes></MemoryRouter>);
  expect((await screen.findAllByText('Inscripción cerrada')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Reservar' })).not.toBeInTheDocument();
});

test('changing a reservation offers no switch towards a session past its tolerance, but keeps the open ones', async () => {
  mount(`${detailPath}?cambiar=r1`, board([
    slot('old', { activity_id: B, title: 'Otro', starts_at: '2026-10-15T17:00:00Z', ends_at: '2026-10-15T17:30:00Z', my_reservation_id: 'r1' }),
    slot('late', { started: true, in_progress: true, enrollment_open: false }),
    slot('later', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', enrollment_open: true }),
  ], { reservations: [reservation('r1', 'old')], active_reservation_count: 1 }));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(await screen.findAllByText('Inscripción cerrada')).not.toHaveLength(0);
  expect(screen.getAllByRole('button', { name: 'Cambiar aquí' })).toHaveLength(1);
});

test('a server rejection by tolerance (clock race) shows the clear message and keeps the screen usable', async () => {
  m.reserve.mockRejectedValueOnce(new Error('ENROLLMENT_CLOSED'));
  mount(detailPath, board([slot('edge', { started: true, in_progress: true, enrollment_open: true })]));
  fireEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  expect(await within(dialog).findByText(CLOSED_MESSAGE)).toBeInTheDocument();
});

test('the mission card does not promise «reserva y entra ahora» when every live session is past its tolerance', async () => {
  mount('/misiones?f=all', board([slot('late', { started: true, in_progress: true, enrollment_open: false })]));
  const card = (await screen.findByRole('heading', { name: 'Taller de prototipos' })).closest('li') as HTMLElement;
  expect(within(card).queryByText('Puedes reservar y entrar ahora')).not.toBeInTheDocument();
  expect(within(card).getByText('En curso ahora')).toBeInTheDocument();
});

test('closed enrollment with seats left says «Inscripción cerrada», never «Llena»; a truly full mission still says «Llena»', async () => {
  const closed = mount(detailPath, board([slot('late', { started: true, in_progress: true, enrollment_open: false, remaining: 12, reserved: 18 })]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  const fact = factOf('Lugares');
  expect(within(fact).getByText('Inscripción cerrada')).toBeInTheDocument();
  expect(within(fact).queryByText('Llena')).not.toBeInTheDocument();
  closed.unmount();

  mount(detailPath, board([slot('full', { started: true, in_progress: true, enrollment_open: false, remaining: 0, reserved: 30 })]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(within(factOf('Lugares')).getByText('Llena')).toBeInTheDocument();
});

test('seats count only sessions still open for enrollment while another one is bookable', async () => {
  mount(detailPath, board([
    slot('late', { started: true, in_progress: true, enrollment_open: false, remaining: 12 }),
    slot('open', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', remaining: 7 }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  expect(within(factOf('Lugares')).getByText('7 libres')).toBeInTheDocument();
});

test('when every schedule is over the fact says «Finalizada» (not «Llena»), even with unfilled seats', async () => {
  mount(detailPath, board([
    slot('one', { started: true, ended: true, remaining: 10, enrollment_open: false }),
    slot('two', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', started: true, ended: true, remaining: 0, enrollment_open: false }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  const fact = within(factOf('Lugares'));
  expect(fact.getByText('Finalizada')).toBeInTheDocument();
  expect(fact.queryByText(/Llena|Inscripción cerrada/)).not.toBeInTheDocument();
});

test('an ended schedule next to a live one does not mark the mission as finished', async () => {
  mount(detailPath, board([
    slot('one', { started: true, ended: true, remaining: 10, enrollment_open: false }),
    slot('live', { starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T16:45:00Z', started: true, in_progress: true, remaining: 0, enrollment_open: true }),
  ]));
  await screen.findByRole('heading', { name: 'Taller de prototipos' });
  const fact = within(factOf('Lugares'));
  expect(fact.getByText('Llena')).toBeInTheDocument();
  expect(fact.queryByText('Finalizada')).not.toBeInTheDocument();
});

test('after booking, the confirmation shows reservations AND potential stamps: 1 + 1 + 2 credits = 4 possible, 0 won', async () => {
  const mine = [
    slot('s1', { activity_id: 'act-1', credits: 1, my_reservation_id: 'r-s1' }),
    slot('s2', { activity_id: 'act-2', credits: 1, my_reservation_id: 'r-s2' }),
  ];
  const before = board([...mine, slot('free', { credits: 2, ends_at: '2026-10-15T16:00:00Z' })], {
    active_reservation_count: 2, reservations: [reservation('r-s1', 's1', 'act-1'), reservation('r-s2', 's2', 'act-2')],
  });
  // what the screen holds AFTER the server accepted and the board was refreshed: three reservations, the new one worth 2 credits
  const refreshed = board([...mine, slot('free', { credits: 2, ends_at: '2026-10-15T16:00:00Z', my_reservation_id: 'r-new' })], {
    active_reservation_count: 3,
    reservations: [reservation('r-s1', 's1', 'act-1'), reservation('r-s2', 's2', 'act-2'), reservation('r-new', 'free', A)],
  });
  const view = mount(detailPath, before);
  const again = () => view.rerender(<MemoryRouter initialEntries={[detailPath]}><Routes><Route path="/misiones/:activityId" element={<StudentWorkshopDetail />} /></Routes></MemoryRouter>);
  m.reserve.mockImplementation(async () => { m.board = refreshed; again(); });
  fireEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
  const dialog = await screen.findByRole('dialog', { name: 'Reservar lugar' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reservar' }));
  expect(await screen.findByText('¡Listo! Misión agregada a tu ruta')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Tu ruta: 3 de 4 misiones reservadas' })).toBeInTheDocument();
  const plan = screen.getByRole('img', { name: /0 sellos obtenidos en tu ruta, 4 sellos posibles si asistes/ });
  expect(plan.querySelectorAll('[data-stamp="planned"]')).toHaveLength(4);
  expect(plan.querySelectorAll('[data-stamp="earned"]')).toHaveLength(0);
  // the board only knows the stamps of reserved missions, not the official total: no projected rank is promised
  expect(screen.queryByText(/podrías llegar/)).not.toBeInTheDocument();
  expect(screen.getByText(/tu total oficial está en tu bitácora/)).toBeInTheDocument();
  expect(screen.getByText(/se ganan al confirmar tu asistencia/)).toBeInTheDocument();
  expect(screen.queryByText(/desbloque|ganaste|conseguiste/i)).not.toBeInTheDocument();
});

test('a participant with confirmed stamps that are NOT in their reservations never gets a projected rank from the partial board', async () => {
  // the student already holds stamps won without a reservation: the board shows none of them (completed rows: 0)
  const mine = [slot('s1', { activity_id: 'act-1', credits: 1, my_reservation_id: 'r-s1' })];
  const refreshed = board([...mine, slot('free', { credits: 2, ends_at: '2026-10-15T16:00:00Z', my_reservation_id: 'r-new' })], {
    active_reservation_count: 2, reservations: [reservation('r-s1', 's1', 'act-1'), reservation('r-new', 'free', A)],
  });
  const view = mount(detailPath, board([...mine, slot('free', { credits: 2, ends_at: '2026-10-15T16:00:00Z' })], {
    active_reservation_count: 1, reservations: [reservation('r-s1', 's1', 'act-1')],
  }));
  m.reserve.mockImplementation(async () => {
    m.board = refreshed;
    view.rerender(<MemoryRouter initialEntries={[detailPath]}><Routes><Route path="/misiones/:activityId" element={<StudentWorkshopDetail />} /></Routes></MemoryRouter>);
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Reservar lugar' })).getByRole('button', { name: 'Reservar' }));
  await screen.findByText('¡Listo! Misión agregada a tu ruta');
  const plan = screen.getByRole('img', { name: /0 sellos obtenidos en tu ruta, 3 sellos posibles si asistes/ });
  expect(plan.getAttribute('aria-label')).not.toMatch(/podrías llegar|Capitán|Comandante|Piloto|Navegante|Explorador/);
  expect(plan).toHaveTextContent('tu total oficial está en tu bitácora'); // the route's stamps are not the official total
});

const longMetadata = {
  ...metadata,
  objective: 'Una experiencia completa. '.repeat(30).trim(),
  takeaway: 'Un prototipo propio.',
  requirements: 'Trae zapatos cerrados.',
  careers: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Carrera ${i + 1}` })),
};

test('the schedules come right after the summary, before the long academic text (the point of opening a mission)', async () => {
  m.fetchDetail.mockResolvedValue(longMetadata);
  mount(detailPath, board([slot('one'), slot('two', { starts_at: '2026-10-15T17:00:00Z', ends_at: '2026-10-15T17:45:00Z' })]));
  const schedules = await screen.findByRole('region', { name: 'Horarios' });
  const about = await screen.findByRole('region', { name: 'Sobre la misión' });
  const summary = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
  const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(summary, schedules)).toBe(true);
  expect(follows(schedules, about)).toBe(true);
  // the two «Reservar» buttons are reachable before «Qué vas a vivir»
  const firstBook = screen.getAllByRole('button', { name: 'Reservar' })[0];
  expect(follows(firstBook, within(about).getByRole('heading', { name: 'Qué vas a vivir' }))).toBe(true);
  // no scroll-anchor button any more: the times are already there
  expect(screen.queryByRole('link', { name: /Elegir horario/ })).not.toBeInTheDocument();
});

test('the summary answers what, how long, how many places and where in one compact card', async () => {
  mount(detailPath, board([slot('one')]));
  const facts = await screen.findByRole('list', { name: 'Datos de la misión' });
  expect(within(facts).getAllByRole('listitem')).toHaveLength(3);
  expect(factOf('Duración')).toHaveTextContent('45 min');
  expect(factOf('Horarios')).toHaveTextContent('1 disponible');
  expect(factOf('Lugares')).toHaveTextContent('25 libres');
  const header = screen.getByRole('heading', { level: 1 }).closest('header') as HTMLElement;
  expect(within(header).getByText('Laboratorio 1')).toBeInTheDocument();
  expect(within(header).getByRole('link', { name: /Ver en el mapa/ })).toBeInTheDocument();
});

test('nothing academic is removed: objective, takeaway, every career and the divisions are all still there', async () => {
  m.fetchDetail.mockResolvedValue(longMetadata);
  mount(detailPath, board([slot('one')]));
  const about = await screen.findByRole('region', { name: 'Sobre la misión' });
  expect(within(about).getByText(/Una experiencia completa\./)).toBeInTheDocument();
  expect(within(about).getByText(/Un prototipo propio\./)).toBeInTheDocument();
  expect(within(about).getByText('Ingenierías · Negocios')).toBeInTheDocument();
  // the first careers show and the rest are one tap away
  const careers = within(about).getByRole('list', { name: 'Carreras' });
  expect(within(careers).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Carrera 1', 'Carrera 2', 'Carrera 3', 'Carrera 4', '+3 más']);
  fireEvent.click(within(careers).getByRole('button', { name: '+3 más' }));
  expect(within(careers).getByText('Carrera 7')).toBeInTheDocument();
  expect(within(careers).getByRole('button', { name: 'Ver menos' })).toHaveAttribute('aria-expanded', 'true');
});

test('«Antes de ir» stays visible, right under the schedules, when the mission has requirements', async () => {
  m.fetchDetail.mockResolvedValue(longMetadata);
  mount(detailPath, board([slot('one')]));
  const before = await screen.findByRole('heading', { name: 'Antes de ir' });
  expect(screen.getByText('Trae zapatos cerrados.')).toBeVisible();
  const schedules = screen.getByRole('region', { name: 'Horarios' });
  expect(schedules.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a mission with no academic metadata shows its summary and schedules, and no empty «Sobre la misión»', async () => {
  m.fetchDetail.mockResolvedValue(null);
  mount(detailPath, board([slot('one')]));
  expect(await screen.findByRole('region', { name: 'Horarios' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Sobre la misión' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Antes de ir' })).not.toBeInTheDocument();
});

test('the booking sheet closes with the browser Back button and the mission stays on screen', async () => {
  mount(detailPath, board([slot('one')]));
  fireEvent.click(await screen.findByRole('button', { name: 'Reservar' }));
  expect(await screen.findByRole('dialog', { name: 'Reservar lugar' })).toBeInTheDocument();
  act(() => { window.history.back(); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(m.reserve).not.toHaveBeenCalled();
});
