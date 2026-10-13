import type { RaffleCategory, RafflePrize } from './raffleApi';

/**
 * The official prizes of Día OV 2026. The definition is fixed here; stock and deliveries are never kept here: they are
 * the server's (`raffle_prizes_read`). Registering the catalog only ever calls the existing `save_raffle_prize`.
 * The specifications are literal: do not replace a model with another without approval.
 */
export type PrizeKind = 'laptop' | 'tablet' | 'watch' | 'console' | 'giftcard';
export type CatalogItem = { key: string; name: string; quantity: number; kind: PrizeKind };
export type CatalogCategory = { name: string; items: CatalogItem[] };

export const OFFICIAL_CATALOG: CatalogCategory[] = [
  { name: 'Universo', items: [
    { key: 'macbook-neo', name: 'MacBook Neo de 13 pulgadas, 256 GB', quantity: 1, kind: 'laptop' },
    { key: 'ipad-air', name: 'iPad Air de 64 GB', quantity: 2, kind: 'tablet' },
  ] },
  { name: 'Galaxia', items: [
    { key: 'apple-watch-s3', name: 'Apple Watch S3 GPS', quantity: 1, kind: 'watch' },
    { key: 'switch-oled', name: 'Nintendo Switch OLED', quantity: 2, kind: 'console' },
  ] },
  { name: 'Sistema Solar', items: [
    { key: 'amazon-1200', name: 'Tarjeta de regalo Amazon de $1,200 MXN', quantity: 10, kind: 'giftcard' },
  ] },
];

export const OFFICIAL_UNITS = OFFICIAL_CATALOG.reduce((sum, category) => sum + category.items.reduce((n, item) => n + item.quantity, 0), 0);
export const OFFICIAL_KINDS = OFFICIAL_CATALOG.flatMap((category) => category.items).length;

/** Accent, case and spacing never decide whether two names are the same prize. */
export const normalizeName = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const officialCategory = (name: string) => OFFICIAL_CATALOG.find((category) => normalizeName(category.name) === normalizeName(name));
export const officialItemFor = (categoryName: string, prizeName: string) =>
  officialCategory(categoryName)?.items.find((item) => normalizeName(item.name) === normalizeName(prizeName));

type CategoryRef = Pick<RaffleCategory, 'id' | 'name'>;
export type PrizeRef = Pick<RafflePrize, 'id' | 'category_id' | 'name' | 'quantity' | 'is_active' | 'delivered'>;

export type EntryState =
  /** Registered exactly as the catalog says. */
  | 'ok'
  /** Not on the server yet. */
  | 'missing'
  /** Registered, but with another quantity or inactive: it can be put right. */
  | 'adjust'
  /** Registered with more committed units than the official quantity: left alone. */
  | 'conflict'
  /** Its category does not exist in this set of data. */
  | 'blocked';

export type PlanEntry<P extends PrizeRef = PrizeRef> = {
  categoryName: string;
  categoryId: string | null;
  item: CatalogItem;
  order: number;
  state: EntryState;
  prize: P | null;
  /** What differs from the catalog when `state` is `adjust` or `conflict`. */
  differences: ('quantity' | 'inactive')[];
};

export type CatalogPlan<P extends PrizeRef = PrizeRef> = {
  entries: PlanEntry<P>[];
  /** Server prizes of an official category that are not in the catalog (or repeat one that is): reported, never touched. */
  extras: { prize: P; categoryName: string; reason: 'unofficial' | 'duplicate' }[];
  missingCategories: string[];
  /** `pending`: none registered · `partial`: some · `ready`: all · `blocked`: a category is missing. */
  status: 'ready' | 'partial' | 'pending' | 'blocked';
  toCreate: number;
  toAdjust: number;
  conflicts: number;
};

/** Compares the catalog with what the server holds, for ONE set of data (the categories given). Pure. */
export function planCatalog<P extends PrizeRef = PrizeRef>(categories: CategoryRef[], prizesByCategory: Record<string, P[]>): CatalogPlan<P> {
  const entries: PlanEntry<P>[] = [];
  const extras: CatalogPlan<P>['extras'] = [];
  const missingCategories: string[] = [];

  for (const official of OFFICIAL_CATALOG) {
    const category = categories.find((candidate) => normalizeName(candidate.name) === normalizeName(official.name)) ?? null;
    if (!category) missingCategories.push(official.name);
    const existing = category ? prizesByCategory[category.id] ?? [] : [];
    const claimed = new Set<string>();

    official.items.forEach((item, index) => {
      const match = existing.find((prize) => !claimed.has(prize.id) && normalizeName(prize.name) === normalizeName(item.name)) ?? null;
      if (match) claimed.add(match.id);
      if (!category) { entries.push({ categoryName: official.name, categoryId: null, item, order: index + 1, state: 'blocked', prize: null, differences: [] }); return; }
      if (!match) { entries.push({ categoryName: official.name, categoryId: category.id, item, order: index + 1, state: 'missing', prize: null, differences: [] }); return; }
      const differences: PlanEntry<P>['differences'] = [];
      if (match.quantity !== item.quantity) differences.push('quantity');
      if (!match.is_active) differences.push('inactive');
      const state: EntryState = differences.length === 0 ? 'ok' : differences.includes('quantity') && match.delivered > item.quantity ? 'conflict' : 'adjust';
      entries.push({ categoryName: official.name, categoryId: category.id, item, order: index + 1, state, prize: match, differences });
    });

    for (const prize of existing) {
      if (claimed.has(prize.id)) continue;
      extras.push({ prize, categoryName: official.name, reason: officialItemFor(official.name, prize.name) ? 'duplicate' : 'unofficial' });
    }
  }

  const registered = entries.filter((entry) => entry.prize).length;
  const status: CatalogPlan<P>['status'] = missingCategories.length > 0 ? 'blocked'
    : entries.every((entry) => entry.state === 'ok') ? 'ready'
    : registered === 0 ? 'pending' : 'partial';
  return {
    entries, extras, missingCategories, status,
    toCreate: entries.filter((entry) => entry.state === 'missing').length,
    toAdjust: entries.filter((entry) => entry.state === 'adjust').length,
    conflicts: entries.filter((entry) => entry.state === 'conflict').length,
  };
}

export type CatalogDeps<P extends PrizeRef = PrizeRef> = {
  fetchPrizes: (categoryId: string) => Promise<P[]>;
  savePrize: (params: { id?: string; category_id: string; name: string; description?: string; quantity: number; is_active: boolean; sort_order: number }) => Promise<unknown>;
};

export type PrepareResult<P extends PrizeRef = PrizeRef> = {
  created: number;
  adjusted: number;
  /** Set when a call failed: what was done before it stays done, and running it again continues from there. */
  error: unknown | null;
  /** Another window of this browser is preparing the catalog right now: nothing was written here. */
  busy: boolean;
  plan: CatalogPlan<P>;
};

/**
 * Mutual exclusion between windows of the SAME browser (same origin). It is the only exclusion the frontend can offer:
 * the existing RPCs have no unique rule on (category, name) nor an upsert, so two computers preparing at the same time
 * cannot be made impossible from here; see docs/sorteo-simplificado.md.
 */
export type CatalogLocks = { run<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> };

export const CATALOG_LOCK_NAME = 'diaov-raffle-catalog-prepare';

/** The browser's own lock manager (Web Locks): a real lock shared by every tab of the origin, released if the tab closes. */
export function webLocks(manager: Pick<LockManager, 'request'>): CatalogLocks {
  return {
    run: (work) => manager.request(CATALOG_LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? { ok: true as const, value: await work() } : { ok: false as const })),
  };
}

/**
 * Fallback for browsers without Web Locks: a lease in localStorage (token + expiry), confirmed after a short wait. It
 * narrows the window a lot but, unlike Web Locks, it is not atomic; it expires by itself if a tab dies.
 */
export function leaseLocks(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, options: { ttlMs?: number; settleMs?: number } = {}): CatalogLocks {
  const key = `${CATALOG_LOCK_NAME}:lease`;
  const ttl = options.ttlMs ?? 60_000;
  const settle = options.settleMs ?? 60;
  return {
    async run(work) {
      const mine = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const held = () => { try { const lease = JSON.parse(storage.getItem(key) ?? 'null') as { token: string; until: number } | null; return lease && lease.until > Date.now() ? lease : null; } catch { return null; } };
      if (held()) return { ok: false };
      try { storage.setItem(key, JSON.stringify({ token: mine, until: Date.now() + ttl })); }
      catch { return { ok: true, value: await work() }; } // storage blocked: no lease possible, only the re-reads protect
      await new Promise((resolve) => setTimeout(resolve, settle));
      if (held()?.token !== mine) return { ok: false };
      try { return { ok: true, value: await work() }; } finally { if (held()?.token === mine) storage.removeItem(key); }
    },
  };
}

/** Web Locks when the browser has them, the lease otherwise. */
export function browserCatalogLocks(): CatalogLocks {
  if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) return webLocks(navigator.locks);
  try { return leaseLocks(window.localStorage); } catch { return { run: async (work) => ({ ok: true, value: await work() }) }; }
}

async function readPrizes<P extends PrizeRef>(categories: CategoryRef[], deps: CatalogDeps<P>) {
  const found: Record<string, P[]> = {};
  for (const category of categories) found[category.id] = await deps.fetchPrizes(category.id);
  return found;
}

/**
 * Registers what is missing and puts right what the catalog says, nothing else. Safe to repeat and to resume:
 * - one window at a time per browser (see `CatalogLocks`); the second one writes nothing and says so;
 * - it always reads the server first, and reads the category again right before creating each prize, so prizes that
 *   already exist (a previous run, another window, by hand) are recognised by category + name and never created twice;
 * - one prize at a time, in catalog order; a failure stops it and reports what was done;
 * - it never deletes, never touches winners or pending selections, and leaves alone a prize that already has more
 *   committed units than the official quantity.
 */
export async function prepareOfficialCatalog<P extends PrizeRef = PrizeRef>(categories: CategoryRef[], deps: CatalogDeps<P>, locks: CatalogLocks = browserCatalogLocks()): Promise<PrepareResult<P>> {
  const official = categories.filter((category) => !!officialCategory(category.name));
  const outcome = await locks.run(async () => {
    let plan = planCatalog(official, await readPrizes(official, deps));
    let created = 0;
    let adjusted = 0;
    let error: unknown = null;
    if (plan.status !== 'blocked') {
      for (const entry of plan.entries) {
        if (entry.state !== 'missing' && entry.state !== 'adjust') continue;
        try {
          if (entry.state === 'missing') {
            const latest = await deps.fetchPrizes(entry.categoryId as string);
            if (latest.some((prize) => normalizeName(prize.name) === normalizeName(entry.item.name))) continue; // someone just did it
          }
          await deps.savePrize({
            id: entry.prize?.id, category_id: entry.categoryId as string, name: entry.item.name, description: '',
            quantity: entry.item.quantity, is_active: true, sort_order: entry.order,
          });
          if (entry.state === 'missing') created += 1; else adjusted += 1;
        } catch (cause) { error = cause; break; }
      }
      plan = planCatalog(official, await readPrizes(official, deps));
    }
    return { created, adjusted, error, busy: false, plan } satisfies PrepareResult<P>;
  });
  if (outcome.ok) return outcome.value;
  return { created: 0, adjusted: 0, error: null, busy: true, plan: planCatalog(official, await readPrizes(official, deps)) };
}
