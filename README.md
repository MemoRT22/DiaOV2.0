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

## Bootstrap operacional

### Edición activa

La migración `20261005003000_bootstrap_edition_and_coordinator` crea la edición "Día OV 2026" (`code = 'DIAOV2026'`) en modo `preparacion`, siembra las 6 categorías de sorteo (Baja, Media, Mayor en real y demo) y deja los rangos vacíos para que Coordinación los configure desde la interfaz.

### Primer Coordinador

No existe ningún usuario de Auth ni personal administrativo al inicio. El primer Coordinador se crea con este procedimiento de una sola vez:

1. En Supabase Dashboard → Authentication → Users → Add user. Crear un usuario con correo y contraseña elegidos (las credenciales nunca se guardan en el repositorio).
2. Copiar el UUID del usuario creado.
3. En Supabase Dashboard → SQL Editor, ejecutar:

   ```sql
   SELECT bootstrap_first_coordinator('<uuid>', 'Nombre Completo');
   ```

4. A partir de ese momento, el panel de administración funciona. El resto del personal se crea desde la aplicación vía `staff-accounts`.

La función `bootstrap_first_coordinator` no tiene permisos para ningún rol (`PUBLIC`, `anon`, `authenticated`): se ejecuta exclusivamente desde SQL Editor con privilegios administrativos. Cualquier segundo intento devuelve `ALREADY_BOOTSTRAPPED`.

### Edge Functions

- `student-access`: acceso del aspirante por correo + fecha de nacimiento. `verify_jwt = false` (valida identidad internamente).
- `staff-accounts`: administración de personal. `verify_jwt = true` (requiere sesión de Coordinación).
- `service_role` nunca llega al frontend.

### Aviso de privacidad

La edición tiene `privacy_notice_version = 'v1'` con contenido pendiente. Antes de activar `operacion_real`, el aviso definitivo es un requisito de preparación que se revisa aparte.

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
- La tabla `reservations` no tiene permisos para `anon` ni `authenticated` (RLS sigue activo como defensa en profundidad). El aspirante solo lee mediante `my_reservation_board()` (exige aviso aceptado) y Coordinación mediante `session_reservation_counts()`, que solo devuelve conteos.

## Pruebas de regresión

`supabase/tests/regression_correcciones.sql` se ejecuta completo como un solo bloque. Siempre termina con un error que trae los resultados, así que **todos los cambios se revierten**. Cubre roles, carga y recarga del CSV, columnas adicionales, mapeo de carreras, padrón oficial y reapertura, alta presencial, exportación, aviso de privacidad y sesiones.

`supabase/tests/regression_reservaciones.sql` funciona igual (todo se revierte) y cubre autorización, ventana, cupo, duplicados, choques y traslado, límite, tiempo, cambios atómicos, cierre, ediciones administrativas, sesiones ocultas y canceladas, lectura directa bloqueada para todos los roles, aislamiento y sellos.

`supabase/tests/concurrency_reservations.mjs` lanza clientes reales simultáneos (solo con la clave pública) contra las funciones de reservación. Pasos:

1. Ejecutar `supabase/tests/concurrency_fixture_setup.sql` (SQL editor). Crea solo aspirantes demo `cc.01`…`cc.30` y `cc.max@test.invalid` y talleres/sesiones demo `CC …`, guarda la configuración de reservaciones vigente y abre la ventana. Se niega a correr si ya hay datos CC.
2. `node supabase/tests/concurrency_reservations.mjs`
3. Ejecutar `supabase/tests/concurrency_fixture_cleanup.sql`. Borra solo esos datos (incluye sus usuarios de acceso, intentos de acceso y reservaciones) y restaura la configuración guardada. Puede repetirse sin efecto.

## Check-in (asistencia con QR y código manual)

- Al final de cada taller, el facilitador muestra un QR y un código manual de 6 letras. El aspirante escanea o escribe el código desde su Pasaporte; el servidor valida identidad, Aviso, credencial, sesión, ventana de tiempo, reservación y duplicados en una sola transacción.
- La credencial de cada sesión es impredecible y se guarda cifrada (pgcrypto `pgp_sym_encrypt`). La clave de cifrado vive en Supabase Vault (`diaov_checkin_credential_key`), se generó dentro de la base de datos y no está en el repositorio ni llega al frontend; solo la lee la función interna `credential_encryption_key()` (sin permisos para anon/authenticated). La clave literal de migraciones anteriores se considera comprometida y ya no se usa: las credenciales existentes se volvieron a cifrar con la clave de Vault.
- El token QR (32 bytes) y el código manual (6 caracteres) se generan con `gen_random_bytes`. Ambos hashes son UNIQUE en base de datos; si un código nuevo choca con uno existente, se reintenta con valores nuevos (máximo 10, si no `CREDENTIAL_GENERATION_FAILED`).
- Nadie lee la tabla de credenciales directamente; solo Coordinación y Staff pueden mostrarla mediante una función auditada. Regenerar la credencial invalida la anterior (QR y código) al instante.
- El método de la asistencia (`qr` o `codigo_manual`) lo infiere el servidor según la credencial que coincidió; el navegador no lo envía. Se guarda en la asistencia y en la auditoría, y un reintento posterior no lo cambia.
- La respuesta del check-in incluye el rango actual calculado por `participant_rank_level()`, la misma función que usa el Pasaporte.
- La ventana de check-in se configura por edición: abre N minutos antes del final (default 5) y cierra M minutos después (default 20). Siempre usa la hora del servidor.
- Una asistencia por persona y sesión, con un snapshot de los créditos otorgados. Los rangos avanzan por sellos acumulados (suma de créditos), no por número de asistencias. El recordatorio de intereses sigue basado en talleres asistidos.
- Sesión oculta con reservación sigue permitiendo check-in. Sesión cancelada no valida. Reactivar no revive asistencias.
- `attendances` y `session_credentials` no tienen permisos para anon ni authenticated (RLS como defensa en profundidad).
- Coordinación y Staff tienen un módulo "Check-in" con lista de sesiones, conteos, QR en pantalla completa, vista imprimible y regeneración (solo Coordinación). Sorteo no tiene acceso.

`supabase/tests/regression_asistencia.sql` funciona igual que las demás (todo se revierte) y cubre autorización, clave en Vault, credenciales válidas e inválidas, método real QR/código (primer check-in e idempotencia), rango, regeneración (QR y código anteriores fallan), unicidad y reintento por colisión, reservación vigente/cambiada/cancelada por sesión y reactivación, sesión oculta, ventana temprana y tardía, idempotencia, créditos/snapshot, progreso y seguridad de datos.

`supabase/tests/concurrency_checkin.mjs` lanza 20 requests simultáneos del mismo aspirante mezclando QR y código. Verifica una sola asistencia nueva, 19 idempotentes, créditos una sola vez y que el método reportado sea el de la credencial que ganó la carrera. Pasos:

1. Ejecutar `supabase/tests/concurrency_checkin_setup.sql` (SQL editor).
2. Obtener credenciales de la BD y exportarlas: `QR_TOKEN=... MANUAL_CODE=... node supabase/tests/concurrency_checkin.mjs`.
3. Confirmar en la BD que hay 1 asistencia con el `WINNER_METHOD` impreso (query en el encabezado del script).
4. Ejecutar `supabase/tests/concurrency_checkin_cleanup.sql`.
