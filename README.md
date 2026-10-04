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

## Reservaciones (Mi Ruta)

- La base de datos es la única fuente de verdad. Reservar, cambiar y cancelar se hacen con `reserve_session`, `change_reservation` y `cancel_reservation`; cada una bloquea al aspirante y las sesiones involucradas en orden fijo, cuenta, valida y escribe en la misma transacción. Nunca hay sobrecupo.
- Reglas por edición (Coordinación → Reservaciones): apertura, cierre opcional, máximo por aspirante y minutos de traslado entre sesiones.
- Tras el cierre solo se puede cancelar (antes de que la sesión inicie). Una sesión iniciada ya no se reserva, cambia ni cancela.
- Con reservaciones vigentes no se mueven horarios ni se baja el cupo por debajo de lo reservado; la ubicación solo cambia con la operación explícita de Coordinación (con motivo y auditoría).
- Cancelar una sesión marca sus reservaciones como `cancelada_sesion`; reactivarla no las revive. Ocultarla conserva las existentes.
- La disponibilidad en vivo usa un canal privado por edición que solo emite conteos; la app funciona igual si no hay conexión en vivo.

## Pruebas de regresión

`supabase/tests/regression_correcciones.sql` se ejecuta completo como un solo bloque. Siempre termina con un error que trae los resultados, así que **todos los cambios se revierten**. Cubre roles, carga y recarga del CSV, columnas adicionales, mapeo de carreras, padrón oficial y reapertura, alta presencial, exportación, aviso de privacidad y sesiones.

`supabase/tests/regression_reservaciones.sql` funciona igual (todo se revierte) y cubre autorización, ventana, cupo, duplicados, choques y traslado, límite, tiempo, cambios atómicos, cierre, ediciones administrativas, sesiones ocultas y canceladas, aislamiento y sellos.

`supabase/tests/concurrency_reservations.mjs` lanza clientes reales simultáneos (solo con la clave pública) contra las funciones de reservación. Requiere datos de prueba previos: aspirantes demo `cc.01`…`cc.30` y `cc.max` (fecha 2008-03-03, aviso aceptado), sesiones demo con títulos `CC LAST` (cupo 1), `CC K5` (5), `CC SRC` (40), `CC TGT` (1) y `CC M1`…`CC M8`, y la ventana abierta. Al terminar hay que borrar esos datos y restaurar la ventana.
