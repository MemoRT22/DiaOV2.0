import { rpc } from './adminApi';

export type CheckInResult = {
  already_registered: boolean;
  session_id: string;
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
  activity_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  status: string;
  credits: number;
  capacity: number;
  reserved: number;
  attended: number;
};

export const fetchCheckinOverview = () => rpc<CheckinSession[]>('session_checkin_overview');

export type CredentialDisplay = {
  session_id: string;
  qr_token: string;
  manual_code: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
};

export const fetchCredentialDisplay = (sessionId: string) =>
  rpc<CredentialDisplay>('session_credential_display', { p_session: sessionId });

export const regenerateCredential = (sessionId: string, reason: string) =>
  rpc<CredentialDisplay>('regenerate_session_credential', { p_session: sessionId, p_reason: reason });
