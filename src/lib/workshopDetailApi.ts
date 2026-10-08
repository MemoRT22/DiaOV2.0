import { rpc } from './adminApi';

export type WorkshopDetail = {
  activity_id: string;
  title: string;
  student_pitch: string;
  activity_type: string | null;
  experience_category: string | null;
  objective: string | null;
  takeaway: string | null;
  requirements: string | null;
  careers: Array<{ id: string; name: string }>;
  divisions: Array<{ id: string; name: string }>;
};

export const fetchWorkshopDetail = (activityId: string) =>
  rpc<WorkshopDetail | null>('my_workshop_detail', { p_activity_id: activityId });
