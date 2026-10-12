/**
 * What the audience may see, and how the operator's console hands it to the public screen.
 *
 * The public screen is a second window of the same app. It never talks to the server and has no controls: the console
 * posts a `PublicState` on a same-origin BroadcastChannel and the window only draws it. Nothing here is a draw engine;
 * the winner always comes from `draw_winner` on the server. Errors, notices and operator controls have no field in
 * `PublicState`, so they cannot reach the audience by construction.
 */
export const PUBLIC_CHANNEL = 'dia-ov-sorteo-publico';
export const PUBLIC_WINDOW = 'dia-ov-sorteo-publico';
export const PUBLIC_PATH = '/coordinacion/sorteo-publico';

/** `standby`: nothing to announce yet (or something the audience must not see is going on); `ready`: prize and pool shown. */
export type PublicPhase = 'standby' | 'ready' | 'drawing' | 'revealed' | 'confirmed';

export type PublicState = {
  /** The edition is in rehearsal: the screen carries the «Ensayo» mark so nobody mistakes it for the official draw. */
  rehearsal: boolean;
  phase: PublicPhase;
  categoryName: string | null;
  prize: { name: string; available: number; quantity: number } | null;
  poolCount: number;
  result: {
    winnerId: string; name: string; prizeName: string;
    /** Pool size reported by the server for this very draw; null when unknown (a recovered selection). */
    poolSize: number | null;
    /** Drawn a moment ago: animate the reveal. False for a recovered selection or once the reveal has played. */
    fresh: boolean;
  } | null;
};

export type PublicMessage =
  | { type: 'state'; state: PublicState | null }
  | { type: 'hello' }
  | { type: 'ping' }
  | { type: 'bye' };

const PHASES: PublicPhase[] = ['standby', 'ready', 'drawing', 'revealed', 'confirmed'];
const isText = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Messages come from another window: accept only what has exactly the shape the screen can draw. */
export function parsePublicMessage(value: unknown): PublicMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'hello' || message.type === 'ping' || message.type === 'bye') return { type: message.type };
  if (message.type !== 'state') return null;
  if (message.state === null) return { type: 'state', state: null };
  const s = message.state as Record<string, unknown> | undefined;
  if (!s || typeof s.rehearsal !== 'boolean' || !PHASES.includes(s.phase as PublicPhase) || !isCount(s.poolCount)) return null;
  const prize = s.prize as Record<string, unknown> | null;
  if (prize !== null && !(prize && isText(prize.name) && isCount(prize.available) && isCount(prize.quantity))) return null;
  const result = s.result as Record<string, unknown> | null;
  if (result !== null && !(result && isText(result.winnerId) && isText(result.name) && isText(result.prizeName)
    && (result.poolSize === null || isCount(result.poolSize)) && typeof result.fresh === 'boolean')) return null;
  if ((s.categoryName !== null && !isText(s.categoryName))) return null;
  return { type: 'state', state: {
    rehearsal: s.rehearsal as boolean, phase: s.phase as PublicPhase, categoryName: s.categoryName as string | null,
    prize: prize as PublicState['prize'], poolCount: s.poolCount as number, result: result as PublicState['result'],
  } };
}

export type ConsolePhase = 'idle' | 'drawing' | 'revealed' | 'confirmed' | 'uncertain';

/**
 * The console's situation, reduced to what the audience may see. While the outcome of a draw is unconfirmed the public
 * screen simply keeps drawing; it is never shown a problem. If the round cannot be drawn it shows the standby title.
 */
export function toPublicState(input: {
  rehearsal: boolean; phase: ConsolePhase; ready: boolean; categoryName?: string;
  prize?: { name: string; available: number; quantity: number }; poolCount: number;
  result: { winnerId: string; name: string; prizeName: string; poolSize: number | null; fresh: boolean } | null;
}): PublicState {
  const phase: PublicPhase = input.phase === 'uncertain' ? 'drawing' : input.phase === 'idle' ? (input.ready ? 'ready' : 'standby') : input.phase;
  const showsResult = phase === 'revealed' || phase === 'confirmed';
  return {
    rehearsal: input.rehearsal, phase, categoryName: input.categoryName ?? null,
    prize: input.prize ? { name: input.prize.name, available: input.prize.available, quantity: input.prize.quantity } : null,
    poolCount: input.poolCount,
    result: showsResult && input.result ? { ...input.result } : null,
  };
}

export type PublicChannel = { post: (message: PublicMessage) => void; close: () => void };

/** Same-origin channel; null where the browser has none (the console then offers only the on-screen rehearsal). */
export function openPublicChannel(onMessage: (message: PublicMessage) => void): PublicChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(PUBLIC_CHANNEL);
  channel.onmessage = (event) => { const parsed = parsePublicMessage(event.data); if (parsed) onMessage(parsed); };
  return { post: (message) => channel.postMessage(message), close: () => channel.close() };
}
