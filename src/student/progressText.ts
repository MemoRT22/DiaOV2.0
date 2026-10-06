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
