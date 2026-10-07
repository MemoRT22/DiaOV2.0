import type { WorkshopDetail as Detail } from '../../lib/workshopAdminApi';
export const ID = '11111111-1111-4111-8111-111111111111';
export const academic = (): Detail => ({
  id: ID, status: 'submitted', created_at: '2026-10-05T15:00:00Z', updated_at: '2026-10-05T15:00:00Z',
  submitted_at: '2026-10-05T15:00:00Z', reviewed_at: null, reviewed_by: null, reviewer_name: null,
  facilitator_name: 'Ana Ruiz', facilitator_email: 'ana@example.com', activity_type: 'academica',
  experience_category: null, title: 'Taller de medicina', student_pitch: 'Experiencia médica',
  objective: 'Conocer el trabajo médico', takeaway: 'Conocimiento', keywords: ['medicina', 'salud', 'alumnos'],
  session_duration_minutes: 30, capacity_per_session: 20, career_count: 2, career_names: ['Medicina', 'Derecho'],
  operating_start_time: '10:00:00', operating_end_time: '12:00:00', building: 'Edificio A', room_space: 'Salón 1',
  requirements: 'Proyector', notes: 'Traer material', admin_notes: null, review_feedback: null,
  published_activity_id: null, sessions: [], careers: [
    { career_id: '11111111-1111-4111-8111-111111111112', career_name: 'Medicina', division_id: 'a', division_name: 'Ciencias de la Salud', division_code: 'DIV-SALUD' },
    { career_id: '11111111-1111-4111-8111-111111111113', career_name: 'Derecho', division_id: 'b', division_name: 'Ciencias Sociales', division_code: 'DIV-SOCIALES' },
  ],
});
