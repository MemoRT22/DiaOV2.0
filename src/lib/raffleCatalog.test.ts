import { describe, expect, test } from 'vitest';
import { normalizeName, OFFICIAL_CATALOG, OFFICIAL_KINDS, OFFICIAL_UNITS, planCatalog, prepareOfficialCatalog, type CatalogDeps } from './raffleCatalog';

const CATEGORIES = [{ id: 'un', name: 'Universo' }, { id: 'ga', name: 'Galaxia' }, { id: 'ss', name: 'Sistema Solar' }];
type P = { id: string; category_id: string; name: string; quantity: number; is_active: boolean; delivered: number };

/** A tiny server: the only thing the catalog may use are these two calls. */
function server(initial: P[] = [], failOn: number | null = null) {
  const prizes = [...initial];
  let calls = 0;
  let nextId = 100;
  const deps: CatalogDeps = {
    fetchPrizes: async (categoryId) => prizes.filter((prize) => prize.category_id === categoryId).map((prize) => ({ ...prize })),
    savePrize: async (params) => {
      calls += 1;
      if (failOn !== null && calls === failOn) throw new Error('NETWORK');
      if (params.id) {
        const prize = prizes.find((candidate) => candidate.id === params.id)!;
        if (params.quantity < prize.delivered) throw new Error('QUANTITY_BELOW_COMMITTED');
        Object.assign(prize, { name: params.name, quantity: params.quantity, is_active: params.is_active });
        return params.id;
      }
      const id = `p${nextId++}`;
      prizes.push({ id, category_id: params.category_id, name: params.name, quantity: params.quantity, is_active: params.is_active, delivered: 0 });
      return id;
    },
  };
  return { prizes, deps, calls: () => calls };
}
const p = (id: string, category_id: string, name: string, quantity: number, over: Partial<P> = {}): P => ({ id, category_id, name, quantity, is_active: true, delivered: 0, ...over });

describe('the official definition', () => {
  test('is 16 units in 3 categories: Universo 3, Galaxia 3, Sistema Solar 10', () => {
    expect(OFFICIAL_UNITS).toBe(16);
    expect(OFFICIAL_KINDS).toBe(5);
    const units = Object.fromEntries(OFFICIAL_CATALOG.map((category) => [category.name, category.items.reduce((n, item) => n + item.quantity, 0)]));
    expect(units).toEqual({ Universo: 3, Galaxia: 3, 'Sistema Solar': 10 });
  });
  test('keeps the specifications literally and puts each prize in its category', () => {
    const flat = OFFICIAL_CATALOG.flatMap((category) => category.items.map((item) => [category.name, item.name, item.quantity]));
    expect(flat).toEqual([
      ['Universo', 'MacBook Neo de 13 pulgadas, 256 GB', 1],
      ['Universo', 'iPad Air de 64 GB', 2],
      ['Galaxia', 'Apple Watch S3 GPS', 1],
      ['Galaxia', 'Nintendo Switch OLED', 2],
      ['Sistema Solar', 'Tarjeta de regalo Amazon de $1,200 MXN', 10],
    ]);
  });
  test('the ten Amazon cards are ONE prize with quantity ten', () => {
    expect(OFFICIAL_CATALOG[2].items).toHaveLength(1);
    expect(OFFICIAL_CATALOG[2].items[0].quantity).toBe(10);
  });
  test('names are compared without accents, case or extra spaces', () => {
    expect(normalizeName('  iPad   AIR de 64 GB ')).toBe('ipad air de 64 gb');
    expect(normalizeName('Tarjeta de regalo Amazon')).toBe(normalizeName('tarjeta de regalo   amazon'));
  });
});

describe('planCatalog', () => {
  test('nothing registered → pending; every entry missing', () => {
    const plan = planCatalog(CATEGORIES, {});
    expect(plan).toMatchObject({ status: 'pending', toCreate: 5, toAdjust: 0, conflicts: 0 });
    expect(plan.entries.every((entry) => entry.state === 'missing')).toBe(true);
  });
  test('everything registered as official → ready', async () => {
    const s = server();
    const result = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(result.plan.status).toBe('ready');
    expect(planCatalog(CATEGORIES, { un: s.prizes.filter((x) => x.category_id === 'un'), ga: s.prizes.filter((x) => x.category_id === 'ga'), ss: s.prizes.filter((x) => x.category_id === 'ss') }).status).toBe('ready');
  });
  test('a missing category blocks the plan and is named', () => {
    const plan = planCatalog(CATEGORIES.filter((c) => c.id !== 'ga'), {});
    expect(plan.status).toBe('blocked');
    expect(plan.missingCategories).toEqual(['Galaxia']);
    expect(plan.entries.filter((entry) => entry.state === 'blocked')).toHaveLength(2);
  });
  test('prizes from a previous run are recognised, not repeated; the rest are reported, not touched', () => {
    const plan = planCatalog(CATEGORIES, {
      un: [p('a', 'un', 'ipad AIR de 64 gb', 2), p('x', 'un', 'Premio de prueba', 5), p('y', 'un', 'iPad Air de 64 GB', 2)],
    });
    expect(plan.entries.find((entry) => entry.item.key === 'ipad-air')).toMatchObject({ state: 'ok' });
    expect(plan.extras.map((extra) => [extra.prize.id, extra.reason])).toEqual([['x', 'unofficial'], ['y', 'duplicate']]);
    expect(plan.status).toBe('partial');
  });
  test('a different quantity or an inactive prize can be put right; fewer than already committed is left alone', () => {
    const plan = planCatalog(CATEGORIES, {
      un: [p('m', 'un', 'MacBook Neo de 13 pulgadas, 256 GB', 3), p('i', 'un', 'iPad Air de 64 GB', 2, { is_active: false })],
      ga: [p('w', 'ga', 'Apple Watch S3 GPS', 1), p('s', 'ga', 'Nintendo Switch OLED', 5, { delivered: 4 })],
      ss: [p('c', 'ss', 'Tarjeta de regalo Amazon de $1,200 MXN', 10)],
    });
    expect(plan.entries.map((entry) => [entry.item.key, entry.state, entry.differences])).toEqual([
      ['macbook-neo', 'adjust', ['quantity']],
      ['ipad-air', 'adjust', ['inactive']],
      ['apple-watch-s3', 'ok', []],
      ['switch-oled', 'conflict', ['quantity']],
      ['amazon-1200', 'ok', []],
    ]);
    expect(plan).toMatchObject({ toAdjust: 2, conflicts: 1, status: 'partial' });
  });
});

describe('prepareOfficialCatalog', () => {
  test('registers the 16 units on an empty server: 5 prizes', async () => {
    const s = server();
    const result = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(result).toMatchObject({ created: 5, adjusted: 0, error: null });
    expect(s.prizes).toHaveLength(5);
    expect(s.prizes.reduce((sum, prize) => sum + prize.quantity, 0)).toBe(16);
    const byCategory = (id: string) => s.prizes.filter((prize) => prize.category_id === id).reduce((sum, prize) => sum + prize.quantity, 0);
    expect([byCategory('un'), byCategory('ga'), byCategory('ss')]).toEqual([3, 3, 10]);
  });
  test('running it twice never duplicates and the second run writes nothing', async () => {
    const s = server();
    await prepareOfficialCatalog(CATEGORIES, s.deps);
    const writes = s.calls();
    const again = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(again).toMatchObject({ created: 0, adjusted: 0, error: null });
    expect(s.calls()).toBe(writes);
    expect(s.prizes).toHaveLength(5);
  });
  test('a partly prepared catalog is completed without duplicates', async () => {
    const s = server([p('m', 'un', 'MacBook Neo de 13 pulgadas, 256 GB', 1), p('a', 'ss', 'Tarjeta de regalo Amazon de $1,200 MXN', 10)]);
    const result = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(result).toMatchObject({ created: 3, adjusted: 0, error: null });
    expect(s.prizes).toHaveLength(5);
    expect(result.plan.status).toBe('ready');
  });
  test('if it fails half way, what was done stays and running it again resumes without duplicating', async () => {
    const s = server([], 3);
    const first = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(first.error).toBeInstanceOf(Error);
    expect(first.created).toBe(2);
    expect(first.plan.status).toBe('partial');
    expect(s.prizes).toHaveLength(2);
    const second = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(second).toMatchObject({ created: 3, error: null });
    expect(s.prizes).toHaveLength(5);
    expect(second.plan.status).toBe('ready');
  });
  test('it fixes a wrong quantity but never lowers a prize below its deliveries, and never deletes anything', async () => {
    const s = server([
      p('m', 'un', 'MacBook Neo de 13 pulgadas, 256 GB', 4),
      p('s', 'ga', 'Nintendo Switch OLED', 5, { delivered: 3 }),
      p('old', 'ss', 'Premio de prueba', 7, { delivered: 2 }),
    ]);
    const result = await prepareOfficialCatalog(CATEGORIES, s.deps);
    expect(s.prizes.find((x) => x.id === 'm')!.quantity).toBe(1);
    expect(s.prizes.find((x) => x.id === 's')!.quantity).toBe(5); // 3 committed > 2 official: left alone and reported
    expect(result.plan.conflicts).toBe(1);
    expect(s.prizes.find((x) => x.id === 'old')).toMatchObject({ name: 'Premio de prueba', quantity: 7, delivered: 2 }); // not deleted, not edited
    expect(result.plan.extras.map((extra) => extra.prize.id)).toEqual(['old']);
    expect(s.prizes.map((x) => x.id)).toEqual(expect.arrayContaining(['m', 's', 'old']));
    expect(s.prizes).toHaveLength(3 + 3); // + iPad, Watch, Amazon
  });
});
