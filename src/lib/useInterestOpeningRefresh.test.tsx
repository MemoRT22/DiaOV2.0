import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useInterestOpeningRefresh } from './useInterestOpeningRefresh';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T17:29:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('hace una sola reconsulta al llegar la apertura general', async () => {
  const reload = vi.fn();
  const { rerender } = renderHook(({ available }) => useInterestOpeningRefresh(reload, {
    opensAt: '2026-10-15T12:30:00-05:00', available,
  }), { initialProps: { available: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(reload).toHaveBeenCalledTimes(1);
  rerender({ available: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
  expect(reload).toHaveBeenCalledTimes(1);
});

test('no programa consultas cuando ya está disponible o no hay hora configurada', async () => {
  const reload = vi.fn();
  const { rerender } = renderHook(({ available, opensAt }) => useInterestOpeningRefresh(reload, { available, opensAt }), {
    initialProps: { available: true, opensAt: '2026-10-15T12:30:00-05:00' as string | null },
  });
  rerender({ available: false, opensAt: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(reload).not.toHaveBeenCalled();
});

test('si el reloj del navegador va adelantado, espera antes de volver a confirmar con el servidor', async () => {
  vi.setSystemTime(new Date('2026-10-15T17:31:00Z'));
  const reload = vi.fn();
  renderHook(() => useInterestOpeningRefresh(reload, {
    opensAt: '2026-10-15T12:30:00-05:00', available: false,
  }));
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(reload).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(reload).toHaveBeenCalledTimes(1);
});

test('si el servidor sigue cerrado o falla, reintenta con espera creciente en vez de polling frecuente', async () => {
  vi.setSystemTime(new Date('2026-10-15T17:31:00Z'));
  const reload = vi.fn();
  renderHook(() => useInterestOpeningRefresh(reload, {
    opensAt: '2026-10-15T12:30:00-05:00', available: false,
  }));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(reload).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(reload).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
  expect(reload).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(reload).toHaveBeenCalledTimes(3);
});
