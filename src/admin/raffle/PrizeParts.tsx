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
 * What the server says about a prize, in the words of the event: delivered (confirmed), waiting to be confirmed, still to
 * draw. Stock always comes from `raffle_prizes_read`; the results only refine «delivered» when they could be read.
 */
export function prizeTally(prize: Pick<RafflePrize, 'id' | 'quantity' | 'available' | 'delivered'>, winners: RaffleWinner[] | null) {
  const mine = winners?.filter((winner) => winner.prize_id === prize.id);
  const confirmed = mine ? mine.filter((winner) => winner.status === 'confirmado').length : prize.delivered;
  const waiting = mine ? mine.filter((winner) => winner.status === 'seleccionado').length : 0;
  return { quantity: prize.quantity, confirmed, waiting, left: Math.max(0, prize.available) };
}

/** «3 de 10 entregadas» + one dot per unit (up to twelve; filled = delivered, ring = waiting). */
export function StockDots({ confirmed, waiting, quantity }: { confirmed: number; waiting: number; quantity: number }) {
  if (quantity > 12) return null;
  return (
    <span className="rf-dots-row" aria-hidden>
      {Array.from({ length: quantity }, (_, index) => <i key={index} data-state={index < confirmed ? 'done' : index < confirmed + waiting ? 'waiting' : 'free'} />)}
    </span>
  );
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const deliveredText = (confirmed: number, quantity: number) => `${confirmed} de ${quantity} ${quantity === 1 ? 'entregado' : 'entregadas'}`;
