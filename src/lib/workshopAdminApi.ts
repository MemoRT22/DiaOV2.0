import { operationRequest } from './operationRequest';
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
  /** What would be deleted together with the workshop (absent on a backend that does not report it yet). */
  dependents?: WorkshopDependents;
};
export type WorkshopDependents = { sessions: number; reservations: number; attendances: number; participants: number };
export type WorkshopCreated = { submission_id: string; status: ReviewStatus; activity_id: string | null };
export type WorkshopDeleted = { submission_id: string; deleted: true; removed: WorkshopDependents };
/** A workshop that exists only as an activity, without a file (test data from before the unified workshop flow). */
export type LegacyWorkshop = {
  activity_id: string; title: string; activity_type: string; experience_category: string | null;
  is_demo: boolean; location: string | null; created_at: string; division_names: string[];
  sessions: { id: string; starts_at: string; ends_at: string; capacity: number; reserved: number; status: string }[];
  dependents: WorkshopDependents;
};
export type WorkshopList = {
  items: WorkshopSummary[]; total: number; page: number; page_size: number;
  counts: Record<WorkshopGroup, number>;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  return operationRequest<T>('/functions/v1/workshop-admin', body, 30_000);
}

export const workshopAdminApi = {
  list: (filters: { status?: WorkshopGroup | ''; type?: WorkshopType | ''; search?: string; page?: number }) =>
    call<WorkshopList>({ action: 'list', ...filters }),
  get: async (submission_id: string) =>
    (await call<{ submission: WorkshopDetail }>({ action: 'get', submission_id })).submission,
  /** Creates a workshop through the same model as the public form; `publish` leaves it published in one operation. */
  create: async (payload: SubmissionPayload, publish: boolean) =>
    (await call<{ submission: WorkshopCreated }>({ action: 'create', payload, publish })).submission,
  /** Permanently deletes the workshop, in any state, with its sessions, reservations, attendances and credential. */
  remove: (submission_id: string) => call<WorkshopDeleted>({ action: 'delete', submission_id }),
  /** Workshops without a file («expediente»), managed through their activity. */
  listLegacy: async () => (await call<{ items: LegacyWorkshop[] }>({ action: 'list_legacy' })).items ?? [],
  removeLegacy: (activity_id: string) =>
    call<{ activity_id: string; deleted: true; removed: WorkshopDependents }>({ action: 'delete_legacy', activity_id }),
  edit: async (submission_id: string, payload: SubmissionPayload) =>
    (await call<{ submission: { id: string; status: ReviewStatus } }>({ action: 'edit', submission_id, payload })).submission,
  discard: async (submission_id: string) =>
    (await call<{ submission: { id: string; status: ReviewStatus } }>({ action: 'archive', submission_id })).submission,
  approve: (submission_id: string) => call<PublishResult>({ action: 'approve_publish', submission_id }),
};
