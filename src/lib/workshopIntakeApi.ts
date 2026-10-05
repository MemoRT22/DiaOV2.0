// Cliente ESPECÍFICO del formulario público de propuestas de taller. Habla únicamente con la Edge Function
// `workshop-intake` (GET catálogo / POST propuesta). No usa el helper genérico de RPC, ni sesión, ni
// credenciales: la función es pública (sin login) y es la única frontera de escritura.
import type { FieldError, LIMITS, SubmissionPayload } from '../../supabase/functions/workshop-intake/validation.ts';

export type IntakeCatalog = {
  edition: { name: string; event_date: string } | null;
  divisions: { division_id: string; division_name: string }[];
  careers: { career_id: string; career_name: string; division_id: string }[];
  activity_types: readonly { value: 'academica' | 'liderazgo'; label: string }[];
  limits: typeof LIMITS;
};

export type SubmissionReceipt = { submission_id: string; status: 'submitted'; submitted_at: string };

/** Error normalizado: nunca expone mensajes internos del servidor. */
export class IntakeError extends Error {
  constructor(
    public readonly kind: 'network' | 'http',
    public readonly status: number,
    public readonly code: string,
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(code);
    this.name = 'IntakeError';
  }
}

function endpoint(): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return `${base.replace(/\/$/, '')}/functions/v1/workshop-intake`;
}

async function request(init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(endpoint(), init);
  } catch {
    throw new IntakeError('network', 0, 'NETWORK');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; errors?: unknown };
    const code = typeof b.error === 'string' ? b.error : res.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'SERVER_ERROR';
    const fieldErrors = Array.isArray(b.errors)
      ? (b.errors as unknown[]).filter(
          (e): e is FieldError => !!e && typeof (e as FieldError).field === 'string' && typeof (e as FieldError).code === 'string',
        )
      : [];
    throw new IntakeError('http', res.status, code, fieldErrors);
  }
  return body;
}

export async function fetchWorkshopIntakeCatalog(): Promise<IntakeCatalog> {
  const body = (await request({ method: 'GET' })) as Partial<IntakeCatalog> | null;
  if (!body || !Array.isArray(body.divisions) || !Array.isArray(body.careers)) {
    throw new IntakeError('http', 200, 'INVALID_RESPONSE');
  }
  return body as IntakeCatalog;
}

export async function submitWorkshopProposal(payload: SubmissionPayload): Promise<SubmissionReceipt> {
  const body = (await request({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })) as Partial<SubmissionReceipt> | null;
  if (!body || typeof body.submission_id !== 'string') throw new IntakeError('http', 200, 'INVALID_RESPONSE');
  return body as SubmissionReceipt;
}
