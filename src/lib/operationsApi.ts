import { rpc } from './adminApi';

export type OperationsSession = {
  session_id: string;
  activity_id: string;
  title: string;
  division_id: string;
  division_name: string;
  division_code: string;
  starts_at: string;
  ends_at: string;
  location: string;
  status: string;
  capacity: number;
  reserved: number;
  remaining: number;
  attended: number;
  is_demo: boolean;
};

export type OperationsSummary = {
  participants_total: number;
  platform_consents: number;
  active_reservations: number;
  participants_with_reservations: number;
  total_attendances: number;
  unique_attended_participants: number;
  sessions_total: number;
  sessions_upcoming: number;
  sessions_in_progress: number;
  sessions_ended: number;
  sessions_cancelled: number;
};

export type OperationsOverview = {
  server_time: string;
  mode: string;
  checkin_close_after_minutes: number;
  summary: OperationsSummary;
  sessions: OperationsSession[];
};

export const fetchOperationsOverview = () => rpc<OperationsOverview>('event_operations_overview');
