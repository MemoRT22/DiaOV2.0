import { rpc } from './adminApi';

export interface RecommendedSession {
  session_id: string;
  starts_at: string;
  ends_at: string;
  location: string;
  capacity: number;
  reserved: number;
  remaining: number;
  credits: number;
  started: boolean;
}

export interface RecommendedActivity {
  activity_id: string;
  title: string;
  description: string;
  division_id: string;
  division_name: string;
  division_code: string;
  related_careers: string;
  careers: { career_id: string; career_name: string }[];
  already_attended: boolean;
  already_reserved: boolean;
  sessions: RecommendedSession[];
  priority: number;
  /** Why it is recommended (deterministic, rule-based): the same career, or another career of the same division. */
  recommendation_type?: 'exact_career' | 'same_division';
  /** Interest careers this workshop is linked to (exact matches only), best preference first. */
  matched_careers?: { career_id: string; career_name: string; preference: number }[];
  /** Division that triggered a same-division suggestion. */
  matched_division?: { division_id: string; division_name: string; division_code: string } | null;
  /** Preference (1 = first choice) of the interest that explains this recommendation. */
  interest_priority?: number;
  has_open_session?: boolean;
}

export interface RecommendationsResult {
  recommendations: RecommendedActivity[];
  interest_career_ids: string[];
  attended_activity_ids: string[];
  summary?: { exact: number; same_division: number; minimum_target: number };
}

export function fetchRecommendedActivities(): Promise<RecommendationsResult> {
  return rpc<RecommendationsResult>('my_recommended_activities');
}

export function saveActivityCareers(activityId: string, careerIds: string[]): Promise<void> {
  return rpc('save_activity_careers', { p_activity_id: activityId, p_career_ids: careerIds });
}

export async function fetchActivityCareers(activityId: string): Promise<string[]> {
  const { data, error } = await import('./supabase').then((m) =>
    m.supabase.from('activity_careers').select('career_id').eq('activity_id', activityId),
  );
  if (error) throw error;
  return (data ?? []).map((r: { career_id: string }) => r.career_id);
}
