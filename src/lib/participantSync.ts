/**
 * Lightweight "the participant's state changed" signal between tabs of the SAME browser profile.
 *
 * It carries no personal data: only a protocol version, a random per-tab source id (so a tab never reacts to its own
 * announcements) and a generic category. Receivers re-query the server; nothing here is a source of truth.
 * Uses BroadcastChannel and falls back to the `storage` event (which also only fires in other tabs).
 * Reloading never announces: only a successful student action does, so there is no feedback loop.
 */
export type ParticipantChange = 'reservation' | 'attendance';

type Message = { v: 1; src: string; kind: ParticipantChange };

const CHANNEL = 'diaov.participant-state';
const STORAGE_KEY = 'diaov.participant-state.signal';
const SOURCE = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

let sender: BroadcastChannel | null = null;

const hasBroadcastChannel = () => typeof BroadcastChannel === 'function';

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.v === 1 && typeof m.src === 'string' && (m.kind === 'reservation' || m.kind === 'attendance');
}

/** Tell the other tabs that a successful action changed the participant's reservations or attendance. */
export function announceParticipantChange(kind: ParticipantChange) {
  const message: Message = { v: 1, src: SOURCE, kind };
  try {
    if (hasBroadcastChannel()) {
      sender ??= new BroadcastChannel(CHANNEL);
      sender.postMessage(message);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...message, t: Date.now() }));
    }
  } catch {
    // Best effort: the other tabs still revalidate when they become visible again.
  }
}

/** Listen for announcements made by OTHER tabs. Returns the unsubscribe function. */
export function subscribeParticipantChanges(onChange: (kind: ParticipantChange) => void): () => void {
  const handle = (data: unknown) => {
    if (isMessage(data) && data.src !== SOURCE) onChange(data.kind);
  };
  if (hasBroadcastChannel()) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => handle(event.data);
    return () => channel.close();
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handle(JSON.parse(event.newValue));
    } catch {
      // ignore malformed values
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
