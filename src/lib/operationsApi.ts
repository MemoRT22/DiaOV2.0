import { rpc } from './adminApi';

export type OperationsDivision = { id: string; code: string; name: string };

/**
 * One session of the operational snapshot. `divisions` is the real many-to-many relation (activity_divisions);
 * the legacy `division_*` fields of the previous contract are intentionally not typed here.
 */
export type OperationsSession = {
  session_id: string;
  activity_id: string;
  title: string;
  divisions: OperationsDivision[];
  starts_at: string;
  ends_at: string;
  /** Session location with fallback to the workshop's; null when both are empty. */
  location: string | null;
  status: string;
  capacity: number;
  /** Reservations that take capacity (vigente + expirada). */
  reserved: number;
  remaining: number;
  attended: number;
  /** Reservations left by this session's cancellation, and how many still have no alternative. */
  affected_reservations: number;
  affected_unresolved: number;
};

export type OperationsSummary = {
  participants_total: number;
  active_reservations: number;
  participants_with_reservations: number;
  total_attendances: number;
  unique_attended_participants: number;
  sessions_total: number;
  sessions_upcoming: number;
  sessions_in_progress: number;
  sessions_ended: number;
  sessions_cancelled: number;
  activities_total: number;
  capacity_total: number;
  reserved_total: number;
};

export type OperationsOverview = {
  /** The only clock used for operational decisions. */
  server_time: string;
  mode: 'preparacion' | 'operacion_real' | string;
  event_date: string;
  timezone: string;
  checkin_close_after_minutes: number;
  summary: OperationsSummary;
  sessions: OperationsSession[];
};

export const fetchOperationsOverview = () => rpc<OperationsOverview>('event_operations_overview');
