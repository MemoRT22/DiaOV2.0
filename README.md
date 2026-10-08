# DiaOV2.0

Plataforma del Día de Orientación Vocacional de la Universidad Anáhuac Cancún (React + Vite + TypeScript + Tailwind + Supabase).

## Importación de aspirantes

Coordinación puede repetir la carga del CSV de Forms durante la preparación y la operación, incluso si `editions.roster_status = 'oficial'`. La pantalla está en *Participantes → Importar*. `roster_status` sigue existiendo para otros contratos, pero no bloquea `preview_participant_import` ni `commit_participant_import` tras aplicar la migración `allow_official_participant_import` de Fase 6B.

1. **Conciliación**: una recarga reconoce a los aspirantes por correo (o correo anterior), no los duplica y respeta las correcciones manuales: un dato corregido a mano nunca se reemplaza en silencio, queda como registro por revisar (`1,842 actualizados · 17 nuevos · 3 requieren revisión`) y se resuelve ahí mismo o en el expediente del participante (`list_import_conflicts` / `resolve_import_conflict`, auditado).
2. **Carreras no reconocidas**: la vista previa agrupa cada valor distinto (sin importar mayúsculas, acentos o espacios). Coordinación lo relaciona una sola vez con una carrera oficial activa o con "Sin carrera". La carga se bloquea (`UNRESOLVED_CAREERS`) hasta resolverlos todos. El texto original se guarda en `participants.initial_career_raw`, se muestra en el expediente y se exporta. Cada mapeo queda auditado (`participants.career_mapped`).
3. **Preparatorias no reconocidas**: la vista previa agrupa solo coincidencias normalizadas exactas contra `high_schools` (sin fuzzy matching). Coordinación las relaciona con una preparatoria activa o la agrega en *Configuración → Catálogos académicos → Preparatorias* y vuelve a generar la vista previa. Commit se bloquea con `UNRESOLVED_HIGH_SCHOOLS` mientras haya pendientes. El participante guarda `high_school_id` y el nombre canónico en `high_school` para compatibilidad.
4. **Columnas adicionales**: las claves se asignan con todo el esquema del CSV (`Pregunta`, `Pregunta (2)`…), aunque haya celdas vacías, así cada respuesta queda siempre en su columna. Las respuestas vacías no se guardan. Solo Coordinación las ve; se incluyen en la exportación.
5. **Estado heredado**: la UI actual no ofrece Declarar padrón oficial ni Reabrir importación. Esas RPC heredadas permanecen en backend; esta fase solo elimina el bloqueo del procesamiento del CSV.

## Catálogos académicos

Configuración reúne tres pestañas: Divisiones, Carreras y Preparatorias. Coordinación puede buscar, crear, renombrar, activar y desactivar preparatorias; las ya usadas se conservan por ID y nunca se borran desde la aplicación. El nombre es único bajo `fold_text`, que ignora diferencias de mayúsculas, acentos y espacios. `Otra escuela` es una opción oficial, sin campo libre adicional. El autorregistro obtiene las carreras y las preparatorias activas en un solo snapshot de `student-access → catalog` y envía solo `high_school_id`. El backend valida que exista y esté activo. Preparation Reset no modifica este catálogo maestro.

## Acceso de participantes (correo → contraseña)

La pantalla pública pide solo el **correo**. El sistema decide el paso (`student-access` → `identify`, que devuelve únicamente `password_login`, `password_setup` o `self_registration`, nunca datos personales):

| Estado | Qué ve la persona |
|---|---|
| `password_login` | Correo + contraseña con Supabase Auth (`signInWithPassword`). Un error muestra «Correo o contraseña incorrectos.» |
| `password_setup` | «Encontramos tu prerregistro»: crea y confirma una contraseña. La función crea la identidad de Auth con el **correo real** (`app_metadata.kind = 'participant'`, correo confirmado administrativamente), la vincula en `participants.auth_user_id` y el navegador inicia sesión. |
| `self_registration` | «No encontramos un prerregistro con este correo. Puedes registrarte ahora.»: formulario con los campos del Forms (Nombre, Apellidos, Correo, Teléfono con WhatsApp, Escuela/preparatoria, Grado, Periodo de interés, Licenciatura, Contraseña) y el Aviso de Privacidad como casilla obligatoria. |

- **Contraseñas**: viven solo en Supabase Auth (8 a 72 caracteres). Nunca se guardan en tablas públicas, ni se registran ni se auditan. No hay fecha de nacimiento, OTP, enlaces mágicos, códigos por correo, preguntas de seguridad ni recuperación por correo: quien no recuerda su contraseña pide apoyo al personal.
- **Autorregistro** (`origin = 'self_service'`): `student-access` → `register` valida en SQL (`register_self_service_internal`) y crea participante, perfil, interés inicial y consentimiento en una transacción; después crea la identidad de Auth y la vincula. Si Auth falla se descarta el registro a medias (`discard_self_service_registration_internal`); si el descarte falla, el correo aparece como prerregistro sin contraseña y la persona puede terminarlo. El consentimiento queda como `platform_consent_source = 'self_service'` con versión y fecha del aviso de la edición, por lo que no repite `/bienvenida`; la evidencia de Forms (`forms_consent`) sigue separada.
- **Grado** (`high_school_grade`: `1`, `2`, `3`, `graduado`) y **periodo** (`entry_period`: `2027-01`, `2027-08`, `2028-01`, `2028-08`) son campos estructurales (importación, autorregistro, expediente, exportación). Solo se guarda `full_name`: Nombre y Apellidos se unen al importar o registrarse.
- **Importar un padrón oficial** después de un autorregistro con el mismo correo concilia al participante (no duplica, no toca `auth_user_id` ni la contraseña). Las columnas del Forms: Nombre, Apellidos, Correo, Teléfono con WhatsApp, Escuela, Grado, Periodo, Licenciatura; aviso de privacidad y marca temporal opcionales. Una columna de fecha de nacimiento se ignora.
- **Restablecer contraseña** (expediente, Staff y Coordinación): `participant-admin` (`verify_jwt = true`, valida el rol) genera una contraseña en el servidor (o aplica la que se escriba), la actualiza en Auth y la muestra una sola vez al operador. La auditoría (`participant.password_reset`) guarda solo quién, a quién y cuándo, y se escribe antes del cambio (falla cerrado). También crea la cuenta de quien aún no la tiene. Nunca modifica una cuenta que no sea de participante.
- Las identidades antiguas (`p.<id>@participantes.diaov.invalid`) se migran al correo real la primera vez que se configura una contraseña. Si Staff corrige el correo de un participante, `identify` alinea el correo de Auth antes del siguiente inicio de sesión.
- **Reinicio de preparación**: encuentra las identidades de participantes por `participants.auth_user_id` (correo real o sintético, `kind = 'participant'`), nunca toca cuentas de Staff.

### Estado de despliegue

El acceso nuevo está completamente desplegado. Las migraciones EXPAND `20261006191413_participant_password_access_expand` y `20261006192044_participant_import_conflict_fields` están aplicadas; el frontend de correo + contraseña/autorregistro está publicado; `student-access` ya no contiene `legacy.ts`; y el CONTRACT `20261006212716_participant_password_access_contract` retiró `participants.birth_date`, `access_attempts`, `access_lock_state`, `clear_access_lock`, `create_participant_manual` y las claves de compatibilidad antiguas.

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

- `student-access`: acceso de participantes por correo + contraseña y autorregistro (ver «Acceso de participantes»). `verify_jwt = false` (es la puerta pública; valida todo el input y orquesta Auth con `service_role` solo en el servidor).
- `participant-admin`: restablecer la contraseña de un participante. `verify_jwt = true` (sesión Staff/Coordinación, rol validado dentro).
- `staff-accounts`: administración de personal. `verify_jwt = true` (requiere sesión de Coordinación).
- `service_role` nunca llega al frontend.

### Aviso de privacidad

La edición activa usa `privacy_notice_version = 'v1'` y el Aviso de Privacidad oficial de Anáhuac Cancún configurado en `privacy_notice_url`: `https://www.anahuac.mx/cancun/aviso-de-privacidad`.

## Seguridad

- Toda escritura pasa por funciones `SECURITY DEFINER` con `search_path` fijo, sin permiso para `anon`.
- Las funciones internas (`process_participant_import`, `write_audit`, `fold_text`, `require_participant`, etc.) no son ejecutables desde la API.

## Reservaciones (Mi Ruta)

- La base de datos es la única fuente de verdad. Reservar, cambiar y cancelar se hacen con `reserve_session`, `change_reservation` y `cancel_reservation`; cada una bloquea al aspirante y las sesiones involucradas en orden fijo, cuenta, valida y escribe en la misma transacción. Nunca hay sobrecupo.
- **Recomendador de talleres («Para ti»)**: determinístico y basado en reglas (sin IA, embeddings ni servicios externos). `my_recommended_activities()` parte de `initial_interests` (carreras del prerregistro/autorregistro, con su `preference`; los intereses post-evento no se usan) y de las afinidades que ya salen de la propuesta del tallerista (`workshop_submission_careers` → `activity_careers` al publicar; `activity_divisions` derivada). Nivel 1 `exact_career`: la actividad académica está ligada a una carrera de interés (una sola entrada por taller, con todas las carreras coincidentes en `matched_careers`). Nivel 2 `same_division`: solo si hay menos de 4 exactas nuevas y utilizables, se completan hasta ~4 con talleres de la misma división (`matched_division`); nunca se presentan como coincidencia de carrera. Orden: no asistidas primero → exactas antes que división → preferencia del interés → disponibilidad (en curso con lugares, futura con lugares, ya en tu ruta, sin lugares) → inicio de la próxima sesión → título/id. Las asistidas se devuelven marcadas («Explorado») al final y no cuentan para el mínimo; las ya reservadas vienen con `already_reserved`; los talleres terminados sin reservación/asistencia se omiten. Misma edición e `is_demo`; solo `activity_type = 'academica'`. Una actividad creada a mano sin `activity_careers` no se recomienda por afinidad exacta hasta configurarlas. El motor solo describe y ordena: nunca crea ni cambia reservaciones (el tablero sigue siendo la autoridad de lo reservable).
- La apertura y el cierre de reservaciones se guardan en la edición. El RPC `update_reservation_settings` se conserva temporalmente para esa operación, aunque su antigua pantalla de Configuración está retirada. Las demás reglas son del sistema: máximo 4 talleres activos por defecto, sin empalmes reales, traslado recomendado de 10 minutos que solo advierte, cambio atómico y cupo nunca excedido. El RPC rechaza cambios a estas reglas técnicas (`SYSTEM_MANAGED_SETTING`).
- Tras el cierre solo se puede cancelar (mientras la sesión no termine). Una sesión en curso sigue aceptando reservaciones y se puede cancelar o cambiar mientras no haya terminado ni tenga asistencia; una sesión terminada ya no se reserva, cambia ni cancela.
- Solo el **solapamiento real** de horarios bloquea (`SCHEDULE_CONFLICT`). Las sesiones consecutivas o con menos de `travel_buffer_minutes` entre sí se permiten; `my_reservation_board()` las marca en `tight_transfer_with` (advertencia «Traslado ajustado», nunca bloqueo) y los solapamientos reales en `conflicts_with`.
- Un mismo taller sigue ocupado hasta que termina su sesión; después, sin asistencia, se puede reservar otro horario y la reservación anterior pasa a `expirada` (historial). Errores nuevos: `SESSION_ENDED`, `CURRENT_SESSION_ENDED`, `ALREADY_ATTENDED` (cancelar/cambiar con asistencia).
- Con reservaciones vigentes no se mueven horarios ni se baja el cupo por debajo de lo reservado; la ubicación solo cambia con la operación explícita de Coordinación (con motivo y auditoría).
- Cancelar una sesión marca sus reservaciones como `cancelada_sesion`; reactivarla no las revive. Ocultarla conserva las existentes.
- La disponibilidad en vivo usa un canal privado por edición que solo emite conteos; la app funciona igual si no hay conexión en vivo.
- La tabla `reservations` no tiene permisos para `anon` ni `authenticated` (RLS sigue activo como defensa en profundidad). El aspirante solo lee mediante `my_reservation_board()` (exige aviso aceptado); Operación obtiene los conteos agregados desde `event_operations_overview()`.

## Centro de Operación

Consola temporal y de excepciones para el día del evento (Operación → Centro de Operación). Organiza por momento, atención y búsqueda, no por tablas: **Ahora** (en curso, por empezar en 30 min y atención inmediata), **Próximas** (cronológicas por bloque horario), **Atención** y **Programa completo** (tabla compacta, una fila por sesión; cómoda con más de 100). Búsqueda por taller, lugar o división y filtro de división, que respetan talleres multidivisión. Antes del evento abre en Próximas con indicadores de preparación; el día del evento y mientras haya sesiones cerca, abre en Ahora. Todas las decisiones usan `server_time` (el reloj del navegador solo mide el tiempo transcurrido desde la última lectura).

**Atención** solo incluye situaciones que Coordinación puede resolver: sesión en curso o a ≤60 min de iniciar sin ubicación; cancelada con reservaciones sin alternativa (`affected_unresolved`) y aún por ocurrir; terminada con reservaciones y cero check-ins dentro de la ventana de check-in; próxima a ≤30 min sin reservaciones; reservaciones por encima del cupo. «Lleno» y «Quedan pocos» son demanda, no incidente; una sesión lejana sin ubicación se avisa como tarea de configuración.

**Contrato `event_operations_overview()`** (un solo JSON, sin datos personales; solo Staff/Coordinación): raíz con `server_time`, `mode`, `event_date`, `timezone`, `checkin_close_after_minutes`, `summary` y `sessions`. Cada sesión: `divisions [{id,code,name}]` (relación real `activity_divisions`), `location` (sesión con respaldo del taller; `null` si falta), `capacity`, `reserved` (vigente + expirada), `remaining`, `attended`, `affected_reservations`, `affected_unresolved`. Se calcula con agregaciones agrupadas (sin consulta por fila). Se conservan por compatibilidad, para retirar cuando no queden frontends anteriores: `division_id/division_name/division_code` (primera división; vacío si no hay), `summary.platform_consents` e `is_demo`.

## Producto administrativo (UX-3)

El administrador se entiende con cinco áreas: **Inicio, Participantes, Talleres, Operación y Configuración**. Una capacidad técnica no se convierte en módulo: se integra donde se usa.

| Área | Qué contiene |
|---|---|
| Participantes | Buscar, consultar, importar el padrón (con la revisión de lo que requiere decisión), corregir datos, restablecer contraseñas y exportar. No hay alta manual: los participantes llegan por el Forms oficial o se registran solos. |
| Talleres | Bandeja única de propuestas pendientes, publicadas y descartadas; edición, aprobación/publicación atómica y descarte. |
| Operación | Centro de Operación, Check-in y Sorteo final. |
| Configuración | Personal, Experiencia del alumno y Catálogos académicos / Datos maestros. |

`Mi cuenta` pertenece al perfil (pie de la barra lateral), no al producto.

**Tema.** El tema configurable del Día OV es de la experiencia pública. `EditionProvider` entrega los datos de la edición (fecha, sede, modo, ventanas); `PublicThemeProvider` entrega el tema publicado. Solo `PublicSurface` (portal del alumno y formulario público) lo pinta en el documento; el administrador usa su propio sistema visual fijo (`src/admin/adminTheme.ts`, `AdminSurface`): fondo neutro, superficies claras, naranja Anáhuac como identidad, azul para información/acciones y verde, amarillo y rojo para estados. Los colores de texto de estado usan `text-fg-*`, que cada superficie resuelve con su propio tono legible.

**Rangos.** El nivel depende solo de los sellos acumulados: cada taller completado sube un nivel, hasta cuatro (niveles 1 a 5 con 0, 1, 2, 3 y 4 sellos; `required_divisions = 0`). `seed_default_rank_levels` lo siembra por edición. Las divisiones visitadas no bloquean el progreso: `participant_visited_division_ids` es la única definición de «divisiones distintas» (incluye actividades multidivisión), la usan `my_progress` y `participant_rank_level`, y el Pasaporte las muestra de forma informativa. Ya no hay pantalla ni RPC para editar los requisitos.

**Orden de despliegue de la base.** `20261006170608_admin_simplification_compat` y `20261006172447_rank_rules_by_stamps_only` (corrige los requisitos de rangos) son compatibles con el frontend anterior (se pueden aplicar antes). `20261007010100_admin_simplification_retire` retira backend sin consumidores y debe aplicarse **después** de desplegar este frontend: `access_diagnosis`, `update_rank_rules`, `rank_levels.is_provisional` y el aceptar reglas técnicas en `update_reservation_settings`.

## Pruebas de regresión

La batería vigente está inventariada en [`supabase/tests/README.md`](supabase/tests/README.md). `regression_official_participant_import.sql` usa `BEGIN`/`ROLLBACK` y prueba preview y commit en preparación y oficial, conciliación, alias, overrides, intereses y permisos. `regression_participant_access.sql`, `regression_asistencia.sql`, `regression_student_flexibility.sql`, `regression_recommender.sql` y `regression_sorteo.sql` cubren los contratos actuales. Algunas suites históricas terminan deliberadamente con una excepción `*_OK` que revierte sus fixtures; ese mensaje, con cero fallos, indica éxito.

`supabase/tests/concurrency_reservations.mjs` lanza clientes reales simultáneos (solo con la clave pública) contra las funciones de reservación. Pasos:

1. Usar **solo un proyecto Supabase local/descartable** con Auth, Edge Functions y migraciones actuales. Ejecutar `supabase/tests/concurrency_fixture_setup.sql`; crea aspirantes y sesiones DEMO `cc.*` / `CC …` y guarda la configuración anterior.
2. Ejecutar `CONCURRENCY_TEST_SUPABASE_URL=http://127.0.0.1:54321 CONCURRENCY_TEST_SUPABASE_ANON_KEY=<clave pública local> CONCURRENCY_TEST_PASSWORD=<contraseña DEMO> node supabase/tests/concurrency_reservations.mjs`. Usa `identify`/`setup_password` y `signInWithPassword`; el script rechaza URLs que no sean localhost.
3. Ejecutar `supabase/tests/concurrency_fixture_cleanup.sql` en ese mismo proyecto. Retira solo el fixture CC y restaura la configuración guardada.

## Check-in (asistencia con QR y código manual)

- Cada taller tiene un QR y un código manual de 6 caracteres. El aspirante escanea o escribe el código desde su Pasaporte; el servidor valida identidad, Aviso, credencial de actividad, reservación y duplicados en una transacción.
- La credencial de cada actividad es impredecible y se guarda cifrada (pgcrypto `pgp_sym_encrypt`). La clave de cifrado vive en Supabase Vault (`diaov_checkin_credential_key`), no está en el repositorio ni llega al frontend; solo la lee la función interna `credential_encryption_key()` (sin permisos para anon/authenticated).
- El token QR (32 bytes) y el código manual (6 caracteres) se generan con `gen_random_bytes`. Ambos hashes son UNIQUE en base de datos; si un código nuevo choca con uno existente, se reintenta con valores nuevos (máximo 10, si no `CREDENTIAL_GENERATION_FAILED`).
- Nadie lee la tabla de credenciales directamente; solo Coordinación y Staff pueden mostrarla mediante una función auditada. Regenerar la credencial invalida la anterior (QR y código) al instante.
- El método de la asistencia (`qr` o `codigo_manual`) lo infiere el servidor según la credencial que coincidió; el navegador no lo envía. Se guarda en la asistencia y en la auditoría, y un reintento posterior no lo cambia.
- La respuesta del check-in incluye el rango actual calculado por `participant_rank_level()`, la misma función que usa el Pasaporte.
- El check-in ya no depende de la hora programada: quien dirige el taller decide cuándo muestra el QR. Basta una reservación vigente o expirada (no cancelada) de la actividad, credencial válida y no tener ya asistencia (`CHECKIN_TOO_EARLY` y `CHECKIN_TOO_LATE` fueron retirados). Como la credencial es por actividad, la sesión se elige de forma determinista: en curso, si no la pasada más reciente, si no la futura más cercana. `checkin_open_before_minutes` y `checkin_close_after_minutes` se conservan en la edición pero ya no autorizan; `checkin_close_after_minutes` solo la lee el Centro de Operación.
- Una asistencia por persona y sesión, con un snapshot de los créditos otorgados. Los rangos avanzan por sellos acumulados (suma de créditos), no por número de asistencias. El recordatorio de intereses sigue basado en talleres asistidos.
- Sesión oculta con reservación sigue permitiendo check-in. Sesión cancelada no valida. Reactivar no revive asistencias.
- `attendances` y `activity_credentials` no tienen lectura directa para anon ni authenticated (RLS como defensa en profundidad); `session_credentials` quedó como tabla heredada vacía.
- Coordinación y Staff tienen un módulo "Check-in" con lista de sesiones, conteos, QR en pantalla completa, vista imprimible y regeneración (solo Coordinación). Sorteo no tiene acceso.

`supabase/tests/regression_asistencia.sql` cubre QR, código, idempotencia, permisos, sesión cancelada, progreso y regeneración de credenciales de actividad. `regression_student_flexibility.sql` cubre además tiempos, cambios de ruta, sesiones ocultas y Realtime. Ambas revierten sus fixtures.

`supabase/tests/concurrency_checkin.mjs` lanza 20 requests simultáneos del mismo aspirante mezclando QR y código. Verifica una sola asistencia nueva, 19 idempotentes, créditos una sola vez y que el método reportado sea el de la credencial que ganó la carrera. Pasos:

1. Ejecutar `supabase/tests/concurrency_checkin_setup.sql` solo en el proyecto local/descartable.
2. Obtener la credencial DEMO de `activity_credentials` (consulta en el encabezado del script) y ejecutar el harness con las mismas variables `CONCURRENCY_TEST_SUPABASE_URL`, `CONCURRENCY_TEST_SUPABASE_ANON_KEY` y `CONCURRENCY_TEST_PASSWORD`, además de `QR_TOKEN` y `MANUAL_CODE`.
3. Confirmar en la BD que hay 1 asistencia con el `WINNER_METHOD` impreso (query en el encabezado del script).
4. Ejecutar `supabase/tests/concurrency_checkin_cleanup.sql`.

`supabase/tests/regression_participant_access.sql` funciona igual (todo se revierte, fixtures propios, no ejecuta el reinicio de preparación) y cubre estados de acceso, vinculación de identidades, autorregistro (campos, validaciones, duplicados, compensación, consentimiento), importación con grado y periodo (sin fecha de nacimiento, conciliación con autorregistros), edición administrativa, roles y PII, exportación, auditoría de restablecimiento sin contraseña y la selección de identidades del reinicio (correo real, sintético, nunca Staff). Con la migración de contrato aplicada valida además el retiro (`retired = true`).

Pruebas de las Edge Functions: `node --test supabase/functions/student-access/handler.test.ts supabase/functions/participant-admin/handler.test.ts`.
