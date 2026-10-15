import { rpc } from './adminApi';

/** Quick numbers of the participants panel (read-only; Coordinación and Staff). */
export type ParticipantsSummary = {
  server_time: string;
  accounts_total: number;
  accounts_with_login: number;
  active_last_hour: number;
  with_reservations: number;
  reservations_active: number;
  with_attendance: number;
  stamps_total: number;
  duplicate_groups: number;
  duplicate_accounts: number;
  duplicates_data_split: number;
  duplicates_route_elsewhere: number;
};

export type OtherAccount = {
  id: string; full_name: string; email: string; origin: string; has_login: boolean;
  last_seen_at: string | null; reservations_active: number; attendances: number; stamps: number;
};

export type Orientation = {
  id: string;
  last_seen_at: string | null;
  reservations_active: number;
  attendances: number;
  stamps: number;
  category: string | null;
  /** Other accounts with the same phone number (probably the same person), the one holding their data first. */
  others: OtherAccount[];
};

export const fetchParticipantsSummary = () => rpc<ParticipantsSummary>('participants_dashboard_summary');

export async function fetchOrientation(ids: string[]): Promise<Map<string, Orientation>> {
  if (ids.length === 0) return new Map();
  const rows = await rpc<Orientation[]>('participants_orientation', { p_ids: ids });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.id, { ...row, others: Array.isArray(row.others) ? row.others : [] }]));
}

/** «hace 5 min», «hace 2 h», «nunca». */
export function lastSeenLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'nunca ha entrado';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

/** The sibling account that holds the student's route/attendance when the one shown is empty (else null). */
export function accountWithTheirData(me: Orientation): OtherAccount | null {
  if (me.reservations_active > 0 || me.attendances > 0) return null;
  return me.others.find((o) => o.reservations_active > 0 || o.attendances > 0) ?? null;
}
