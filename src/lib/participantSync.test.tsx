import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { announceParticipantChange, subscribeParticipantChanges } from './participantSync';
import { useParticipantSync } from './useParticipantSync';

// Minimal in-memory BroadcastChannel: delivers to every OTHER instance with the same name (like the browser).
const sent: unknown[] = [];
class FakeChannel {
  static all = new Set<FakeChannel>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public name: string) { FakeChannel.all.add(this); }
  postMessage(data: unknown) {
    sent.push(data);
    for (const c of FakeChannel.all) if (c !== this && c.name === this.name) c.onmessage?.({ data });
  }
  close() { FakeChannel.all.delete(this); }
}

/** A message as another tab (a different module instance, hence a different source id) would send it. */
const fromOtherTab = (kind: string, extra: Record<string, unknown> = {}) => {
  const other = new FakeChannel('diaov.participant-state');
  other.postMessage({ v: 1, src: 'another-tab', kind, ...extra });
  other.close();
};

beforeEach(() => {
  sent.length = 0;
  FakeChannel.all.clear();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the signal carries only a version, an opaque source id and a generic category — no personal data', () => {
  announceParticipantChange('reservation');
  expect(sent).toHaveLength(1);
  const message = sent[0] as Record<string, unknown>;
  expect(Object.keys(message).sort()).toEqual(['kind', 'src', 'v']);
  expect(message).toMatchObject({ v: 1, kind: 'reservation' });
});

test('a tab never reacts to its own announcement', () => {
  const cb = vi.fn();
  const unsubscribe = subscribeParticipantChanges(cb);
  announceParticipantChange('attendance');
  expect(cb).not.toHaveBeenCalled();
  unsubscribe();
});

test('an announcement from another tab reaches the subscribers; junk and foreign messages are ignored', () => {
  const cb = vi.fn();
  const unsubscribe = subscribeParticipantChanges(cb);
  fromOtherTab('attendance');
  expect(cb).toHaveBeenCalledWith('attendance');
  fromOtherTab('something-else');
  fromOtherTab('reservation', { v: 2 });
  expect(cb).toHaveBeenCalledTimes(1);
  unsubscribe();
  fromOtherTab('reservation');
  expect(cb).toHaveBeenCalledTimes(1);
});

function Probe({ reload }: { reload: () => void }) {
  useParticipantSync(reload);
  return null;
}

test('F/G: another tab’s announcement reloads the screen once (coalesced) and the reload never announces', () => {
  vi.useFakeTimers();
  const reload = vi.fn();
  render(<Probe reload={reload} />);
  fromOtherTab('reservation');
  fromOtherTab('attendance');
  expect(reload).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(reload).toHaveBeenCalledTimes(1);
  // no ping-pong: nothing was posted by this tab while reloading
  expect(sent.filter((m) => (m as { src: string }).src !== 'another-tab')).toHaveLength(0);
});

test('I: becoming visible after a long time hidden revalidates once; a quick flip does not', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
  const reload = vi.fn();
  render(<Probe reload={reload} />);
  const setVisibility = (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  setVisibility('hidden');
  vi.setSystemTime(new Date('2026-10-15T15:00:03Z'));
  setVisibility('visible');
  act(() => { vi.advanceTimersByTime(500); });
  expect(reload).not.toHaveBeenCalled();

  setVisibility('hidden');
  vi.setSystemTime(new Date('2026-10-15T15:01:00Z'));
  setVisibility('visible');
  act(() => { vi.advanceTimersByTime(500); });
  expect(reload).toHaveBeenCalledTimes(1);

  // no polling: nothing else happens with the passage of time
  act(() => { vi.advanceTimersByTime(10 * 60_000); });
  expect(reload).toHaveBeenCalledTimes(1);
});
