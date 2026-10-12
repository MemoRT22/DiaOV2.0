import type { RaffleCategory, RafflePrize, RaffleWinner } from '../../lib/raffleApi';

export const category = (id: string, name: string, sort_order: number, rules: object[], pool_count: number, over: Partial<RaffleCategory> = {}): RaffleCategory => ({
  id, name, sort_order, rules, pool_count, is_active: true, is_demo: false, visual_config: {}, required_academic: 0, required_leadership: 0, ...over,
});

export const prize = (id: string, category_id: string, name: string, quantity: number, available: number, over: Partial<RafflePrize> = {}): RafflePrize => ({
  id, category_id, name, description: '', quantity, available, delivered: quantity - available, is_active: true, sort_order: 0, ...over,
});

export const winner = (id: string, status: RaffleWinner['status'], over: Partial<RaffleWinner> = {}): RaffleWinner => ({
  id, prize_id: 'tablet', prize_name: 'Tablet', category_id: 'un', category_name: 'Universo', display_name: 'Ana López', status,
  drawn_at: '2026-10-22T16:30:00Z', confirmed_at: status === 'confirmado' ? '2026-10-22T16:35:00Z' : null, invalidation_reason: null, origin: 'online', ...over,
});

/** The three official categories with realistic pools. */
export const OFFICIAL = [
  category('un', 'Universo', 30, [{ academic: 3, university_life: 1 }, { academic: 2, university_life: 2 }], 4),
  category('ga', 'Galaxia', 20, [{ academic: 2, university_life: 1 }, { total: 4 }], 1),
  category('ss', 'Sistema Solar', 10, [{ academic: 1, university_life: 1 }], 0),
];
