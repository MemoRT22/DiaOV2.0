import { supabase } from './supabase';
import { operationRequest } from './operationRequest';

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export async function staffAccounts<T>(body: Record<string, unknown>): Promise<T> {
  return operationRequest<T>('/functions/v1/staff-accounts', body, 75_000);
}

export const FIELD_LABELS: Record<string, string> = {
  email: 'Correo',
  full_name: 'Nombre completo',
  phone: 'Teléfono',
  high_school: 'Escuela / preparatoria',
  high_school_grade: 'Grado',
  entry_period: 'Periodo de interés',
  initial_career_id: 'Carrera de interés inicial',
  initial_career_id_2: 'Segunda carrera de interés',
  initial_career_raw: 'Carrera recibida en Forms',
  forms_extra: 'Información adicional de Forms',
};

export const ORIGIN_LABELS: Record<string, string> = { forms: 'Forms', manual: 'Alta manual', self_service: 'Autorregistro', demo: 'Prueba' };

export const ROLE_LABELS: Record<string, string> = { coordinacion: 'Coordinación', staff: 'Staff', sorteo: 'Sorteo' };
