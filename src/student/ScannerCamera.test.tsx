import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { CheckInResult } from '../lib/checkin';
import { neutralTheme } from '../theme/neutralTheme';
import Scanner from './Scanner';

type FakeScanner = { onDecode: (r: { data: string }) => void; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
const q = vi.hoisted(() => ({ instances: [] as unknown[], startImpl: null as null | (() => Promise<void>), checkIn: vi.fn(), announce: vi.fn() }));
const scanners = () => q.instances as FakeScanner[];

vi.mock('qr-scanner', () => ({
  default: class {
    onDecode: (r: { data: string }) => void;
    start = vi.fn(async () => q.startImpl?.());
    stop = vi.fn();
    destroy = vi.fn();
    constructor(_video: HTMLVideoElement, onDecode: (r: { data: string }) => void) {
      this.onDecode = onDecode;
      q.instances.push(this);
    }
  },
}));
vi.mock('../lib/checkin', () => ({ checkIn: q.checkIn }));
vi.mock('../lib/participantSync', () => ({ announceParticipantChange: q.announce }));
vi.mock('../lib/catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/catalog')>()),
  fetchProgress: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/reservations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/reservations')>()),
  fetchBoard: vi.fn().mockResolvedValue(null),
}));
vi.mock('../theme/PublicThemeProvider', () => ({
  usePublicTheme: () => ({
    theme: neutralTheme,
    term: (key: 'stamp' | 'rank', plural = false) => (neutralTheme.vocabulary[key] as { one: string; many: string })[plural ? 'many' : 'one'],
    text: () => '',
    rankName: (level: number) => `Rango ${level}`,
  }),
}));

const result = (over: Partial<CheckInResult> = {}): CheckInResult => ({
  already_registered: false, session_id: 's', activity_id: 'a', title: 'Taller E2E', starts_at: '2026-10-15T15:00:00Z', ends_at: '2026-10-15T15:30:00Z',
  credits_granted: 1, method: 'qr', stamps: 1, attended_workshops: 1, level: 1, ...over,
});

const mount = () => render(<MemoryRouter><Scanner /></MemoryRouter>);
const video = (container: HTMLElement) => container.querySelector('video');

beforeEach(() => {
  vi.clearAllMocks();
  q.instances.length = 0;
  q.startImpl = null;
  q.checkIn.mockResolvedValue(result());
});

test('the camera starts by itself when the scanner opens', async () => {
  const { container } = mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));
  expect(video(container)).not.toBeNull();
  expect(scanners()[0].start).toHaveBeenCalledTimes(1);
});

test('«Escanear otro» really restarts the camera: a NEW scanner is created and started on the re-rendered <video>', async () => {
  const { container } = mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));

  // 1) first QR is decoded → check-in succeeds → the success screen replaces the camera (no <video>)
  scanners()[0].onDecode({ data: 'QR-1' });
  expect(await screen.findByRole('heading', { name: 'Misión completada' })).toBeInTheDocument();
  expect(q.checkIn).toHaveBeenLastCalledWith('QR-1');
  expect(video(container)).toBeNull();
  expect(scanners()[0].stop).toHaveBeenCalled();

  // 2) «Escanear otro»
  fireEvent.click(screen.getByRole('button', { name: /Escanear otro/ }));
  await waitFor(() => expect(video(container)).not.toBeNull());
  await waitFor(() => expect(scanners()).toHaveLength(2));
  expect(scanners()[1].start).toHaveBeenCalledTimes(1); // the new scanner is actually running…
  expect(scanners()[0].destroy).toHaveBeenCalled(); // …and the old one was destroyed, never two alive
  expect(scanners()).toHaveLength(2);

  // 3) the new scanner processes another QR normally
  q.checkIn.mockResolvedValueOnce(result({ title: 'Segundo taller', stamps: 2, attended_workshops: 2 }));
  scanners()[1].onDecode({ data: 'QR-2' });
  expect(await screen.findByText('Segundo taller')).toBeInTheDocument();
  expect(q.checkIn).toHaveBeenLastCalledWith('QR-2');
  expect(q.checkIn).toHaveBeenCalledTimes(2);
});

test('after «Escanear otro» the manual code still works', async () => {
  mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));
  scanners()[0].onDecode({ data: 'QR-1' });
  await screen.findByRole('heading', { name: 'Misión completada' });
  fireEvent.click(screen.getByRole('button', { name: /Escanear otro/ }));
  await waitFor(() => expect(scanners()).toHaveLength(2));

  q.checkIn.mockResolvedValueOnce(result({ already_registered: true }));
  fireEvent.change(screen.getByPlaceholderText('ABCDEF'), { target: { value: 'ABCDEF' } });
  fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
  expect(await screen.findByRole('heading', { name: 'Asistencia ya registrada' })).toBeInTheDocument();
  expect(q.checkIn).toHaveBeenLastCalledWith('ABCDEF');
});

test('a repeated check-in also restarts the camera with «Escanear otro»', async () => {
  q.checkIn.mockResolvedValue(result({ already_registered: true }));
  const { container } = mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));
  scanners()[0].onDecode({ data: 'QR-1' });
  await screen.findByRole('heading', { name: 'Asistencia ya registrada' });
  expect(screen.queryByText('+1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Escanear otro/ }));
  await waitFor(() => expect(scanners()).toHaveLength(2));
  expect(video(container)).not.toBeNull();
  expect(scanners()[1].start).toHaveBeenCalledTimes(1);
});

test('when the camera cannot start the student is told and the manual code is available', async () => {
  q.startImpl = () => Promise.reject(new Error('NotAllowedError'));
  mount();
  expect(await screen.findByText(/No pudimos abrir la cámara/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('ABCDEF')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Abrir cámara' })).toBeInTheDocument();
});

test('leaving the screen destroys the scanner (no camera left on)', async () => {
  const { unmount } = mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));
  unmount();
  expect(scanners()[0].destroy).toHaveBeenCalled();
});

test('a failed check-in keeps the screen usable: error shown, camera can be reopened', async () => {
  q.checkIn.mockRejectedValue(new Error('NO_RESERVATION'));
  mount();
  await waitFor(() => expect(scanners()).toHaveLength(1));
  scanners()[0].onDecode({ data: 'QR-X' });
  expect(await screen.findByText(/No tienes reservación/)).toBeInTheDocument();
  expect(q.announce).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Abrir cámara' })).toBeInTheDocument();
});
