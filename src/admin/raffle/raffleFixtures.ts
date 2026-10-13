import type { RaffleCategory, RafflePrize, RaffleWinner } from '../../lib/raffleApi';

export const category = (id: string, name: string, sort_order: number, rules: object[], pool_count: number, over: Partial<RaffleCategory> = {}): RaffleCategory => ({
  id, name, sort_order, rules, pool_count, is_active: true, is_demo: false, visual_config: {}, required_academic: 0, required_leadership: 0, ...over,
});

export const prize = (id: string, category_id: string, name: string, quantity: number, available: number, over: Partial<RafflePrize> = {}): RafflePrize => ({
  id, category_id, name, description: '', quantity, available, delivered: quantity - available, is_active: true, sort_order: 0, ...over,
});

export const winner = (id: string, status: RaffleWinner['status'], over: Partial<RaffleWinner> = {}): RaffleWinner => ({
  id, prize_id: 'amazon', prize_name: AMAZON, category_id: 'ss', category_name: 'Sistema Solar', display_name: 'Ana López', status,
  drawn_at: '2026-10-22T16:30:00Z', confirmed_at: status === 'confirmado' ? '2026-10-22T16:35:00Z' : null, invalidation_reason: null, origin: 'online', ...over,
});

export const MACBOOK = 'MacBook Neo de 13 pulgadas, 256 GB';
export const IPAD = 'iPad Air de 64 GB';
export const WATCH = 'Apple Watch S3 GPS';
export const SWITCH = 'Nintendo Switch OLED';
export const AMAZON = 'Tarjeta de regalo Amazon de $1,200 MXN';

/** The three official categories with realistic pools (22 eligible participants in total). */
export const OFFICIAL = [
  category('un', 'Universo', 30, [{ academic: 3, university_life: 1 }, { academic: 2, university_life: 2 }], 4),
  category('ga', 'Galaxia', 20, [{ academic: 2, university_life: 1 }, { total: 4 }], 6),
  category('ss', 'Sistema Solar', 10, [{ academic: 1, university_life: 1 }], 12),
];

/** The official catalog as the server holds it once registered: 16 units. */
export const officialPrizes = (): Record<string, RafflePrize[]> => ({
  un: [prize('macbook', 'un', MACBOOK, 1, 1, { sort_order: 1 }), prize('ipad', 'un', IPAD, 2, 2, { sort_order: 2 })],
  ga: [prize('watch', 'ga', WATCH, 1, 1, { sort_order: 1 }), prize('switch', 'ga', SWITCH, 2, 2, { sort_order: 2 })],
  ss: [prize('amazon', 'ss', AMAZON, 10, 10, { sort_order: 1 })],
});

/** The same official set, flagged as test records (`is_demo`), with its own ids. */
export const demoCategories = () => OFFICIAL.map((item) => ({ ...item, id: `d-${item.id}`, is_demo: true }));
export const demoPrizes = (): Record<string, RafflePrize[]> => Object.fromEntries(Object.entries(officialPrizes()).map(([id, list]) => [
  `d-${id}`, list.map((item) => ({ ...item, id: `d-${item.id}`, category_id: `d-${item.category_id}` })),
]));
