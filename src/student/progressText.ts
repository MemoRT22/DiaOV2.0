import { fillTemplate } from '../theme/themeEngine';
import type { ThemeConfig } from '../theme/types';

type Next = { level: number; required_attendances: number; required_divisions: number };

/**
 * Message about the next level. Levels depend on accumulated stamps; while the next level requires no distinct
 * divisions the message is built here from stamps and the rank name only, so a (possibly historical) theme text can
 * never reintroduce a requirement that no longer exists. If a future edition requires divisions again, the
 * configurable `progressNext` text of the theme is used.
 */
export function progressNextMessage(
  theme: ThemeConfig,
  next: Next,
  remainingStamps: number,
  term: (key: 'stamp' | 'division', plural?: boolean) => string,
  rankName: (level: number) => string,
) {
  const stamps = term('stamp', remainingStamps !== 1).toLowerCase();
  if (next.required_divisions === 0) {
    const verb = remainingStamps === 1 ? 'Te falta' : 'Te faltan';
    return `${verb} ${remainingStamps} ${stamps} para llegar a ${rankName(next.level)}.`;
  }
  return fillTemplate(theme.texts.progressNext, {
    guide: theme.meta.guideName,
    event: theme.meta.eventName,
    activities: remainingStamps,
    activityTerm: stamps,
    divisions: next.required_divisions,
    divisionTerm: term('division', next.required_divisions !== 1).toLowerCase(),
    rank: rankName(next.level),
  });
}

export const RANK_COUNT = 5;

type Ladder = { level: number; next: Next | null };

/**
 * The published progression is «one stamp, one rank»: level 1 at 0 stamps, level 2 at 1 … level 5 at 4. The server is
 * the authority (`rank_rules`); the screen only needs to know whether what it received still has that shape before it
 * prints per-rank requirements. If a future edition changes the rules (more stamps per rank, or divisions required),
 * this is false and the hints are simply not shown, instead of stating something that is no longer true.
 */
export function isStampLadder(progress: Ladder): boolean {
  if (!progress.next) return progress.level >= RANK_COUNT;
  return progress.next.required_divisions === 0 && progress.next.required_attendances === progress.next.level - 1;
}

/** Stamps that unlock a rank in the one-stamp-per-rank progression: rank 1 → 0, rank 5 → 4. */
export const stampsForRank = (rank: number) => Math.max(rank - 1, 0);

/** Stamps needed for the last rank (4). */
export const MAX_RANK_STAMPS = stampsForRank(RANK_COUNT);
