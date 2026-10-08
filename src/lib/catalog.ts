import { supabase } from './supabase';

export type Division = { id: string; code: string; name: string; sort_order: number; is_demo: boolean };
export type HighSchool = { id: string; name: string; is_active: boolean };
export type Career = { id: string; code: string; name: string; division_id: string; is_active: boolean; is_demo: boolean };
export type SessionStatus = 'activa' | 'oculta' | 'cancelada';

export type Progress = {
  level: number;
  stamps: number;
  attended_workshops: number;
  reserved_workshops: number;
  division_ids: string[];
  next: { level: number; required_attendances: number; required_divisions: number } | null;
  consent_accepted: boolean;
  /** Post-event interests ("¿qué carreras te interesaron más?"), independent from the initial interests. */
  post_event_interests_prompt: boolean;
  post_event_interests_open: boolean;
  post_event_interests_completed: boolean;
};

/** Careers the participant may pick: derived server-side from their identity (active + their demo/real environment). */
export type PostEventCareer = Pick<Career, 'id' | 'code' | 'name' | 'division_id'>;

export type PostEventInterests = {
  post_event_interests_prompt: boolean;
  post_event_interests_open: boolean;
  post_event_interests_completed: boolean;
  post_event_interests_can_edit: boolean;
  max_interests: number;
  /** Selected career ids ordered by preference (1st, 2nd, 3rd). */
  career_ids: string[];
  items: { career_id: string; preference: number }[];
  careers: PostEventCareer[];
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

export async function fetchHighSchools(includeInactive = false): Promise<HighSchool[]> {
  let query = supabase.from('high_schools').select('id, name, is_active');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchProgress(): Promise<Progress> {
  const { data, error } = await supabase.rpc('my_progress');
  if (error) throw error;
  if (!data || typeof data.level !== 'number') throw new Error('INVALID_PROGRESS');
  return data as Progress;
}

export async function fetchPostEventInterests(): Promise<PostEventInterests> {
  const { data, error } = await supabase.rpc('my_post_event_interests');
  if (error) throw error;
  if (!data || !Array.isArray(data.career_ids)) throw new Error('INVALID_INTERESTS');
  return data as PostEventInterests;
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
