import { functionsUrl, supabase, supabaseAnonKey } from './supabase';

export type ReviewStatus = 'submitted' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'archived';
export type WorkshopType = 'academica' | 'vida_universitaria';
export type ReviewAction = 'start_review' | 'save_notes' | 'request_changes' | 'resume_review' | 'archive';

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  submitted: 'Nueva', in_review: 'En revisión', changes_requested: 'Cambios solicitados',
  approved: 'Aprobada', published: 'Publicada', archived: 'Archivada',
};
export const STATUS_COUNT_LABELS: Record<ReviewStatus, string> = {
  ...STATUS_LABELS, submitted: 'Nuevas', approved: 'Aprobadas', published: 'Publicadas', archived: 'Archivadas',
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
  career_count: number;
};
export type WorkshopCareer = {
  career_id: string; career_name: string; division_id: string; division_name: string; division_code: string;
};
export type WorkshopDetail = WorkshopSummary & {
  created_at: string; updated_at: string; reviewed_at: string | null;
  reviewed_by: string | null; reviewer_name: string | null;
  facilitator_email: string; student_pitch: string; why_join: string; objective: string | null;
  student_experience: string; takeaway: string; keywords: string[];
  operating_start_time: string; operating_end_time: string; building: string; room_space: string;
  requirements: string | null; notes: string | null; admin_notes: string | null;
  review_feedback: string | null; careers: WorkshopCareer[];
};
export type WorkshopList = {
  items: WorkshopSummary[]; total: number; page: number; page_size: number;
  counts: Partial<Record<ReviewStatus, number>>;
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
  list: (filters: { status?: ReviewStatus | ''; type?: WorkshopType | ''; search?: string; page?: number }) =>
    call<WorkshopList>({ action: 'list', ...filters }),
  get: async (submission_id: string) =>
    (await call<{ submission: WorkshopDetail }>({ action: 'get', submission_id })).submission,
  transition: async (action: ReviewAction, submission_id: string, fields: { admin_notes?: string; review_feedback?: string } = {}) =>
    (await call<{ submission: { id: string; status: ReviewStatus } }>({ action, submission_id, ...fields })).submission,
};
