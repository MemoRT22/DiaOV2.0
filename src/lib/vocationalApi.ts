import { rpc } from './adminApi';

export interface VocationalTag {
  code: string;
  label: string;
}

export interface InitialInterest {
  career_id: string;
  career_name: string;
  division_id: string;
  division_name: string;
  division_code: string;
}

export interface AttendedWorkshop {
  activity_id: string;
  title: string;
  activity_type: string;
  division_id: string;
  division_name: string;
  division_code: string;
  tags: VocationalTag[];
}

export interface ReservedWorkshop {
  activity_id: string;
  title: string;
  activity_type: string;
  division_id: string;
  division_name: string;
  division_code: string;
}

export interface VisitedDivision {
  division_id: string;
  division_name: string;
  division_code: string;
}

export interface PostEventInterest {
  preference: number;
  career_id: string;
  career_name: string;
  division_id: string;
  division_name: string;
}

export interface RecommendationReason {
  type: string;
  text: string;
}

export interface Recommendation {
  career_id: string;
  career_name: string;
  division_id: string;
  division_name: string;
  division_code: string;
  reasons: RecommendationReason[];
  matched_tags: VocationalTag[];
  is_initial_interest: boolean;
}

export interface VocationalProfile {
  initial_interest: InitialInterest | null;
  attended_workshops: AttendedWorkshop[];
  reserved_workshops: ReservedWorkshop[];
  divisions_visited: VisitedDivision[];
  post_event_interests: PostEventInterest[];
  recommendations: Recommendation[];
  tag_codes_explored: string[];
}

export function fetchVocationalProfile(): Promise<VocationalProfile> {
  return rpc<VocationalProfile>('my_vocational_profile');
}

export interface VocationalExportRow {
  participant_id: string;
  full_name: string;
  is_demo: boolean;
  initial_career_code: string;
  initial_career: string;
  initial_division: string;
  interest_1: string;
  interest_2: string;
  interest_3: string;
  attended_count: number;
  divisions_visited: string;
  attended_workshops: string;
}

export interface VocationalExportPayload {
  edition: string;
  edition_code: string;
  generated_at: string;
  generated_by: string;
  count: number;
  rows: VocationalExportRow[];
}

export function exportVocational(reason: string, includeDemo: boolean): Promise<VocationalExportPayload> {
  return rpc<VocationalExportPayload>('export_vocational', { p_reason: reason, p_include_demo: includeDemo });
}
