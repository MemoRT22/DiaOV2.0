import { fillTemplate } from '../theme/themeEngine';
import type { ThemeConfig } from '../theme/types';

type Next = { level: number; required_attendances: number; required_divisions: number };

const DIVISIONS_CLAUSE = /\s+y\s+\{divisions\}\s+\{divisionTerm\}/g;

/**
 * "Te faltan N sellos para llegar a Nivel X." Levels depend on accumulated stamps only; when the next level does not
 * require distinct divisions, a published theme that still mentions them in its text never asks for divisions.
 */
export function progressNextMessage(
  theme: ThemeConfig,
  next: Next,
  remainingStamps: number,
  term: (key: 'stamp' | 'division', plural?: boolean) => string,
  rankName: (level: number) => string,
) {
  const template = next.required_divisions > 0 ? theme.texts.progressNext : theme.texts.progressNext.replace(DIVISIONS_CLAUSE, '');
  return fillTemplate(template, {
    guide: theme.meta.guideName,
    event: theme.meta.eventName,
    activities: remainingStamps,
    activityTerm: term('stamp', remainingStamps !== 1).toLowerCase(),
    divisions: next.required_divisions,
    divisionTerm: term('division', next.required_divisions !== 1).toLowerCase(),
    rank: rankName(next.level),
  });
}
