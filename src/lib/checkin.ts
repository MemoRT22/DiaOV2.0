import { rpc } from './adminApi';

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

export const checkIn = (credential: string) => rpc<CheckInResult>('check_in', { p_credential: credential });

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

export const regenerateActivityCredential = (activityId: string, reason: string) =>
  rpc<ActivityCredentialDisplay>('regenerate_activity_credential', { p_activity: activityId, p_reason: reason });

export const resolveSessionToActivity = (sessionId: string) =>
  rpc<string>('session_to_activity', { p_session: sessionId });
