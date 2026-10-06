# DiaOV2.0

Plataforma del Día de Orientación Vocacional de la Universidad Anáhuac Cancún (React + Vite + TypeScript + Tailwind + Supabase).

## Padrón oficial de aspirantes

Forms solo alimenta la plataforma **antes del corte**. Después, la plataforma es la fuente de verdad del evento.

1. **Preparación** (`editions.roster_status = 'preparacion'`): Coordinación carga el CSV de Forms desde *Participantes → Importar padrón*, revisa la vista previa y puede volver a cargarlo las veces necesarias. Una recarga reconoce a los aspirantes por correo (o correo anterior), no los duplica y respeta las correcciones manuales: un dato corregido a mano nunca se reemplaza en silencio, queda como registro por revisar (`1,842 actualizados · 17 nuevos · 3 requieren revisión`) y se resuelve ahí mismo o en el expediente del participante (`list_import_conflicts` / `resolve_import_conflict`, auditado).
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

La migración `20261005003000_bootstrap_edition_and_coordinator` crea la edición "Día OV 2026" (`code = 'DIAOV2026'`) en modo `preparacion`, siembra las 6 categorías de sorteo (Baja, Media, Mayor en real y demo) y los 5 niveles de progreso con los requisitos del producto (ver «Producto administrativo»). Las ediciones nuevas reciben esos niveles automáticamente.

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
- Coordinación solo decide **cuándo abren y cierran** las reservaciones (Configuración → Reservaciones). El resto son reglas del sistema con valores por defecto en la edición (máximo 4 talleres activos, traslado mínimo de 10 minutos, check-in desde 5 minutos antes hasta 20 después de que termina la sesión, sin empalmes, cambio atómico, cupo nunca excedido); `update_reservation_settings` rechaza cualquier intento de cambiarlas (`SYSTEM_MANAGED_SETTING`).
- Tras el cierre solo se puede cancelar (antes de que la sesión inicie). Una sesión iniciada ya no se reserva, cambia ni cancela.
- Con reservaciones vigentes no se mueven horarios ni se baja el cupo por debajo de lo reservado; la ubicación solo cambia con la operación explícita de Coordinación (con motivo y auditoría).
- Cancelar una sesión marca sus reservaciones como `cancelada_sesion`; reactivarla no las revive. Ocultarla conserva las existentes.
- La disponibilidad en vivo usa un canal privado por edición que solo emite conteos; la app funciona igual si no hay conexión en vivo.
- La tabla `reservations` no tiene permisos para `anon` ni `authenticated` (RLS sigue activo como defensa en profundidad). El aspirante solo lee mediante `my_reservation_board()` (exige aviso aceptado) y Coordinación mediante `session_reservation_counts()`, que solo devuelve conteos.

## Producto administrativo (UX-3)

El administrador se entiende con cinco áreas: **Inicio, Participantes, Talleres, Operación y Configuración**. Una capacidad técnica no se convierte en módulo: se integra donde se usa.

| Área | Qué contiene |
|---|---|
| Participantes | Buscar, consultar, dar de alta, importar el padrón (con la revisión de lo que requiere decisión), corregir, diagnosticar acceso y exportar. |
| Talleres | Propuestas (revisión y publicación) y Programa publicado. |
| Operación | Centro de Operación, Check-in y Sorteo final. |
| Configuración | Personal, Experiencia pública (temática), Reservaciones (apertura y cierre), Preparación y puesta en marcha, Carreras y divisiones y Auditoría. |

`Mi cuenta` pertenece al perfil (pie de la barra lateral), no al producto.

**Tema.** El tema configurable del Día OV es de la experiencia pública. `EditionProvider` entrega los datos de la edición (fecha, sede, modo, ventanas); `PublicThemeProvider` entrega el tema publicado. Solo `PublicSurface` (portal del alumno y formulario público) lo pinta en el documento; el administrador usa su propio sistema visual fijo (`src/admin/adminTheme.ts`, `AdminSurface`): fondo neutro, superficies claras, naranja Anáhuac como identidad, azul para información/acciones y verde, amarillo y rojo para estados. Los colores de texto de estado usan `text-fg-*`, que cada superficie resuelve con su propio tono legible.

**Rangos.** El nivel depende solo de los sellos acumulados: cada taller completado sube un nivel, hasta cuatro (niveles 1 a 5 con 0, 1, 2, 3 y 4 sellos; `required_divisions = 0`). `seed_default_rank_levels` lo siembra por edición. Las divisiones visitadas no bloquean el progreso: `participant_visited_division_ids` es la única definición de «divisiones distintas» (incluye actividades multidivisión), la usan `my_progress` y `participant_rank_level`, y el Pasaporte las muestra de forma informativa. Ya no hay pantalla ni RPC para editar los requisitos.

**Orden de despliegue de la base.** `20261006170608_admin_simplification_compat` y `20261006172447_rank_rules_by_stamps_only` (corrige los requisitos de rangos) son compatibles con el frontend anterior (se pueden aplicar antes). `20261007010100_admin_simplification_retire` retira backend sin consumidores y debe aplicarse **después** de desplegar este frontend: `access_diagnosis`, `update_rank_rules`, `rank_levels.is_provisional` y el aceptar reglas técnicas en `update_reservation_settings`.

## Pruebas de regresión

`supabase/tests/regression_correcciones.sql` se ejecuta completo como un solo bloque. Siempre termina con un error que trae los resultados, así que **todos los cambios se revierten**. Cubre roles, carga y recarga del CSV, columnas adicionales, mapeo de carreras, padrón oficial y reapertura, alta presencial, exportación, aviso de privacidad y sesiones.

`supabase/tests/regression_admin_simplification.sql` funciona igual (todo se revierte, fixtures propios) y cubre las reglas de rangos del producto, el conteo de divisiones del progreso, el diagnóstico de acceso desde Participantes, la resolución de conflictos de importación (incluido el flujo importar → conflicto → revisar) y el contrato de reservaciones.

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
- La ventana de check-in la define el sistema: abre 5 minutos antes del final y cierra 20 minutos después (columnas de la edición, ya no editables desde la interfaz). Siempre usa la hora del servidor.
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
