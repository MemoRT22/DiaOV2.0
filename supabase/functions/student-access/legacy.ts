// Ruta de compatibilidad TEMPORAL para el frontend publicado antes del acceso con contraseña (correo + fecha de nacimiento).
// Se elimina junto con la migración de contrato, cuando ya no exista `birth_date` ni el bloqueo por intentos.
// Regla de seguridad: un participante con contraseña configurada nunca entra por esta ruta.

export type LegacyParticipant = {
  id: string;
  birth_date: string | null;
  auth_user_id: string | null;
  password_configured_at: string | null;
};
export type LegacyDeps = {
  sha256: (text: string) => Promise<string>;
  isLocked: (email: string) => Promise<boolean>;
  activeEditionId: () => Promise<string | null>;
  participant: (editionId: string, email: string) => Promise<LegacyParticipant | null>;
  recordAttempt: (emailHash: string, succeeded: boolean) => Promise<void>;
  ensureIdentity: (authEmail: string) => Promise<void>;
  magicLink: (authEmail: string) => Promise<{ hashedToken: string; userId: string }>;
  linkParticipant: (participantId: string, userId: string) => Promise<void>;
  verify: (hashedToken: string) => Promise<{ access_token: string; refresh_token: string }>;
};

export async function handleLegacy(
  body: Record<string, unknown>,
  deps: LegacyDeps,
): Promise<{ status: number; body: unknown }> {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const birthDate = typeof body.birth_date === 'string' ? body.birth_date.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { status: 400, body: { error: 'INVALID_INPUT' } };
  }
  const emailHash = await deps.sha256(email);
  if (await deps.isLocked(email)) return { status: 429, body: { error: 'TOO_MANY_ATTEMPTS' } };
  const editionId = await deps.activeEditionId();
  if (!editionId) return { status: 503, body: { error: 'NO_ACTIVE_EDITION' } };

  const participant = await deps.participant(editionId, email);
  if (!participant || participant.password_configured_at || !participant.birth_date || participant.birth_date !== birthDate) {
    await deps.recordAttempt(emailHash, false);
    return { status: 401, body: { error: 'INVALID_CREDENTIALS' } };
  }

  const authEmail = `p.${participant.id}@participantes.diaov.invalid`;
  if (!participant.auth_user_id) await deps.ensureIdentity(authEmail);
  const link = await deps.magicLink(authEmail);
  if (participant.auth_user_id !== link.userId) await deps.linkParticipant(participant.id, link.userId);
  const session = await deps.verify(link.hashedToken);
  await deps.recordAttempt(emailHash, true);
  return { status: 200, body: session };
}
