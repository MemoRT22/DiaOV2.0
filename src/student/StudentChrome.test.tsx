import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Board } from '../lib/reservations';
import { useAuth } from '../lib/auth';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import StudentLayout from './StudentLayout';
import WindowNotice from './reservations/WindowNotice';

vi.mock('../lib/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/auth')>(), useAuth: vi.fn() }));
vi.mock('../edition/EditionProvider', () => ({ useEdition: vi.fn() }));
vi.mock('../theme/PublicThemeProvider', () => ({ usePublicTheme: vi.fn() }));
vi.mock('../components/themed', () => ({ Backdrop: () => null }));
vi.mock('./BottomNav', () => ({ default: () => <nav aria-label="Navegación principal" /> }));
vi.mock('./ExitSurveyInvite', () => ({ default: () => null }));
vi.mock('./ExitSurveyProvider', () => ({ ExitSurveyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./RafflePrizeProvider', () => ({ RafflePrizeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./WinnerNotice', () => ({ default: () => null }));

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ ready: true, profile: { display_name: 'Ana Pérez', platform_consent_version: 'v1' } } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useEdition).mockReturnValue({ loading: false, edition: { privacy_notice_version: 'v1' } } as unknown as ReturnType<typeof useEdition>);
  vi.mocked(usePublicTheme).mockReturnValue({ loading: false, theme: { assets: {}, meta: { eventName: 'Día OV' } } } as unknown as ReturnType<typeof usePublicTheme>);
});

function MapProbe() {
  const { state, pathname } = useLocation();
  return <p>{`en ${pathname} · viene de ${(state as { from?: string } | null)?.from ?? 'nada'}`}</p>;
}

const layout = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<StudentLayout />}>
          <Route path="/misiones" element={<p>Pantalla</p>} />
          <Route path="/ruta" element={<p>Ruta</p>} />
          <Route path="/mapa" element={<MapProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

test('the header offers the campus map (not a second way into the Bitácora, which already has its tab)', () => {
  layout('/misiones');
  const header = screen.getByRole('banner');
  const map = within(header).getByRole('link', { name: 'Mapa del campus' });
  expect(map).toHaveAttribute('href', '/mapa');
  expect(within(header).queryByRole('link', { name: /bitácora/i })).not.toBeInTheDocument();
});

test('regression (PR #51 review): opening the map from the header remembers the screen it came from, so «Volver» does not always land on Inicio', () => {
  layout('/misiones?f=division&d=d2');
  fireEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Mapa del campus' }));
  expect(screen.getByText('en /mapa · viene de /misiones?f=division&d=d2')).toBeInTheDocument();
});

test('on the map itself the badge only says where you are: no link to itself that would erase the way back', () => {
  layout('/mapa');
  const header = screen.getByRole('banner');
  expect(within(header).queryByRole('link', { name: 'Mapa del campus' })).not.toBeInTheDocument();
  expect(within(header).getByText('Mapa').closest('[aria-current="page"]')).not.toBeNull();
});

const board = (over: Partial<Board> = {}): Board => ({
  server_time: '2026-10-15T15:00:00Z', window: 'open', opens_at: '2026-10-14T16:40:00Z', closes_at: '2026-10-15T17:30:00Z', max_reservations: 4,
  active_reservation_count: 0, travel_buffer_minutes: 10, sessions: [], reservations: [], ...over,
});

test('the open window is one small line with the time of closing today (12:30 Cancún), and Mi ruta can hide it', () => {
  const { rerender } = render(<WindowNotice board={board()} />);
  expect(screen.getByRole('status')).toHaveTextContent('Reservas abiertas hasta hoy a las 12:30');
  rerender(<WindowNotice board={board()} hideOpen />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('a restriction is never hidden, even where the open window is', () => {
  render(<WindowNotice board={board({ window: 'closed' })} hideOpen />);
  expect(screen.getByRole('status')).toHaveTextContent('Las reservaciones cerraron');
});

test('when it closes on another day, the date is spelled out', () => {
  render(<WindowNotice board={board({ server_time: '2026-10-14T20:00:00Z' })} />);
  expect(screen.getByRole('status')).toHaveTextContent(/Reservas abiertas hasta .*15 oct/);
});
