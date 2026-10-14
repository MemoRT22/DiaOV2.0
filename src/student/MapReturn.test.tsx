import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board } from '../lib/reservations';
import { neutralTheme } from '../theme/neutralTheme';
import MapPage from './MapPage';
import StudentLayout from './StudentLayout';

const m = vi.hoisted(() => ({ board: null as unknown }));

vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ loading: false, edition: { id: 'ed', privacy_notice_version: 'v1' } }) }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ ready: true, profile: { display_name: 'Ana López', platform_consent_version: 'v1' }, signOut: vi.fn() }) }));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme, loading: false,
    term: (key: 'stamp' | 'division' | 'rank', plural = false) => (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: (key: string) => (neutralTheme.texts as Record<string, string>)[key] ?? '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));
vi.mock('../components/themed', () => ({ Backdrop: () => null }));
vi.mock('../lib/useReservationBoard', () => ({
  useReservationBoard: () => ({ board: m.board, error: null, loading: false, reload: vi.fn(), reserve: vi.fn(), change: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('./BottomNav', () => ({ default: () => <nav aria-label="Navegación principal" /> }));
vi.mock('./ExitSurveyInvite', () => ({ default: () => null }));
vi.mock('./ExitSurveyProvider', () => ({ ExitSurveyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./RafflePrizeProvider', () => ({ RafflePrizeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./WinnerNotice', () => ({ default: () => null }));

function Origin() {
  const { pathname, search } = useLocation();
  return <p>{`pantalla de origen: ${pathname}${search}`}</p>;
}

const board = (): Board => ({
  server_time: '', window: 'open', opens_at: null, closes_at: null, max_reservations: 4, active_reservation_count: 0, travel_buffer_minutes: 10, sessions: [], reservations: [],
});

beforeEach(() => {
  m.board = board();
});

// The app header is the first <header>; the map page has its own.
const appHeader = () => document.querySelector('header') as HTMLElement;

const app = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<StudentLayout />}>
          <Route path="/misiones" element={<Origin />} />
          <Route path="/ruta" element={<Origin />} />
          <Route path="/mapa" element={<MapPage />} />
          <Route path="/bitacora" element={<p>Inicio</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

test.each([
  ['/misiones?f=division&d=d2&q=radio', 'a filtered, searched catalogue'],
  ['/misiones?f=life&c=deportiva', 'Vida Universitaria narrowed to one kind of experience'],
  ['/misiones?cambiar=r1&f=all', 'the change-reservation flow'],
  ['/ruta', 'Mi ruta'],
])('header Mapa → Volver returns to the exact screen and filters it came from (%s: %s)', async (entry) => {
  app(entry);
  expect(screen.getByText(`pantalla de origen: ${entry}`)).toBeInTheDocument();
  fireEvent.click(within(appHeader()).getByRole('link', { name: 'Mapa del campus' }));
  await screen.findByRole('heading', { name: 'Mapa del campus' });
  // on the map the header badge only says where we are; the way back is the page's own «Volver»
  expect(within(appHeader()).queryByRole('link', { name: 'Mapa del campus' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(await screen.findByText(`pantalla de origen: ${entry}`)).toBeInTheDocument();
  expect(screen.queryByText('Inicio')).not.toBeInTheDocument();
});

test('opening the map directly (no origin) still falls back to Inicio', async () => {
  app('/mapa');
  fireEvent.click(await screen.findByRole('button', { name: 'Volver' }));
  expect(await screen.findByText('Inicio')).toBeInTheDocument();
});
