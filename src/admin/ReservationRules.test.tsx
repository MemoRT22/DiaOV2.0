import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { updateReservationSettings } from '../lib/reservations';
import ReservationRules from './ReservationRules';

const { reloadEdition, edition } = vi.hoisted(() => ({
  reloadEdition: vi.fn().mockResolvedValue(undefined),
  edition: { reservations_open_at: '2026-10-08T15:00:00Z', reservations_close_at: null, max_reservations: 4, travel_buffer_minutes: 10,
    checkin_open_before_minutes: 5, checkin_close_after_minutes: 20 },
}));
vi.mock('../edition/EditionProvider', () => ({ useEdition: () => ({ edition, reloadEdition }) }));
vi.mock('../lib/reservations', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/reservations')>(), updateReservationSettings: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => vi.clearAllMocks());

test('Coordinación only controls opening and closing', () => {
  render(<ReservationRules />);
  expect(screen.getByLabelText(/^Apertura/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Cierre/)).toBeInTheDocument();
  expect(screen.queryAllByRole('textbox').length + screen.queryAllByRole('spinbutton').length).toBe(0);
  for (const removed of [/Máximo de talleres/, /Traslado/, /Abrir antes del final/, /Cerrar después del final/]) {
    expect(screen.queryByLabelText(removed)).not.toBeInTheDocument();
  }
});

test('saving sends exactly the opening and closing instants (Cancún time)', async () => {
  render(<ReservationRules />);
  fireEvent.change(screen.getByLabelText(/^Apertura/), { target: { value: '2026-10-09T08:00' } });
  fireEvent.change(screen.getByLabelText(/^Cierre/), { target: { value: '2026-10-14T18:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(updateReservationSettings).toHaveBeenCalledTimes(1));
  expect(updateReservationSettings).toHaveBeenCalledWith({
    reservations_open_at: '2026-10-09T08:00:00-05:00', reservations_close_at: '2026-10-14T18:30:00-05:00',
  });
  expect(reloadEdition).toHaveBeenCalled();
  expect(await screen.findByText('Apertura y cierre guardados.')).toBeInTheDocument();
});

test('a closing before the opening is rejected before reaching the server', async () => {
  render(<ReservationRules />);
  fireEvent.change(screen.getByLabelText(/^Cierre/), { target: { value: '2026-10-01T08:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  expect(await screen.findByText('El cierre debe ser posterior a la apertura.')).toBeInTheDocument();
  expect(updateReservationSettings).not.toHaveBeenCalled();
});

test('the rules the system enforces are shown as information, not as controls', () => {
  render(<ReservationRules />);
  const rules = screen.getByRole('region', { name: 'Reglas del sistema' });
  expect(within(rules).getByText(/Hasta 4 talleres activos/)).toBeInTheDocument();
  expect(within(rules).getByText(/Se recomienda un traslado de 10 minutos/)).toBeInTheDocument();
  expect(within(rules).getByText(/no depende de la hora programada/)).toBeInTheDocument();
  expect(within(rules).getByText(/Una sesión en curso sigue aceptando reservaciones/)).toBeInTheDocument();
  expect(within(rules).queryAllByRole('spinbutton')).toHaveLength(0);
});
