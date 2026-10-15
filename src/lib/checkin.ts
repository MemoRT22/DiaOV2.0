import { rpc } from './adminApi';
import { operationRequest } from './operationRequest';
import { AccessError } from './accessErrors';

export type CheckInResult = {
  already_registered: boolean;
  session_id: string;
  activity_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  credits_granted: number;
  method: 'qr' | 'codigo_manual';
  stamps: number;
  attended_workshops: number;
  level: number;
};

export const CHECKIN_TIMEOUT_MS = 12_000;
export async function checkIn(credential: string, signal?: AbortSignal): Promise<CheckInResult> {
  const result = await operationRequest<CheckInResult>('/rest/v1/rpc/check_in', { p_credential: credential }, CHECKIN_TIMEOUT_MS, signal);
  if (typeof result.already_registered !== 'boolean' || typeof result.title !== 'string'
    || typeof result.session_id !== 'string' || typeof result.activity_id !== 'string'
    || !Number.isFinite(Date.parse(result.starts_at)) || !Number.isFinite(Date.parse(result.ends_at))
    || !['stamps', 'credits_granted', 'attended_workshops', 'level'].every((k) => Number.isFinite(result[k as keyof CheckInResult]))) {
    throw new AccessError('TEMPORARILY_UNAVAILABLE');
  }
  return result;
}

export type CheckinSession = {
  session_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  capacity: number;
  reserved: number;
  attended: number;
};

export type CheckinActivity = {
  activity_id: string;
  title: string;
  location: string;
  sessions: CheckinSession[];
  total_reserved: number;
  total_attended: number;
};

export const fetchCheckinOverview = () => rpc<CheckinActivity[]>('activity_checkin_overview');

export type ActivityCredentialDisplay = {
  activity_id: string;
  qr_token: string;
  manual_code: string;
  title: string;
  location: string;
  sessions: CheckinSession[];
};

export const fetchActivityCredentialDisplay = (activityId: string) =>
  rpc<ActivityCredentialDisplay>('activity_credential_display', { p_activity: activityId });

export type RegenerateResult = {
  activity_id: string;
  qr_token: string;
  manual_code: string;
};

export const regenerateActivityCredential = (activityId: string, reason: string) =>
  rpc<RegenerateResult>('regenerate_activity_credential', { p_activity: activityId, p_reason: reason });

export const resolveSessionToActivity = (sessionId: string) =>
  rpc<string>('session_to_activity', { p_session: sessionId });
