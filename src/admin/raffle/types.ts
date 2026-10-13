import type { RaffleCategory, RafflePrize, RaffleWinner } from '../../lib/raffleApi';
import type { CatalogPlan } from '../../lib/raffleCatalog';
import type { RaffleScope } from '../../lib/raffleShow';

/** The three places of the module: the live draw, the official prizes (Coordinación) and the winners. */
export type RaffleSection = 'vivo' | 'premios' | 'ganadores';

/** What every section of the module needs; loaded once by the module so the sections never disagree. */
export type RaffleContext = {
  /** The edition is in rehearsal mode («Ensayo del evento») rather than official operation («Sorteo oficial»). */
  rehearsal: boolean;
  /** Technical set of server records in use (`is_demo`). In rehearsal Coordinación chose it; in official operation it is always the real one. */
  dataSet: RaffleScope;
  /** The official categories of that set, in catalog order (Universo, Galaxia, Sistema Solar). */
  categories: RaffleCategory[];
  /** Every category of that set, official or not. */
  allCategories: RaffleCategory[];
  /** Official prizes only, by category id, in catalog order. Empty until the first complete read. */
  prizes: Record<string, RafflePrize[]>;
  /** The catalog against what the server holds. Only meaningful when `loaded`. */
  plan: CatalogPlan<RafflePrize>;
  /** Results of this set; null when they could not be read (deliveries are then unverified, not zero). */
  winners: RaffleWinner[] | null;
  /** A complete read of the prizes of this set exists. Without it «no prizes» cannot be told from «could not read». */
  loaded: boolean;
  /** The last refresh failed: what is shown is the last complete read and may be out of date. */
  stale: boolean;
  canConfigure: boolean;
  prizesLoading: boolean;
  /** Reloads categories, pools, prizes and results after something changed (or to retry a failed read). */
  refresh: () => Promise<void>;
  goTo: (section: RaffleSection) => void;
  /** The console reports whether a round is in progress, so the records of the rehearsal cannot be changed under it. */
  setRoundActive: (active: boolean) => void;
};
