import { describe, expect, test, vi } from 'vitest';
import { AccessError } from './accessErrors';
import { backoffMs, retryTransient, RetryAborted, sleep } from './retry';

const slept: number[] = [];
const fakeSleep = async (ms: number) => { slept.push(ms); };
const middle = () => 0.5;
const options = { random: middle, sleep: fakeSleep };

describe('retryTransient', () => {
  test('un fallo temporal se reintenta y, si luego sale bien, la persona ni se entera', async () => {
    slept.length = 0;
    const run = vi.fn().mockRejectedValueOnce(new AccessError('RATE_LIMITED')).mockResolvedValue('ok');
    await expect(retryTransient(run, options)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });
  test('los reintentos están acotados: nunca infinitos', async () => {
    const run = vi.fn().mockRejectedValue(new AccessError('TEMPORARILY_UNAVAILABLE'));
    await expect(retryTransient(run, { ...options, retries: 2 })).rejects.toThrow('TEMPORARILY_UNAVAILABLE');
    expect(run).toHaveBeenCalledTimes(3);
    const none = vi.fn().mockRejectedValue(new AccessError('NETWORK'));
    await expect(retryTransient(none, { ...options, retries: 0 })).rejects.toThrow('NETWORK');
    expect(none).toHaveBeenCalledTimes(1);
  });
  test('un error definitivo (contraseña, validación) no se reintenta jamás', async () => {
    for (const message of ['INVALID_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_EXISTS', 'SERVER_ERROR']) {
      const run = vi.fn().mockRejectedValue(new Error(message));
      await expect(retryTransient(run, options)).rejects.toThrow(message);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
  test('las esperas crecen y llevan variación aleatoria', async () => {
    slept.length = 0;
    const run = vi.fn().mockRejectedValue(new AccessError('NETWORK'));
    await expect(retryTransient(run, { ...options, retries: 3, baseMs: 1000, maxAutoWaitMs: 60_000 })).rejects.toThrow();
    expect(slept).toEqual([1000, 2000, 4000]); // con azar = 0.5 el factor es 1
    expect(backoffMs(1, undefined, 1000, () => 0)).toBeLessThan(backoffMs(1, undefined, 1000, () => 1));
    const spread = new Set(Array.from({ length: 30 }, () => backoffMs(1, undefined, 1000, Math.random)));
    expect(spread.size).toBeGreaterThan(5);
  });
  test('respeta Retry-After: nunca espera menos de lo que pidió el servidor', async () => {
    slept.length = 0;
    const run = vi.fn().mockRejectedValueOnce(new AccessError('RATE_LIMITED', 9)).mockResolvedValue('ok');
    await retryTransient(run, { ...options, baseMs: 500, maxAutoWaitMs: 60_000 });
    expect(slept[0]).toBeGreaterThanOrEqual(9000);
  });
  test('si el servidor pide esperar mucho, no se espera en segundo plano: se avisa a la persona', async () => {
    slept.length = 0;
    const run = vi.fn().mockRejectedValue(new AccessError('RATE_LIMITED', 60));
    await expect(retryTransient(run, { ...options, maxAutoWaitMs: 20_000 })).rejects.toThrow('RATE_LIMITED');
    expect(run).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });
  test('si la persona abandona la pantalla no queda nada corriendo en segundo plano', async () => {
    const controller = new AbortController();
    const run = vi.fn().mockRejectedValue(new AccessError('RATE_LIMITED'));
    const promise = retryTransient(run, { random: middle, baseMs: 50, signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(RetryAborted);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(run).toHaveBeenCalledTimes(1);
    const already = vi.fn();
    await expect(retryTransient(already, { signal: controller.signal })).rejects.toBeInstanceOf(RetryAborted);
    expect(already).not.toHaveBeenCalled();
  });
  test('sleep se cancela con la señal', async () => {
    const controller = new AbortController();
    const waiting = sleep(10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(RetryAborted);
  });
});
