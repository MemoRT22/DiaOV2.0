import { rpc } from './adminApi';

export type RaffleCategory = {
  id: string; name: string; sort_order: number;
  required_academic: number; required_leadership: number;
  is_active: boolean; is_demo: boolean;
  visual_config: Record<string, unknown>;
  pool_count?: number;
};

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

export type UnassignedCombo = { academic: number; leadership: number; count: number };
export type OperatorView = {
  categories: (RaffleCategory & { pool_count: number })[];
  unassigned_combinations: UnassignedCombo[];
};

export type DrawResult = {
  winner_id: string; participant_id: string; display_name: string;
  prize_id: string; prize_name: string; category_id: string; category_name: string;
  status: string; pool_size: number; idempotent: boolean;
};

export async function fetchMyRaffleStatus(): Promise<{ academic_tickets: number; leadership_tickets: number; raffle_category: string | null; raffle_category_name: string | null; has_won: boolean }> { return rpc('my_raffle_status'); }
export async function fetchOperatorView(): Promise<OperatorView> { return rpc<OperatorView>('raffle_operator_view'); }
export async function fetchCategories(): Promise<RaffleCategory[]> { return rpc<RaffleCategory[]>('raffle_categories_read'); }
export async function fetchPrizes(categoryId: string): Promise<RafflePrize[]> { return rpc<RafflePrize[]>('raffle_prizes_read', { p_category_id: categoryId }); }
export async function fetchPoolCount(categoryId: string): Promise<number> { return rpc<number>('raffle_pool_count', { p_category_id: categoryId }); }
export async function fetchWinners(): Promise<RaffleWinner[]> { return rpc<RaffleWinner[]>('raffle_winners_read'); }
export async function saveCategory(params: { id?: string; name: string; sort_order: number; required_academic: number; required_leadership: number; is_active: boolean; is_demo?: boolean }): Promise<string> { return rpc<string>('save_raffle_category', { p: params }); }
export async function savePrize(params: { id?: string; category_id: string; name: string; description?: string; quantity: number; is_active: boolean; sort_order: number }): Promise<string> { return rpc<string>('save_raffle_prize', { p: params }); }
export async function drawWinner(prizeId: string, idempotencyKey: string): Promise<DrawResult> { return rpc<DrawResult>('draw_winner', { p_prize_id: prizeId, p_idempotency_key: idempotencyKey }); }
export async function confirmWinner(winnerId: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('confirm_winner', { p_winner_id: winnerId }); }
export async function markNoShow(winnerId: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('mark_no_show', { p_winner_id: winnerId }); }
export async function invalidateWinner(winnerId: string, reason: string): Promise<{ winner_id: string; status: string }> { return rpc<{ winner_id: string; status: string }>('invalidate_winner', { p_winner_id: winnerId, p_reason: reason }); }
