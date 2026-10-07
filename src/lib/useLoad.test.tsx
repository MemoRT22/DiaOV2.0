import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useLoad } from './useLoad';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const calls: Array<ReturnType<typeof deferred<string>>> = [];
  const view = renderHook(({ q }) => useLoad(() => { const d = deferred<string>(); calls.push(d); return d.promise; }, [q]), { initialProps: { q: 'a' } });
  return { calls, view };
}

test('an older request that finishes after a newer one does NOT replace its data or loading state', async () => {
  const { calls, view } = setup();
  view.rerender({ q: 'b' }); // request B starts after A
  expect(calls).toHaveLength(2);
  await act(async () => { calls[1].resolve('B'); });
  expect(view.result.current.data).toBe('B');
  expect(view.result.current.loading).toBe(false);
  await act(async () => { calls[0].resolve('A'); }); // stale
  expect(view.result.current.data).toBe('B');
  expect(view.result.current.loading).toBe(false);
});

test('a stale failure does not set an error over the newer result', async () => {
  const { calls, view } = setup();
  view.rerender({ q: 'b' });
  await act(async () => { calls[1].resolve('B'); });
  await act(async () => { calls[0].reject(new Error('viejo')); });
  expect(view.result.current.error).toBeNull();
  expect(view.result.current.data).toBe('B');
});

test('a stale response does not end the loading of the newer request', async () => {
  const { calls, view } = setup();
  view.rerender({ q: 'b' });
  await act(async () => { calls[0].resolve('A'); }); // old one lands first
  expect(view.result.current.loading).toBe(true);
  expect(view.result.current.data).toBeNull();
  await act(async () => { calls[1].resolve('B'); });
  expect(view.result.current.data).toBe('B');
  expect(view.result.current.loading).toBe(false);
});

test('a failed refresh keeps the last valid data', async () => {
  const { calls, view } = setup();
  await act(async () => { calls[0].resolve('A'); });
  let refresh!: Promise<void>;
  act(() => { refresh = view.result.current.reload(); });
  await act(async () => { calls[1].reject(new Error('sin red')); await refresh; });
  expect(view.result.current.data).toBe('A');
  expect(view.result.current.error).toBeInstanceOf(Error);
  expect(view.result.current.loading).toBe(false);
});

test('reload never throws and the latest of several reloads wins', async () => {
  const { calls, view } = setup();
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => { first = view.result.current.reload(); second = view.result.current.reload(); });
  await act(async () => { calls[2].resolve('último'); calls[1].resolve('anterior'); calls[0].resolve('inicial'); await Promise.all([first, second]); });
  expect(view.result.current.data).toBe('último');
});
