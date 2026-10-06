import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { fetchOperationsOverview, type OperationsOverview, type OperationsSession } from '../lib/operationsApi';
import OperationsCenter from './OperationsCenter';

vi.mock('../lib/operationsApi', () => ({ fetchOperationsOverview: vi.fn() }));
// Note: no PublicThemeProvider / theme module is rendered or mocked. The console must not depend on the public theme.

const SALUD = { id: 'd-salud', code: 'SAL', name: 'Salud' };
const ING = { id: 'd-ing', code: 'ING', name: 'Ingeniería' };
const EVENT_DAY = Date.parse('2026-10-15T15:00:00Z'); // 10:00 en Cancún
const BEFORE = Date.parse('2026-10-05T16:00:00Z');

let n = 0;
const at = (base: number, minutes: number) => new Date(base + minutes * 60_000).toISOString();
function session(base: number, over: Partial<OperationsSession> = {}): OperationsSession {
  n += 1;
  return {
    session_id: `sid-${n}`, activity_id: `act-${n}`, title: `Taller ${n}`, divisions: [SALUD], starts_at: at(base, 60), ends_at: at(base, 90),
    location: 'Edificio A', status: 'activa', capacity: 30, reserved: 10, remaining: 20, attended: 0,
    affected_reservations: 0, affected_unresolved: 0, ...over,
  };
}
function overview(base: number, sessions: OperationsSession[], over: Partial<OperationsOverview> = {}): OperationsOverview {
  return {
    server_time: new Date(base).toISOString(), mode: 'preparacion', event_date: '2026-10-15', timezone: 'America/Cancun',
    checkin_close_after_minutes: 20, sessions,
    summary: {
      participants_total: 1842, active_reservations: 640, participants_with_reservations: 410, total_attendances: 127,
      unique_attended_participants: 98, sessions_total: sessions.length, sessions_upcoming: 0, sessions_in_progress: 0,
      sessions_ended: 0, sessions_cancelled: 0, activities_total: 56, capacity_total: 3000, reserved_total: 1200,
    },
    ...over,
  };
}
const show = (data: OperationsOverview) => {
  vi.mocked(fetchOperationsOverview).mockResolvedValue(data);
  return render(<MemoryRouter><OperationsCenter /></MemoryRouter>);
};
const tab = (name: RegExp | string) => screen.getByRole('tab', { name });
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-status]')];
const rowOf = (title: string) => rows().find((r) => r.textContent?.includes(title))!;

beforeEach(() => {
  vi.clearAllMocks();
  n = 0;
});

test('with 56 workshops and 120 sessions the program is a dense table, not a card per session', async () => {
  const many: OperationsSession[] = [];
  for (let w = 1; w <= 56; w++) {
    many.push(session(BEFORE, { title: `Taller ${String(w).padStart(2, '0')}`, starts_at: at(BEFORE, 60 * 24 * 10 + (w % 8) * 30), ends_at: at(BEFORE, 60 * 24 * 10 + (w % 8) * 30 + 25) }));
    many.push(session(BEFORE, { title: `Taller ${String(w).padStart(2, '0')}`, starts_at: at(BEFORE, 60 * 24 * 10 + 240 + (w % 8) * 30), ends_at: at(BEFORE, 60 * 24 * 10 + 240 + (w % 8) * 30 + 25) }));
  }
  show(overview(BEFORE, many, { event_date: '2026-10-15' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Programa completo' }));
  expect(rows()).toHaveLength(112);
  // one table for everything; no per-session card and no per-session metric boxes
  expect(screen.getAllByTestId('session-table')).toHaveLength(1);
  expect(document.querySelectorAll('[data-status].card')).toHaveLength(0);
  expect(screen.queryByText('Capacidad')).not.toBeInTheDocument();
  expect(screen.queryByText('Disponibles')).not.toBeInTheDocument();
});

test('sessions are grouped chronologically by start time', async () => {
  const sessions = [
    session(BEFORE, { title: 'Tarde', starts_at: at(BEFORE, 60 * 24 * 10 + 180), ends_at: at(BEFORE, 60 * 24 * 10 + 210) }),
    session(BEFORE, { title: 'Temprano A', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
    session(BEFORE, { title: 'Temprano B', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
  ];
  show(overview(BEFORE, sessions));
  const blocks = await screen.findAllByRole('region', { name: /^Bloque / });
  expect(blocks).toHaveLength(2);
  expect(within(blocks[0]).getAllByText(/Temprano/)).toHaveLength(2);
  expect(within(blocks[1]).getByText('Tarde')).toBeInTheDocument();
  expect(within(blocks[0]).getByText('2 sesiones')).toBeInTheDocument();
});

test('a multi-division workshop shows all its divisions and the division filter finds it by any of them', async () => {
  const sessions = [
    session(BEFORE, { title: 'IA Generativa', divisions: [SALUD, ING], starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
    session(BEFORE, { title: 'Soloso', divisions: [SALUD], starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
    session(BEFORE, { title: 'Solo Ingeniería', divisions: [ING], starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
  ];
  show(overview(BEFORE, sessions));
  const row = await screen.findByText('IA Generativa');
  expect(row.closest('[data-status]')).toHaveTextContent('Salud · Ingeniería');
  fireEvent.change(screen.getByLabelText('División'), { target: { value: ING.id } });
  expect(screen.getByText('IA Generativa')).toBeInTheDocument();
  expect(screen.getByText('Solo Ingeniería')).toBeInTheDocument();
  expect(screen.queryByText('Soloso')).not.toBeInTheDocument();
});

test('search finds by workshop name, by location and by division, instantly and without accents', async () => {
  const day = 60 * 24 * 10;
  show(overview(BEFORE, [
    session(BEFORE, { title: 'Cocina Molecular', location: 'Laboratorio Gastronómico', divisions: [SALUD], starts_at: at(BEFORE, day), ends_at: at(BEFORE, day + 30) }),
    session(BEFORE, { title: 'Robots', location: 'HUB', divisions: [ING], starts_at: at(BEFORE, day), ends_at: at(BEFORE, day + 30) }),
  ]));
  const box = await screen.findByRole('searchbox', { name: /Buscar taller, lugar o división/ });
  fireEvent.change(box, { target: { value: 'molecular' } });
  expect(rows()).toHaveLength(1);
  expect(screen.getByText('Cocina Molecular')).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'hub' } });
  expect(screen.getByText('Robots')).toBeInTheDocument();
  expect(screen.queryByText('Cocina Molecular')).not.toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'gastronomico' } });
  expect(screen.getByText('Cocina Molecular')).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'ingenieria' } });
  expect(screen.getByText('Robots')).toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'zzz' } });
  expect(screen.getByText(/Ninguna sesión coincide/)).toBeInTheDocument();
});

test('each temporal state is shown: in progress, upcoming, finished and cancelled', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'En marcha', starts_at: at(EVENT_DAY, -10), ends_at: at(EVENT_DAY, 20) }),
    session(EVENT_DAY, { title: 'Por venir', starts_at: at(EVENT_DAY, 180), ends_at: at(EVENT_DAY, 210) }),
    session(EVENT_DAY, { title: 'Ya pasó', starts_at: at(EVENT_DAY, -240), ends_at: at(EVENT_DAY, -210), attended: 9 }),
    session(EVENT_DAY, { title: 'Cancelado', status: 'cancelada', starts_at: at(EVENT_DAY, 300), ends_at: at(EVENT_DAY, 330) }),
  ]));
  fireEvent.click(await screen.findByRole('tab', { name: 'Programa completo' }));
  expect(rowOf('En marcha').dataset.status).toBe('en_curso');
  expect(rowOf('Por venir').dataset.status).toBe('proxima');
  expect(rowOf('Ya pasó').dataset.status).toBe('terminada');
  expect(rowOf('Cancelado').dataset.status).toBe('cancelada');
  expect(within(rowOf('En marcha')).getByText('En curso')).toBeInTheDocument();
  expect(within(rowOf('Ya pasó')).getByText('Terminada')).toBeInTheDocument();
  expect(within(rowOf('Ya pasó')).getByText('9')).toBeInTheDocument();
});

test('a cancelled session with affected reservations appears in Atención', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'Cancelado', status: 'cancelada', affected_reservations: 20, affected_unresolved: 17, starts_at: at(EVENT_DAY, 120), ends_at: at(EVENT_DAY, 150) }),
    session(EVENT_DAY, { title: 'Normal', starts_at: at(EVENT_DAY, 120), ends_at: at(EVENT_DAY, 150) }),
  ]));
  expect(await screen.findByRole('tab', { name: /Atención/ })).toHaveTextContent('1');
  fireEvent.click(tab(/Atención/));
  const atencion = screen.getByRole('region', { name: 'Atención' });
  expect(within(atencion).getByText('Cancelada · 17 participantes con reservación')).toBeInTheDocument();
  expect(within(atencion).queryByText('Normal')).not.toBeInTheDocument();
});

test('an upcoming session without location is attention when close, a configuration notice when far', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'Sin lugar pronto', location: null, starts_at: at(EVENT_DAY, 20), ends_at: at(EVENT_DAY, 50) }),
    session(EVENT_DAY, { title: 'Sin lugar lejano', location: null, starts_at: at(EVENT_DAY, 60 * 24 * 2), ends_at: at(EVENT_DAY, 60 * 24 * 2 + 30) }),
  ]));
  fireEvent.click(await screen.findByRole('tab', { name: /Atención/ }));
  const atencion = screen.getByRole('region', { name: 'Atención' });
  expect(within(atencion).getByText('Sin ubicación · inicia en 20 min')).toBeInTheDocument();
  expect(within(atencion).queryByText('Sin lugar lejano')).not.toBeInTheDocument();
  fireEvent.click(tab('Próximas'));
  expect(screen.getByText(/1 sesión próxima sin ubicación/)).toBeInTheDocument();
  expect(within(rowOf('Sin lugar lejano')).getByText('Sin ubicación')).toBeInTheDocument();
});

test('a full or nearly full session is shown as demand, never as an incident', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'Taller completo', reserved: 30, remaining: 0, starts_at: at(EVENT_DAY, 120), ends_at: at(EVENT_DAY, 150) }),
    session(EVENT_DAY, { title: 'Taller casi completo', reserved: 28, remaining: 2, starts_at: at(EVENT_DAY, 120), ends_at: at(EVENT_DAY, 150) }),
  ]));
  fireEvent.click(await screen.findByRole('tab', { name: 'Próximas' }));
  expect(within(rowOf('Taller completo')).getByText('Lleno')).toBeInTheDocument();
  expect(within(rowOf('Taller casi completo')).getByText('Quedan 2')).toBeInTheDocument();
  expect(tab(/Atención/)).not.toHaveTextContent(/\d/);
  fireEvent.click(tab(/Atención/));
  expect(screen.getByText('Nada requiere acción ahora')).toBeInTheDocument();
});

test('a finished session with reservations and no check-ins inside the window shows pending check-in', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'Sin escaneos', reserved: 12, attended: 0, starts_at: at(EVENT_DAY, -40), ends_at: at(EVENT_DAY, -10) }),
    session(EVENT_DAY, { title: 'Ya escaneado', reserved: 12, attended: 7, starts_at: at(EVENT_DAY, -40), ends_at: at(EVENT_DAY, -10) }),
  ]));
  fireEvent.click(await screen.findByRole('tab', { name: /Atención/ }));
  const atencion = screen.getByRole('region', { name: 'Atención' });
  expect(within(atencion).getByText('Check-in pendiente · terminó hace 10 min')).toBeInTheDocument();
  expect(within(atencion).queryByText('Ya escaneado')).not.toBeInTheDocument();
});

test('before the event it opens on the upcoming program with preparation indicators, not an empty console', async () => {
  show(overview(BEFORE, [
    session(BEFORE, { title: 'Futuro 1', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
    session(BEFORE, { title: 'Futuro 2', starts_at: at(BEFORE, 60 * 24 * 10 + 60), ends_at: at(BEFORE, 60 * 24 * 10 + 90) }),
  ]));
  expect(await screen.findByRole('tab', { name: 'Próximas' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Futuro 1')).toBeInTheDocument();
  const kpis = screen.getByLabelText('Indicadores');
  for (const label of ['Talleres', 'Sesiones', 'Con reservación', 'Reservaciones vigentes', 'Cupo reservado']) {
    expect(within(kpis).getByText(label)).toBeInTheDocument();
  }
  expect(within(kpis).queryByText('En curso')).not.toBeInTheDocument();
  expect(within(kpis).getByText('40%')).toBeInTheDocument();
  expect(screen.getByText('Preparación')).toBeInTheDocument();
  expect(screen.queryByText(/MODO PRUEBA/i)).not.toBeInTheDocument();
});

test('on the event day it prioritizes Now: in-progress and soon-starting sessions, with live indicators', async () => {
  show(overview(EVENT_DAY, [
    session(EVENT_DAY, { title: 'En marcha', starts_at: at(EVENT_DAY, -10), ends_at: at(EVENT_DAY, 20), attended: 4 }),
    session(EVENT_DAY, { title: 'Empieza pronto', starts_at: at(EVENT_DAY, 15), ends_at: at(EVENT_DAY, 45) }),
    session(EVENT_DAY, { title: 'Más tarde', starts_at: at(EVENT_DAY, 200), ends_at: at(EVENT_DAY, 230) }),
  ], { mode: 'operacion_real' }));
  expect(await screen.findByRole('tab', { name: 'Ahora' })).toHaveAttribute('aria-selected', 'true');
  const ahora = screen.getByRole('region', { name: 'Ahora' });
  expect(within(ahora).getByText('En marcha')).toBeInTheDocument();
  expect(within(ahora).getByText('Empieza pronto')).toBeInTheDocument();
  expect(within(ahora).queryByText('Más tarde')).not.toBeInTheDocument();
  const kpis = screen.getByLabelText('Indicadores');
  for (const label of ['En curso', 'Próximas', 'Requieren atención', 'Asistencias', 'Con asistencia']) {
    expect(within(kpis).getByText(label)).toBeInTheDocument();
  }
  expect(within(kpis).queryByText('Aceptaron aviso')).not.toBeInTheDocument();
  expect(screen.getByText('Operación real')).toBeInTheDocument();
});

test('Now never renders an empty panel: it says so and points at what is next', async () => {
  show(overview(EVENT_DAY, [session(EVENT_DAY, { title: 'Muy luego', starts_at: at(EVENT_DAY, 300), ends_at: at(EVENT_DAY, 330) })]));
  expect(await screen.findByText(/Nada en curso ni por empezar/)).toBeInTheDocument();
  expect(screen.getByText(/Siguiente · /)).toBeInTheDocument();
  expect(screen.getByText('Muy luego')).toBeInTheDocument();
});

test('the Check-in link keeps the session in the query string', async () => {
  show(overview(BEFORE, [session(BEFORE, { title: 'Con enlace', session_id: 'abc-123', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) })]));
  const link = await screen.findByRole('link', { name: 'Abrir check-in de Con enlace' });
  expect(link).toHaveAttribute('href', '/coordinacion/checkin?session=abc-123');
});

test('cancelled and hidden sessions offer no check-in', async () => {
  show(overview(BEFORE, [
    session(BEFORE, { title: 'Cancelada X', status: 'cancelada', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
    session(BEFORE, { title: 'Oculta X', status: 'oculta', starts_at: at(BEFORE, 60 * 24 * 10), ends_at: at(BEFORE, 60 * 24 * 10 + 30) }),
  ]));
  fireEvent.click(await screen.findByRole('tab', { name: 'Programa completo' }));
  expect(screen.queryByRole('link', { name: /Abrir check-in/ })).not.toBeInTheDocument();
});

test('the console renders without the public theme (independent admin)', async () => {
  show(overview(BEFORE, [session(BEFORE)]));
  expect(await screen.findByRole('heading', { name: 'Centro de Operación' })).toBeInTheDocument();
});
