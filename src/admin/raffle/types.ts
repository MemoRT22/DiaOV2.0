import type { RaffleCategory, RafflePrize, RaffleWinner } from '../../lib/raffleApi';
import type { CatalogPlan } from '../../lib/raffleCatalog';
import type { RaffleScope } from '../../lib/raffleShow';

/** The three places of the module: the live draw, the official prizes (Coordinación) and the winners. */
export type RaffleSection = 'vivo' | 'premios' | 'ganadores';

/** What every section of the module needs; loaded once by the module so the sections never disagree. */
export type RaffleContext = {
  /** The edition is in rehearsal mode («Ensayo del evento») rather than official operation («Sorteo oficial»). */
  rehearsal: boolean;
  /** Technical set of server records in use (`is_demo`). Only shown in the collapsed technical details. */
  dataSet: RaffleScope;
  /** The official categories of that set, in catalog order (Universo, Galaxia, Sistema Solar). */
  categories: RaffleCategory[];
  /** Every category of that set, official or not. */
  allCategories: RaffleCategory[];
  /** Official prizes only, by category id, in catalog order. Anything else on the server is reported, never offered. */
  prizes: Record<string, RafflePrize[]>;
  /** The catalog against what the server holds. */
  plan: CatalogPlan<RafflePrize>;
  /** Results of this set; null while loading or if they could not be read. */
  winners: RaffleWinner[] | null;
  canConfigure: boolean;
  prizesLoading: boolean;
  /** Reloads categories, pools, prizes and results after something changed. */
  refresh: () => Promise<void>;
  goTo: (section: RaffleSection) => void;
};
