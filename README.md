# DiaOV2.0

Plataforma del Día de Orientación Vocacional de la Universidad Anáhuac Cancún (React + Vite + TypeScript + Tailwind + Supabase).

## Padrón oficial de aspirantes

Forms solo alimenta la plataforma **antes del corte**. Después, la plataforma es la fuente de verdad del evento.

1. **Preparación** (`editions.roster_status = 'preparacion'`): Coordinación carga el CSV de Forms desde *Padrón oficial*, revisa la vista previa y puede volver a cargarlo las veces necesarias. Una recarga reconoce a los aspirantes por correo (o correo anterior), no los duplica y respeta las correcciones manuales.
2. **Carreras no reconocidas**: la vista previa agrupa cada valor distinto (sin importar mayúsculas, acentos o espacios). Coordinación lo relaciona una sola vez con una carrera oficial activa o con "Sin carrera". La carga se bloquea (`UNRESOLVED_CAREERS`) hasta resolverlos todos. El texto original se guarda en `participants.initial_career_raw`, se muestra en el expediente y se exporta. Cada mapeo queda auditado (`participants.career_mapped`).
3. **Columnas adicionales**: las claves se asignan con todo el esquema del CSV (`Pregunta`, `Pregunta (2)`…), aunque haya celdas vacías, así cada respuesta queda siempre en su columna. Las respuestas vacías no se guardan. Solo Coordinación las ve; se incluyen en la exportación.
4. **Declarar padrón oficial** (`declare_official_roster`, solo Coordinación, frase `DECLARAR PADRÓN OFICIAL`, auditado): bloquea en el servidor cualquier vista previa o carga del CSV (`ROSTER_OFFICIAL`), incluso llamando directo a la función.
5. **Reapertura excepcional** (`reopen_roster_import`, solo Coordinación): exige motivo (mínimo 10 caracteres) y la frase `REABRIR IMPORTACIÓN`; queda auditada con quién, cuándo y por qué (`roster.reopened`).

## Alta presencial

Staff y Coordinación registran a quien llega el mismo día (`create_participant_manual`, origen `manual`). Funciona **sin importar el estado del padrón**. Son obligatorios: nombre completo, correo, fecha de nacimiento, teléfono, preparatoria, carrera de interés (solo del catálogo oficial activo) y consentimiento presencial. El formulario está preparado para sumar campos después sin cambiar el flujo.

## Regla para operaciones privadas del aspirante

`my_progress()` puede leerse antes de aceptar el aviso de privacidad, a propósito, para mostrar la bienvenida. **Toda operación privada futura** (reservaciones, cambios de ruta, check-in) debe empezar con `require_participant(true)`, que exige el aviso aceptado.

## Seguridad

- Toda escritura pasa por funciones `SECURITY DEFINER` con `search_path` fijo, sin permiso para `anon`.
- Las funciones internas (`process_participant_import`, `write_audit`, `fold_text`, `require_participant`, etc.) no son ejecutables desde la API.

## Pruebas de regresión

`supabase/tests/regression_correcciones.sql` se ejecuta completo como un solo bloque. Siempre termina con un error que trae los resultados, así que **todos los cambios se revierten**. Cubre roles, carga y recarga del CSV, columnas adicionales, mapeo de carreras, padrón oficial y reapertura, alta presencial, exportación, aviso de privacidad y sesiones.
