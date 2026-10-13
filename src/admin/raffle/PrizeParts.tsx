import { CreditCard, Gamepad2, Laptop, Tablet, Watch, type LucideIcon } from 'lucide-react';
import type { RafflePrize, RaffleWinner } from '../../lib/raffleApi';
import { normalizeName, officialItemFor, type PrizeKind } from '../../lib/raffleCatalog';

const ICONS: Record<PrizeKind, LucideIcon> = { laptop: Laptop, tablet: Tablet, watch: Watch, console: Gamepad2, giftcard: CreditCard };

/** One accent per category, from the fixed admin palette. */
export const CATEGORY_TONE: Record<string, string> = {
  [normalizeName('Universo')]: 'universe',
  [normalizeName('Galaxia')]: 'galaxy',
  [normalizeName('Sistema Solar')]: 'solar',
};
export const toneOf = (categoryName: string) => CATEGORY_TONE[normalizeName(categoryName)] ?? 'solar';

export function PrizeIcon({ kind, size = 22 }: { kind: PrizeKind | null; size?: number }) {
  const Icon = kind ? ICONS[kind] : CreditCard;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

export const kindOf = (categoryName: string, prizeName: string): PrizeKind | null => officialItemFor(categoryName, prizeName)?.kind ?? null;

/**
 * What the server says about a prize, in the words of the event. `left` always comes from `raffle_prizes_read`.
 * `confirmed` (delivered) and `waiting` (selected, not yet confirmed) come only from the results: `raffle_prizes_read`
 * counts both together as `delivered`, so when the results could not be read they are UNKNOWN (null), never zero and
 * never guessed. `committed` is the one figure that is known either way.
 */
export function prizeTally(prize: Pick<RafflePrize, 'id' | 'quantity' | 'available' | 'delivered'>, winners: RaffleWinner[] | null) {
  const mine = winners?.filter((winner) => winner.prize_id === prize.id);
  return {
    quantity: prize.quantity,
    confirmed: mine ? mine.filter((winner) => winner.status === 'confirmado').length : null,
    waiting: mine ? mine.filter((winner) => winner.status === 'seleccionado').length : null,
    committed: prize.delivered,
    left: Math.max(0, prize.available),
  };
}
export type Tally = ReturnType<typeof prizeTally>;
/** The results of this prize could be read. */
export const verified = (tally: Tally): tally is Tally & { confirmed: number; waiting: number } => tally.confirmed !== null && tally.waiting !== null;

/** «3 de 10 entregadas» + one dot per unit (up to twelve; filled = delivered, ring = waiting, hatched = committed but not verified). */
export function StockDots({ tally }: { tally: Tally }) {
  if (tally.quantity > 12) return null;
  return (
    <span className="rf-dots-row" aria-hidden>
      {Array.from({ length: tally.quantity }, (_, index) => {
        const state = verified(tally)
          ? index < tally.confirmed ? 'done' : index < tally.confirmed + tally.waiting ? 'waiting' : 'free'
          : index < tally.committed ? 'unknown' : 'free';
        return <i key={index} data-state={state} />;
      })}
    </span>
  );
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const deliveredText = (confirmed: number, quantity: number) => `${confirmed} de ${quantity} ${quantity === 1 ? 'entregado' : 'entregadas'}`;
/** What to say about deliveries: the figure when it is known, otherwise how much is committed and that the detail is unverified. */
export const deliveryText = (tally: Tally) => (verified(tally)
  ? deliveredText(tally.confirmed, tally.quantity)
  : `${plural(tally.committed, 'comprometida', 'comprometidas')} · entregas sin verificar`);
