import { rpc } from './adminApi';
import { normalizeRaffleStatus, type MyRaffleStatus, type RaffleRule } from './raffleRules';

export type { MyRaffleStatus, RaffleRule } from './raffleRules';

export type RaffleCategory = {
  id: string; name: string; sort_order: number;
  /** Alternatives in stamps; the category is reached when any of them is met. */
  rules: RaffleRule[];
  /** Deprecated mirror of the first alternative, kept by the backend for older readers. */
  required_academic: number; required_leadership: number;
  is_active: boolean; is_demo: boolean;
  visual_config: Record<string, unknown>;
  /** Sorteables de verdad: sellos de la categoría Y encuesta de salida completada (el mismo conjunto del que sortea el servidor). */
  pool_count?: number;
  /** Con los sellos de esta categoría pero sin encuesta: todavía no entran al sorteo. */
  survey_pending_count?: number;
};

/** The alternatives of a category, also when the backend still answers with the previous single condition. */
export const categoryRules = (c: Pick<RaffleCategory, 'rules' | 'required_academic' | 'required_leadership'>): RaffleRule[] =>
  Array.isArray(c.rules) && c.rules.length > 0 ? c.rules : [{ academic: c.required_academic ?? 0, university_life: c.required_leadership ?? 0 }];

export type RafflePrize = {
  id: string; category_id: string; name: string; description: string;
  quantity: number; is_active: boolean; sort_order: number;
  delivered: number; available: number;
};

export type WinnerStatus = 'seleccionado' | 'confirmado' | 'no_presentado' | 'invalidado';

export type RaffleWinner = {
  id: string; prize_id: string; prize_name: string;
  category_id: string; category_name: string;
  display_name: string; status: WinnerStatus;
  drawn_at: string; confirmed_at: string | null;
  invalidation_reason: string | null; origin: string;
};

/** Stamps of each kind held by participants who do not reach any category yet. */
export type UnassignedCombo = { academic: number; university_life: number; count: number };
export type OperatorView = {
  categories: (RaffleCategory & { pool_count: number })[];
  unassigned_combinations: UnassignedCombo[];
};

export type DrawResult = {
  winner_id: string; participant_id: string; display_name: string;
  prize_id: string; prize_name: string; category_id: string; category_name: string;
  status: string; pool_size: number; idempotent: boolean;
};

export async function fetchMyRaffleStatus(): Promise<MyRaffleStatus> { return normalizeRaffleStatus(await rpc<Record<string, unknown>>('my_raffle_status')); }
export async function fetchOperatorView(): Promise<OperatorView> {
  const view = await rpc<{ categories: OperatorView['categories']; unassigned_combinations: (Partial<UnassignedCombo> & { leadership?: number })[] }>('raffle_operator_view');
  return {
    categories: view.categories,
    unassigned_combinations: (view.unassigned_combinations ?? []).map((c) => ({
      academic: c.academic ?? 0, university_life: c.university_life ?? c.leadership ?? 0, count: c.count ?? 0,
    })),
  };
}
export async function fetchCategories(): Promise<RaffleCategory[]> { return rpc<RaffleCategory[]>('raffle_categories_read'); }
export async function fetchPrizes(categoryId: string): Promise<RafflePrize[]> { return rpc<RafflePrize[]>('raffle_prizes_read', { p_category_id: categoryId }); }
export async function fetchPoolCount(categoryId: string): Promise<number> { return rpc<number>('raffle_pool_count', { p_category_id: categoryId }); }
export async function fetchWinners(): Promise<RaffleWinner[]> { return rpc<RaffleWinner[]>('raffle_winners_read'); }
export async function saveCategory(params: { id?: string; name: string; sort_order: number; rules: RaffleRule[]; is_active: boolean; is_demo?: boolean }): Promise<string> {
  // `required_*` repeats the first alternative for a backend that does not know `rules` yet.
  const first = params.rules[0] ?? {};
  return rpc<string>('save_raffle_category', { p: { ...params, required_academic: first.academic ?? 0, required_leadership: first.university_life ?? 0 } });
}
export async function savePrize(params: { id?: string; category_id: string; name: string; description?: string; quantity: number; is_active: boolean; sort_order: number }): Promise<string> { return rpc<string>('save_raffle_prize', { p: params }); }
export async function fetchPendingSelection(prizeId: string): Promise<{ winner_id: string | null; display_name?: string; prize_name?: string; category_name?: string; status?: string; drawn_at?: string }> { return rpc('raffle_pending_selection', { p_prize_id: prizeId }); }
export async function drawWinner(prizeId: string, idempotencyKey: string): Promise<DrawResult> { return rpc<DrawResult>('draw_winner', { p_prize_id: prizeId, p_idempotency_key: idempotencyKey }); }
export async function confirmWinner(winnerId: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('confirm_winner', { p_winner_id: winnerId }); }
export async function markNoShow(winnerId: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('mark_no_show', { p_winner_id: winnerId }); }
export async function invalidateWinner(winnerId: string, reason: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('invalidate_winner', { p_winner_id: winnerId, p_reason: reason }); }
