import { supabase } from './supabase';

export type Division = { id: string; code: string; name: string; sort_order: number; is_demo: boolean };
export type Career = { id: string; code: string; name: string; division_id: string; is_active: boolean; is_demo: boolean };
export type SessionStatus = 'activa' | 'oculta' | 'cancelada';
export type Session = {
  id: string;
  activity_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  location: string;
  status: SessionStatus;
};

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = { activa: 'Publicada', oculta: 'Oculta', cancelada: 'Cancelada' };
export type Activity = {
  id: string;
  division_id: string;
  title: string;
  description: string;
  location: string;
  is_demo: boolean;
  activity_sessions: Session[];
};

export type Progress = {
  level: number;
  attendances: number;
  division_ids: string[];
  next: { level: number; required_attendances: number; required_divisions: number } | null;
  consent_accepted: boolean;
  interests_prompt: boolean;
  interests_open: boolean;
};

export async function fetchDivisions(): Promise<Division[]> {
  const { data, error } = await supabase.from('divisions').select('id, code, name, sort_order, is_demo').order('sort_order');
  if (error) throw error;
  return data ?? [];
}

export async function fetchCareers(includeInactive = false): Promise<Career[]> {
  let query = supabase.from('careers').select('id, code, name, division_id, is_active, is_demo');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchActivities(editionId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('id, division_id, title, description, location, is_demo, activity_sessions(id, activity_id, starts_at, ends_at, capacity, location, status)')
    .eq('edition_id', editionId)
    .order('title');
  if (error) throw error;
  return (data ?? []).map((a) => ({
    ...a,
    activity_sessions: [...(a.activity_sessions ?? [])].sort((x, y) => x.starts_at.localeCompare(y.starts_at)),
  }));
}

export async function fetchProgress(): Promise<Progress> {
  const { data, error } = await supabase.rpc('my_progress');
  if (error) throw error;
  if (!data || typeof data.level !== 'number') throw new Error('INVALID_PROGRESS');
  return data as Progress;
}

export async function fetchMyAttendedSessionIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('attendances').select('session_id');
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.session_id as string));
}

export async function fetchMyInterests(): Promise<string[]> {
  const { data, error } = await supabase.from('post_event_interests').select('preference, career_id').order('preference');
  if (error) throw error;
  return (data ?? []).map((r) => r.career_id as string);
}

const TZ = 'America/Cancun';

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso));
}

export function formatEventDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

// America/Cancun has a fixed UTC-5 offset (no daylight saving).
export function eventTimestamp(date: string, time: string) {
  return `${date}T${time}:00-05:00`;
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}
