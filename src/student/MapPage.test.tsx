import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Board, BoardSession, MyReservation } from '../lib/reservations';
import { neutralTheme } from '../theme/neutralTheme';
import Home from './Home';
import MapPage from './MapPage';
import MyRoute from './MyRoute';

const m = vi.hoisted(() => ({
  board: null as unknown, reserve: vi.fn(), change: vi.fn(), cancel: vi.fn(),
  fetchProgress: vi.fn(), fetchDivisions: vi.fn(), raffle: vi.fn(),
}));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition: { id: 'ed' } }) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ profile: { display_name: 'Ana López' }, signOut: vi.fn() }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    term: (key: 'stamp' | 'division' | 'rank', plural = false) => (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: vi.fn(), reserve: m.reserve, change: m.change, cancel: m.cancel }),
}));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchProgress: m.fetchProgress,
  fetchDivisions: m.fetchDivisions,
}));
vi.mock('../lib/raffleApi', () => ({ fetchMyRaffleStatus: m.raffle }));

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const session = (id: string, start: number, location: string, over: Partial<BoardSession> = {}): BoardSession => ({
  id, activity_id: `a-${id}`, title: `Misión ${id}`, description: '', division_id: 'd1', starts_at: iso(start), ends_at: iso(start + HOUR / 2), location,
  credits: 1, status: 'activa', capacity: 30, reserved: 1, remaining: 29, started: start <= 0, ended: false, in_progress: start <= 0,
  attended: false, my_reservation_id: `r-${id}`, conflicts_with: [], tight_transfer_with: [], ...over,
});
const reservation = (s: BoardSession, derived = 'active'): MyReservation => ({
  id: `r-${s.id}`, session_id: s.id, activity_id: s.activity_id, status: 'vigente', created_at: '', ended_at: null, resolved: false,
  derived_status: derived, credits_granted: null,
});
const board = (sessions: BoardSession[], reservations = sessions.map((s) => reservation(s))): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: reservations.length,
  travel_buffer_minutes: 10, sessions, reservations,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
  vi.clearAllMocks();
  m.fetchProgress.mockResolvedValue({ level: 1, stamps: 0, attended_workshops: 0, reserved_workshops: 0, division_ids: [], next: null, consent_accepted: true, post_event_interests_prompt: false, post_event_interests_open: false, post_event_interests_completed: false });
  m.fetchDivisions.mockResolvedValue([]);
  m.raffle.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

const app = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/bitacora" element={<Home />} />
        <Route path="/ruta" element={<MyRoute />} />
        <Route path="/mapa" element={<MapPage />} />
      </Routes>
    </MemoryRouter>,
  );

/** The building on the drawing (the text list below the map repeats the same names on purpose, as its alternative). */
const zoneButton = (name: RegExp | string) => {
  const el = screen.getAllByRole('button', { name }).find((b) => b.tagName.toLowerCase() === 'g');
  if (!el) throw new Error(`no map building named ${String(name)}`);
  return el;
};

test('Inicio → «Ver ubicación» opens THAT session: building highlighted, room and floor in words, and «Volver» comes back', async () => {
  const hub = session('hub', 30 * 60_000, 'Negocios HUB de IA y Ciberseguridad, Planta baja', { title: 'Cybersecurity Challenge' });
  m.board = board([hub]);
  app('/bitacora');
  const hero = await screen.findByRole('region', { name: 'Tu siguiente misión' });
  expect(within(hero).getByText('Escuela Internacional de Negocios')).toBeInTheDocument();
  const link = within(hero).getByRole('link', { name: /Ver ubicación/ });
  expect(link).toHaveAttribute('href', '/mapa?sesion=hub');
  // the main action keeps its place: the map link is not the primary button
  expect(within(hero).getByRole('link', { name: 'Ver mi ruta' })).toBeInTheDocument();

  fireEvent.click(link);
  const card = await screen.findByRole('region', { name: 'Tu misión es aquí' });
  expect(within(card).getByText('Cybersecurity Challenge')).toBeInTheDocument();
  expect(within(card).getByText('Escuela Internacional de Negocios')).toBeInTheDocument();
  expect(within(card).getByText('HUB de IA y Ciberseguridad · Planta baja')).toBeInTheDocument();
  expect(within(card).getByText(/10:30–11:00/)).toBeInTheDocument();
  expect(zoneButton('Escuela Internacional de Negocios')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument();
});

test('Mi ruta → «Ver mapa»: missions numbered in time order, two in the same building share ONE readable marker', async () => {
  const a = session('a', HOUR, 'Negocios 3304, Tercer piso');
  const b = session('b', 2 * HOUR, 'Le Cordon Bleu Cocina 1, Planta baja');
  const c = session('c', 3 * HOUR, 'Negocios Sala Alpha, Primer piso');
  m.board = board([c, a, b]);
  const { container } = app('/ruta');
  const routeLink = await screen.findByRole('link', { name: 'Ver mi ruta en el mapa del campus' });
  expect(routeLink).toHaveAttribute('href', '/mapa?vista=ruta');
  fireEvent.click(routeLink);

  expect(await screen.findByRole('heading', { name: 'Tu ruta en el mapa' })).toBeInTheDocument();
  const markers = [...container.querySelectorAll('.campus-marker')].map((g) => ({ label: g.textContent, next: g.classList.contains('is-next') }));
  expect(markers).toEqual([
    { label: '1·3', next: true },
    { label: '2', next: false },
  ]);
  const list = screen.getByRole('region', { name: 'Tu ruta en orden' });
  const titles = within(list).getAllByRole('button').map((b) => b.textContent ?? '');
  expect(titles[0]).toMatch(/Siguiente.*Misión a.*Escuela Internacional de Negocios · Salón 3304 · Tercer piso/);
  expect(titles[1]).toMatch(/Misión b.*Edificio Le Cordon Bleu · Cocina 1 · Planta baja/);
  expect(titles[2]).toMatch(/Misión c/);
  expect(screen.getByText(/no es un camino a pie/)).toBeInTheDocument();

  // choosing #2 identifies its building
  fireEvent.click(within(list).getAllByRole('button')[1]);
  expect(zoneButton('Edificio Le Cordon Bleu')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Edificio Le Cordon Bleu' })).toBeInTheDocument();
});

test('every Mi ruta station offers a discreet «Cómo llegar» to its own session', async () => {
  const a = session('a', HOUR, 'Negocios 3304, Tercer piso');
  const b = session('b', 2 * HOUR, 'Rectoría CASA');
  m.board = board([a, b]);
  app('/ruta');
  expect(await screen.findByRole('link', { name: 'Cómo llegar a Misión a' })).toHaveAttribute('href', '/mapa?sesion=a');
  expect(screen.getByRole('link', { name: 'Cómo llegar a Misión b' })).toHaveAttribute('href', '/mapa?sesion=b');
});

test('an unknown place is not pinned on an invented building: original text, whole campus, clear notice', async () => {
  m.board = board([session('x', HOUR, 'Explanada principal', { title: 'Rally' })]);
  app('/mapa?sesion=x');
  const notice = await screen.findByRole('region', { name: 'Ubicación sin punto en el mapa' });
  expect(within(notice).getByText(/No tenemos el punto exacto/)).toBeInTheDocument();
  expect(within(notice).getByText(/Explanada principal/)).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Tu misión es aquí' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('button', { pressed: true }).filter((b) => b.tagName.toLowerCase() === 'g')).toHaveLength(0);
});

test('a session that is not on the board falls back to the whole campus', async () => {
  m.board = board([]);
  app('/mapa?sesion=nope');
  expect(await screen.findByText(/No encontramos esa misión/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Mapa del campus' })).toBeInTheDocument();
});

test('buildings are keyboard-operable and show what is there plus MY missions in them', async () => {
  m.board = board([session('a', HOUR, 'Media Center VFX Lab', { title: 'Efectos visuales' })]);
  app('/mapa');
  await screen.findByRole('heading', { name: 'Mapa del campus' });
  const medios = zoneButton(/Centro de Medios/);
  expect(medios).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(medios, { key: 'Enter' });
  expect(medios).toHaveAttribute('aria-pressed', 'true');
  const card = screen.getByRole('region', { name: 'Centro de Medios' });
  expect(within(card).getByText(/Tu siguiente misión está aquí|Tus misiones aquí/)).toBeInTheDocument();
  expect(within(card).getByText('Efectos visuales')).toBeInTheDocument();
  expect(within(card).getByText(/VFX Lab/)).toBeInTheDocument();
});

test('the map is read-only: browsing it never reserves, changes or cancels', async () => {
  const a = session('a', HOUR, 'Negocios 3304, Tercer piso');
  m.board = board([a]);
  app('/mapa?vista=ruta');
  await screen.findByRole('heading', { name: 'Tu ruta en el mapa' });
  for (const name of [/Escuela Internacional de Negocios/, /Edificio de Aulas/, /Iglesia Universitaria/]) fireEvent.click(zoneButton(name));
  fireEvent.click(screen.getByRole('button', { name: 'Ver todo el campus' }));
  expect(m.reserve).not.toHaveBeenCalled();
  expect(m.change).not.toHaveBeenCalled();
  expect(m.cancel).not.toHaveBeenCalled();
});
