import { functionsUrl, supabase, supabaseAnonKey } from './supabase';
import type { SubmissionPayload } from '../../supabase/functions/workshop-intake/validation.ts';

export type ReviewStatus = 'submitted' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'archived';
export type WorkshopType = 'academica' | 'vida_universitaria';
export type WorkshopGroup = 'pending' | 'published' | 'archived';
export type PublishResult = {
  submission_id: string; status: 'published'; activity_id: string;
  session_count: number; career_count: number; division_count: number;
  credential_created: boolean;
};

export const groupForStatus = (status: ReviewStatus): WorkshopGroup =>
  status === 'published' ? 'published' : status === 'archived' ? 'archived' : 'pending';
export const GROUP_LABELS: Record<WorkshopGroup, string> = {
  pending: 'Pendiente', published: 'Publicado', archived: 'Descartado',
};
export const CATEGORY_LABELS: Record<string, string> = {
  liderazgo: 'Liderazgo', deportiva: 'Deportiva', artistica_cultural: 'Artística / cultural',
  vida_universitaria: 'Vida universitaria', otra: 'Otra',
};
export const TYPE_LABELS: Record<WorkshopType, string> = {
  academica: 'Taller académico', vida_universitaria: 'Vida Universitaria',
};

export type WorkshopSummary = {
  id: string; status: ReviewStatus; submitted_at: string; title: string;
  activity_type: WorkshopType; experience_category: string | null;
  facilitator_name: string; session_duration_minutes: number; capacity_per_session: number;
  career_count: number; career_names: string[]; building: string; room_space: string;
};
export type WorkshopCareer = {
  career_id: string; career_name: string; division_id: string; division_name: string; division_code: string;
};
export type WorkshopDetail = WorkshopSummary & {
  created_at: string; updated_at: string; reviewed_at: string | null;
  reviewed_by: string | null; reviewer_name: string | null;
  facilitator_email: string; student_pitch: string;  objective: string | null;
   takeaway: string; keywords: string[];
  operating_start_time: string; operating_end_time: string; building: string; room_space: string;
  requirements: string | null; notes: string | null; admin_notes: string | null;
  review_feedback: string | null; published_activity_id: string | null; careers: WorkshopCareer[];
  sessions: { id: string; starts_at: string; ends_at: string; capacity: number; reserved: number; location: string | null; status: string }[];
};
export type WorkshopList = {
  items: WorkshopSummary[]; total: number; page: number; page_size: number;
  counts: Record<WorkshopGroup, number>;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('NOT_AUTHORIZED');
  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/workshop-admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { throw new Error('NETWORK'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== 'object') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'SERVER_ERROR');
  }
  return result as T;
}

export const workshopAdminApi = {
  list: (filters: { status?: WorkshopGroup | ''; type?: WorkshopType | ''; search?: string; page?: number }) =>
    call<WorkshopList>({ action: 'list', ...filters }),
  get: async (submission_id: string) =>
    (await call<{ submission: WorkshopDetail }>({ action: 'get', submission_id })).submission,
  edit: async (submission_id: string, payload: SubmissionPayload) =>
    (await call<{ submission: { id: string; status: ReviewStatus } }>({ action: 'edit', submission_id, payload })).submission,
  discard: async (submission_id: string) =>
    (await call<{ submission: { id: string; status: ReviewStatus } }>({ action: 'archive', submission_id })).submission,
  approve: (submission_id: string) => call<PublishResult>({ action: 'approve', submission_id }),
};
