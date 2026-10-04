const MESSAGES: Record<string, string> = {
  NOT_AUTHORIZED: 'No tienes permiso para realizar esta acción.',
  INVALID_INPUT: 'Revisa que el correo y la fecha estén completos.',
  INVALID_CREDENTIALS: 'No encontramos un registro con ese correo y fecha de nacimiento.',
  TOO_MANY_ATTEMPTS: 'Demasiados intentos. Espera unos minutos o acude al módulo de registro.',
  NO_ACTIVE_EDITION: 'El evento aún no está disponible.',
  THEME_LOCKED: 'La temática está bloqueada porque el evento está en operación real.',
  INVALID_THEME: 'La configuración de la temática no es válida.',
  THEME_TOO_LARGE: 'La configuración de la temática es demasiado grande.',
  INVALID_ASSET_PATH: 'Las rutas de imágenes deben empezar con /assets/ o https://.',
  NO_DRAFT: 'No hay un borrador para publicar.',
  NOT_FOUND: 'No se encontró el elemento.',
  NOT_IN_REAL_OPERATION: 'El desbloqueo de emergencia solo aplica durante la operación real.',
  WRONG_PHRASE: 'La frase de confirmación no coincide.',
  REASON_REQUIRED: 'Escribe un motivo de al menos 10 caracteres.',
  LOCKED_IN_REAL_OPERATION: 'No se puede modificar durante la operación real.',
  INVALID_RULES: 'Las reglas deben ir en aumento y el primer rango no debe tener requisitos.',
  PURGE_DISABLED: 'La limpieza de datos de prueba está deshabilitada en operación real.',
  PURGE_BLOCKED: 'Hay datos reales ligados a datos de prueba. Resuélvelos antes de limpiar.',
  ALREADY_REAL: 'La operación real ya está activa.',
  DEMO_DATA_REMAINS: 'Aún hay datos de prueba. Retíralos antes de activar la operación real.',
  NO_PUBLISHED_THEME: 'Publica una temática antes de activar la operación real.',
  INTERESTS_CLOSED: 'La selección de carreras ya cerró.',
  TOO_MANY_INTERESTS: 'Puedes elegir máximo tres carreras.',
  DUPLICATE_INTEREST: 'No repitas carreras.',
  INVALID_CAREER: 'Alguna carrera ya no está disponible.',
  INVALID_STAFF_CREDENTIALS: 'Correo o contraseña incorrectos.',
  NETWORK: 'No hay conexión. Revisa tu internet e inténtalo de nuevo.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 10 caracteres.',
  PASSWORD_MISMATCH: 'Las contraseñas no coinciden.',
  INVALID_EMAIL: 'Escribe un correo válido.',
  INVALID_NAME: 'Escribe un nombre válido.',
  INVALID_PHONE: 'El teléfono debe tener entre 10 y 15 dígitos.',
  INVALID_BIRTH_DATE: 'La fecha de nacimiento no es válida.',
  CONSENT_REQUIRED: 'Confirma que el aspirante aceptó el aviso de privacidad.',
  EMAIL_EXISTS: 'Ya existe un registro con ese correo.',
  TOO_MANY_ROWS: 'El archivo tiene demasiadas filas. Divídelo en partes más pequeñas.',
  INVALID_CODE: 'El código solo puede tener letras, números, guiones y guion bajo (2 a 40).',
  CODE_EXISTS: 'Ya existe un elemento con ese código.',
  INVALID_DIVISION: 'Elige una división válida.',
  ACTIVITY_EXISTS: 'Ya existe un taller con ese nombre en la división.',
  SESSION_EXISTS: 'Ese taller ya tiene un horario a esa hora.',
  INVALID_TIMES: 'La hora de fin debe ser posterior a la de inicio.',
  INVALID_CAPACITY: 'El cupo debe estar entre 1 y 2000.',
  HAS_ATTENDANCES: 'No se puede borrar porque ya tiene asistencias registradas.',
  REASON_REQUIRED_SHORT: 'Escribe el motivo (al menos 5 caracteres).',
  INVALID_ROLES: 'Elige al menos un rol.',
  CANNOT_DEACTIVATE_SELF: 'No puedes desactivar tu propia cuenta.',
  LAST_COORDINATOR: 'Debe quedar al menos una cuenta de Coordinación activa.',
  PRIVACY_NOTICE_REQUIRED: 'Primero acepta el Aviso de Privacidad para continuar.',
  INVALID_SESSION_STATUS: 'Elige un estado válido para el horario.',
  CSV_EMPTY: 'El archivo no tiene filas.',
  CSV_UNREADABLE: 'No se pudo leer el archivo. Verifica que sea un CSV.',
};

const GENERIC = 'Algo salió mal. Inténtalo de nuevo.';

export function friendlyError(cause: unknown): string {
  console.error(cause);
  const raw =
    typeof cause === 'string'
      ? cause
      : cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message: unknown }).message)
        : '';
  return MESSAGES[raw] ?? GENERIC;
}
