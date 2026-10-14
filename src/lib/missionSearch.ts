import type { BoardSession } from './reservations';

/** Lower-case, no accents, single spaces: «Psicología» matches «psicologia», «  ARQUI » matches «arqui». */
export const normalizeText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Local search over what the student already sees on the card (title, concept, area, kind of experience and place).
 * Every word typed must appear somewhere («podcast radio» finds a mission that says both); nothing leaves the phone and
 * nothing about availability or reservations is touched.
 */
export function matchesMission(sessions: BoardSession[], query: string, extra: string[] = []): boolean {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const first = sessions[0];
  const haystack = normalizeText(
    [first.title, first.description, ...sessions.map((s) => s.location), ...extra].filter(Boolean).join(' '),
  );
  return words.every((w) => haystack.includes(w));
}
