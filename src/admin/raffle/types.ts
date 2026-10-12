import type { RaffleCategory, RafflePrize, UnassignedCombo } from '../../lib/raffleApi';
import type { RaffleScope } from '../../lib/raffleShow';

export type RaffleSection = 'preparacion' | 'ejecutar' | 'historial';

/** What every section of the module needs; loaded once by the module so the sections never disagree. */
export type RaffleContext = {
  scope: RaffleScope;
  /** Categories of the visible environment, highest first. */
  categories: RaffleCategory[];
  prizes: Record<string, RafflePrize[]>;
  /** Participants with stamps that reach no category (Coordinación only, active environment only). */
  unassigned: UnassignedCombo[];
  unassignedVisible: boolean;
  canConfigure: boolean;
  prizesLoading: boolean;
  /** Reloads categories, pools and prizes after something changed. */
  refresh: () => Promise<void>;
  goTo: (section: RaffleSection) => void;
};
