# Auditoría de arquitectura backend — superficie RPC de Día OV

> Solo análisis. No se modificó código, no se crearon migraciones, no se aplicó SQL, no se desplegaron funciones, no se cambiaron grants.
> Base: `main` @ `e1f66e0` + inventario en vivo del proyecto `spoeehpziokmknecwcbd` (solo consultas de lectura) · 2026-10-05.
> Fase 9 (Portal de Talleristas) queda pausada; ver §1.5 sobre lo que ya está desplegado.

---

## 0. Resumen ejecutivo

1. **El diagnóstico es correcto, pero el matiz importa.** El backend es un "DB-as-API": las tablas de negocio no tienen privilegios para `anon`/`authenticated` y toda la lectura/escritura pasa por 73 funciones `SECURITY DEFINER` que autorizan al inicio con helpers centralizados (`require_*`). Eso es un diseño coherente y, en lo transaccional, correcto. Lo que **falta** no es "menos RPC": es una **capa HTTP de aplicación** (límites de payload, rate limiting, auditoría de lecturas de PII, descarga de archivos, orquestación, timeouts, observabilidad) para los workflows administrativos.
2. **Clasificación de las 73 RPC ejecutables por `authenticated`:** A = 20 (15 RPC de aplicación + 5 helpers que las policies necesitan), B = 34, C = 8, D = 4, E = 7.
3. **Superficie pública estimada tras la limpieza: ~21–27 RPC** (hoy 73; −63 % a −71 %). Escrituras privilegiadas de Staff/Coordinación expuestas al navegador: de 32 a 4 (solo el sorteo en vivo). Edge Functions: de 2 a **8–9** servicios agrupados (no 73).
4. **Hallazgo técnico clave (cambia la estrategia):** todas las funciones SQL toman la identidad de `auth.uid()`. Una Edge Function que use `service_role` verá `auth.uid() = NULL`; por eso "crear Edge + revocar RPC" **no funciona sin un rediseño de identidad**. Propongo el patrón **extraer-y-envolver** (lógica a una función interna con `p_actor` explícito; la RPC pública pasa a ser un wrapper de una línea) — conserva las reglas en SQL (una sola fuente de verdad) y permite strangler sin big-bang. Ver §8.
5. **Calendario:** el evento es el **2026-10-15 (en 10 días)**, el sistema está en `preparacion`, hay 0 cuentas Staff reales, 3 participantes demo y 0 importaciones. Recomiendo **no migrar ningún flujo del día del evento ni las importaciones necesarias antes del evento**; el único trabajo pre-evento defendible es el "Bloque 0" (higiene de privilegios, pruebas de caracterización, cliente tipado) — todo sin cambio de comportamiento. Ver §9.
6. **Hallazgos de seguridad principales:** (a) privilegios de tabla excesivos (`TRUNCATE`/`REFERENCES`/`TRIGGER` para `anon` y `authenticated` en 12 tablas, y DML completo en `participant_email_history`), protegidos hoy solo porque PostgREST no expone `TRUNCATE` y por RLS; (b) las pruebas de regresión corren contra el proyecto de producción; (c) 27 RPC de aplicación (sin contar helpers) no tienen ninguna prueba SQL; (d) sin throttling en `check_in` (códigos manuales de 30 bits con oráculo de validez); (e) las dos Edge Functions actuales duplican autorización en TS y hacen escrituras multi-paso no transaccionales.

---

## 1. Diagnóstico del estado actual

### 1.1 Cifras verificadas (Supabase, hoy)

| Métrica | Tu inventario | Hoy (verificado) | Diferencia |
|---|---|---|---|
| Funciones en `public` (sin las de extensiones) | 119 | **124** | +5 (todas de `workshop-intake`, ver §1.5) |
| Ejecutables por `authenticated` | 73 | 74 (73 RPC + 1 trigger fn) | +1 trigger fn con `PUBLIC` EXECUTE (error mío, §5.2) |
| Ejecutables por `anon` | 0 | 1 (la misma trigger fn) | idem |
| `SECURITY DEFINER` | 111 | 114 | +3 (create/catalog/require_career) |
| Sin `search_path` fijo (SD) | — | **0** | bien |
| Sobrecargas (mismo nombre) | — | 0 | bien |
| Tablas en `public` | — | 28, **todas con RLS** | bien |
| Vistas | — | 0 | — |
| Edge Functions | 2 | 3 | `workshop-intake` (v1) |
| Extensiones | — | plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault | — |

Roles: `anon` statement_timeout 3 s, `authenticated` 8 s, `authenticator` 8 s (+ `lock_timeout` 8 s), `service_role` sin timeout de rol.

### 1.2 Cómo está construido realmente

```
React ──supabase.rpc()──► PostgREST ──► función SECURITY DEFINER ──► tablas SIN grants para clientes
        (helper genérico src/lib/adminApi.ts: rpc<T>(name, args))
React ──.from()──► PostgREST ──► RLS ──► 10 tablas de lectura simple
React ──fetch──► Edge: student-access (login), staff-accounts (cuentas Staff)
React ──Realtime (canal privado availability:<edition>, policy con helpers)
```

- **Autorización**: centralizada en SQL (`require_participant`, `require_operativo`, `require_coordinacion`, `require_sorteo_or_coordinacion`, `is_*`, `has_staff_role`). Revisé los guards de las 73 en el cuerpo de cada función: todas autorizan al inicio o delegan en una función que lo hace (los 3 wrappers legacy `session_*`/`regenerate_session_credential`). **No encontré ninguna función ejecutable sin guard.** Pero es una convención manual, sin lint que impida olvidarla (§5.6).
- **Tablas sin privilegios** para `anon`/`authenticated`: `participants`, `reservations`, `attendances`, `initial_interests`, `activity_credentials`, `raffle_*`, `import_batches`, `participant_import_conflicts`, `access_attempts`, `session_credentials`, `workshop_*`. Las policies de `reservations`/`attendances`/`initial_interests` existen pero están **inertes** (no hay GRANT); la intención de "denegar lectura directa" está confirmada por pruebas (`regression_reservaciones`: "lectura directa… permission denied"). Es una defensa doble válida, pero conviene documentarla.
- **Lecturas directas con RLS desde el frontend** (aceptables): `editions`, `divisions`, `careers`, `activities`(+`activity_sessions`), `activity_careers`, `rank_levels`, `theme_versions`, `participant_profiles`, `staff_members`, `audit_log`.
- **Por qué SECURITY DEFINER es mayoritariamente necesario hoy:** (1) las tablas no tienen grants, así que cualquier lectura/escritura de negocio exige definer; (2) `is_*`/`has_staff_role` leen `staff_roles`, que a su vez tiene policies que los llaman → sin definer habría recursión de RLS; (3) la capacidad/concurrencia (`reserve_session`) necesita locks y escritura en tablas restringidas. Solo `active_edition_id()` y `theme_is_locked()` podrían ser `INVOKER` (leen `editions`, de lectura pública) — beneficio marginal.

### 1.3 Dónde sí hay un problema arquitectónico real

El problema no es el RPC en sí; es que **los workflows administrativos viven sin capa HTTP**:

| Síntoma | Evidencia | Consecuencia |
|---|---|---|
| Importaciones de hasta 5000 filas procesadas en un solo `plpgsql` (`process_participant_import` = 15 KB) bajo `statement_timeout = 8 s` | `commit_participant_import`, `preview_participant_import` | timeouts, sin progreso, sin reintentos por lote |
| Exportaciones de PII como un único `jsonb` de respuesta, parseado en el navegador (`exceljs`) | `export_participants`, `export_vocational`, `ExportPage.tsx` | memoria/timeouts, PII en memoria del navegador, sin control de descarga |
| Dashboards agregados sin caché, sondeados cada 20 s por cada pantalla abierta | `event_operations_overview` (`OperationsCenter.tsx`, `REFRESH_MS = 20_000`) | carga repetida idéntica |
| Operaciones destructivas/irreversibles sin pruebas y sin salvaguardas HTTP | `purge_demo_data`, `activate_real_operation`, `emergency_unlock_theme` | riesgo operativo máximo con cobertura cero |
| Sin throttling por usuario | `check_in(p_credential)` | oráculo `INVALID_CREDENTIAL` vs `NO_RESERVATION` sobre un código de 30 bits |
| Cliente sin tipos ni registro | `rpc<T>(name: string, …)` | cualquier módulo nuevo se conecta directo a SQL sin pasar por una decisión |

### 1.4 Edge Functions actuales — ¿estándar para el futuro?

| | `student-access` | `staff-accounts` |
|---|---|---|
| `verify_jwt` | false (necesario: es el login) | true (+ `auth.getUser` manual) |
| Autorización | n/a | **duplicada en TS**: lee `staff_members`/`staff_roles` con service_role y reimplementa `is_coordinacion` |
| Acceso a datos | `admin.from(...)` directo + `admin.rpc('access_lock_state')` | `admin.from(...)` directo en 8 puntos |
| Transacciones | `participants.update` + `access_attempts.insert` separados | `create`: auth user → `staff_members` → `staff_roles` (compensación solo para el 2.º paso; si falla el 3.º quedan huérfanos). `update`: 4 escrituras + baneo sin atomicidad; la regla `LAST_COORDINATOR` es check-then-act (condición de carrera) |
| Validación de input | parcial a mano | parcial a mano; sin tope de tamaño de body |
| Logs | `console.error(err)` (objeto completo) | idem |
| Código compartido | CORS/`json()`/errores copiados | copiados |
| Pruebas | ninguna | ninguna |

**Veredicto:** no deben ser el estándar tal cual. Sí sirve el *patrón* de `student-access` ("Edge → service_role → función SQL interna `access_lock_state`"), que ya es la forma objetivo. El mejor punto de partida disponible es el **handler de `workshop-intake`** (handler/validación separados del runtime Deno, lista blanca de campos, tope de body, mapeo de errores sin filtrar internals, pruebas en Node) — hoy en la rama `claude/workshop-intake`, **sin merge a `main`**. Mejoras para el estándar: módulo `_shared/` (CORS, `json`, `Fail`, parseo seguro de body, verificación de JWT, `actor`), validación de esquema, logs solo con códigos, tests, y **no reimplementar autorización en TS** (§8.3).

### 1.5 Deriva producción ↔ `main` (importante)

`workshop-intake` **está desplegada en producción** (v1, `verify_jwt=false`) junto con 2 migraciones y 5 funciones SQL, pero **no está en `main`** (rama `claude/workshop-intake`, commit `848a88b`). Las tablas `workshop_submissions`/`workshop_submission_careers` existen vacías (la fila de la prueba de integración fue eliminada). Está pausada y no la toqué. **Decisión pendiente tuya:** (a) mergearla tal cual y congelarla, (b) dejar el endpoint desplegado pero inactivo, o (c) retirarla de producción hasta retomar la Fase 9. Mientras exista, el endpoint público GET/POST acepta propuestas (modelo seguro, pero es superficie pública viva).

---

## 2. Inventario completo de funciones

### 2.1 Resumen por grupo (124 funciones en `public`)

| Grupo | Nº | Ejecutable por clientes | Ejemplos |
|---|---|---|---|
| RPC de aplicación del alumno | 11 | sí | `my_*`, `reserve_session`, `check_in`, `save_post_event_interests`, `accept_platform_notice` |
| RPC de Staff/Coordinación | 52 | sí | catálogo, participantes, import/export, tema, sorteo, operación |
| Helpers para policies/realtime | 5 | sí (necesario) | `is_operativo`, `is_coordinacion`, `has_staff_role`, `current_participant_id`, `active_edition_id` |
| Legacy/no usadas por el frontend | 5 | sí | `get_my_initial_interests`, `regenerate_session_credential`, `session_checkin_overview`, `session_credential_display`, `session_to_activity`* |
| Funciones internas (no ejecutables por clientes) | 43 | no | motor de reservas, credenciales, imports, helpers de identidad |
| Triggers | 8 | 1 expuesta por error | `after_session_change`, `guard_*`, `sync_participant_profile`, … |

\* `session_to_activity` sí la usa `CheckinModule.tsx`; ver E en la matriz.

### 2.2 Funciones NO ejecutables por clientes (50; 46 + 4 de `workshop-intake`)

| Grupo | Funciones |
|---|---|
| Autorización | `require_participant`, `require_operativo`, `require_coordinacion`, `require_sorteo_or_coordinacion`, `bootstrap_first_coordinator` (sin EXECUTE ni para `service_role`; uso manual) |
| Motor de reservas | `assert_reservable`, `expire_past_reservation`, `active_reservation_count`, `session_reserved_count`, `reservation_window`*, `broadcast_availability` |
| Progreso / alumno | `my_attended_workshop_count`, `my_stamp_count`, `participant_rank_level`, `post_event_interests_state`, `sync_initial_interests` |
| Credenciales / QR | `credential_encryption_key` (Vault), `generate_manual_code`, `generate_qr_token`, `ensure_activity_credential`, `rotate_activity_credential`, `resolve_credential` |
| Identidad / acceso | `access_lock_state` (usada por Edge `student-access`), `email_hash`*, `email_in_use`, `participant_by_email`, `check_birth_date`*, `clean_phone`*, `fold_text`*, `normalize_forms_extra`* |
| Imports | `process_participant_import` (15 KB), `process_catalog_import` (5.6 KB), `session_status_from_text`* |
| Sorteo | `get_pending_winner` (**sin llamadores**), `participant_has_won`, `participant_raffle_category`, `participant_tickets` |
| Tema | `theme_is_locked`, `validate_theme_config`* |
| Auditoría | `write_audit` |
| Triggers | `after_session_change`, `guard_is_demo`, `guard_participant_email_unique`, `guard_session_reservations`, `sync_participant_profile`, `trigger_ensure_activity_credential`, `workshop_submission_require_career` |
| Intake (Fase 9, no en main) | `create_workshop_submission_internal`, `workshop_intake_catalog_internal`, `workshop_keywords_valid`*, `workshop_submissions_set_updated_at` (**con EXECUTE para PUBLIC**, §5.2) |

\* `SECURITY INVOKER`.

### 2.3 Tablas y privilegios de cliente

| Tabla | `anon` | `authenticated` | Policies |
|---|---|---|---|
| `access_attempts`, `activity_credentials`, `import_batches`, `participant_import_conflicts`, `participants`, `raffle_*`, `session_credentials`, `workshop_*` | — | — | ninguna (denegado) |
| `attendances`, `reservations`, `initial_interests` | — | — | "participante lee lo suyo" (**inertes**: sin GRANT) |
| `post_event_interests` | — | SELECT | participante lee lo suyo (activa; ver §5.5) |
| `participant_profiles`, `staff_members`, `staff_roles`, `audit_log` | — | S + TRUNCATE/REFERENCES/TRIGGER | propio / coordinación |
| `activities`, `activity_careers`, `activity_sessions`, `careers`, `divisions`, `editions`, `rank_levels`, `theme_versions` | S + TRUNCATE/REFERENCES/TRIGGER | idem | lectura pública (sesiones solo `activa`; operativos ven todas; temas publicados) |
| `participant_email_history` | **DML completo + TRUNCATE** | **DML completo + TRUNCATE** | ninguna (RLS = deny) |

---

## 3. Consumidores reales

- **Frontend, `rpc(...)` literal:** 67 nombres en 24 archivos + `delete_activity`/`delete_session` (nombre dinámico en `WorkshopsTab.tsx:45`). Detalle por función en la matriz (§4).
- **Frontend, `.from()` directo:** `audit_log` (AuditLog.tsx), `staff_members` (AuditLog.tsx, auth.tsx), `rank_levels` (RankRules.tsx), `theme_versions` (ThemeEditor.tsx, ThemeProvider.tsx), `editions` (ThemeProvider.tsx), `participant_profiles` (auth.tsx), `activity_careers` (recommendationsApi.ts), `divisions`/`careers`/`activities` (catalog.ts).
- **Frontend → Edge:** `student-access` (auth.tsx:93), `staff-accounts` (adminApi.ts:15).
- **Frontend → Realtime:** `useReservationBoard.ts:89` (canal privado `availability:<edition>`; policy usa `active_edition_id()`, `current_participant_id()`, `is_operativo()`).
- **Edge → SQL:** `student-access` → `access_lock_state` (RPC con service_role); `staff-accounts` → `active_edition_id` (RPC) + tablas directas.
- **No llamadas desde el frontend (9 de las 73):** `active_edition_id`, `current_participant_id`, `has_staff_role`, `is_coordinacion`, `is_operativo` (policies), `get_my_initial_interests`, `regenerate_session_credential`, `session_checkin_overview`, `session_credential_display`.

---

## 4. Matriz de clasificación (73 RPC ejecutables por `authenticated`)

**Leyenda.** Clase: **A** mantener RPC pública · **B** mantener SQL pero interna tras Edge · **C** migrar lógica principal a Edge (SQL interna como primitiva) · **D** candidata a deprecar · **E** requiere investigación. `A†` = helper que las policies necesitan ejecutable. SD = `SECURITY DEFINER` (**sí en las 73**, todas con `search_path` fijo). L/E = lectura/escritura. Crit.: criticidad en el evento. Riesgo = riesgo de migración. Tests = suites SQL que la ejercitan (✗ = sin cobertura).

### 4.1 Alumno (participante)

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `accept_platform_notice` | student/Welcome | E | media | **A** | RPC | bajo | correcciones, reservaciones | 1 fila de consentimiento; operación pequeña y atómica |
| 2 | `my_progress` | lib/catalog | L | alta | **A** | RPC | bajo | asistencia, correcciones, post_event | conserva alias deprecados `interests_prompt/open` (retirar tras confirmar frontend) |
| 3 | `my_reservation_board` | lib/reservations | L | alta | **A** | RPC | bajo | reservaciones, fase8c, concurrencia | lectura agregada del propio alumno; sin beneficio de proxy |
| 4 | `my_recommended_activities` | lib/recommendationsApi | L | media | **A** | RPC | bajo | initial_interests, post_event | |
| 5 | `my_post_event_interests` | lib/catalog | L | media | **A** | RPC | bajo | post_event | |
| 6 | `save_post_event_interests` | student/Interests | E | media | **A** | RPC | bajo | post_event, correcciones | reemplazo atómico idempotente |
| 7 | `my_raffle_status` | lib/raffleApi | L | media | **A** | RPC | bajo | ✗ | única lectura del alumno sobre sorteo; añadir prueba |
| 8 | `get_my_initial_interests` | — (solo test) | L | baja | **D** | deprecar | bajo | initial_interests | el frontend no la usa; recomendaciones leen `initial_interests` en SQL |

### 4.2 Reservaciones (crítico, concurrencia)

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 9 | `reserve_session` | lib/reservations | E | CRÍTICA | **A** | RPC | alto si se toca | reservaciones, fase8c, concurrencia | locks de participante+sesión, capacidad, conflictos; un hop HTTP extra no añade frontera (identidad ya es el JWT) |
| 10 | `change_reservation` | idem | E | CRÍTICA | **A** | RPC | alto | idem | |
| 11 | `cancel_reservation` | idem | E | alta | **A** | RPC | medio | reservaciones | |
| 12 | `session_reservation_counts` | lib/reservations (WorkshopsTab) | L | media | **B** | `catalog-admin` | bajo | reservaciones | solapa con `event_operations_overview`/`activity_checkin_overview` (ver §5.7) |
| 13 | `update_reservation_settings` | lib/reservations | E | alta | **B** | `event-config` | bajo | reservaciones | configuración de la edición |

### 4.3 Check-in / credenciales

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 14 | `check_in` | lib/checkin | E | CRÍTICA | **A** | RPC (+ throttle en SQL) | alto si se toca | activity_credentials, asistencia, fase8c, concurrencia | **sin throttling**; ver §5.4. Si se quiere rate limit HTTP, la única razón válida para una fachada Edge aquí |
| 15 | `activity_credential_display` | lib/checkin | L (+audit) | alta | **B** | `checkin-admin` | medio | activity_credentials, fase8c | devuelve QR token + código manual descifrados; añadir `Cache-Control: no-store` y límite por usuario |
| 16 | `regenerate_activity_credential` | lib/checkin | E | alta | **B** | `checkin-admin` | medio | activity_credentials | rota secretos; motivo auditado |
| 17 | `activity_checkin_overview` | lib/checkin | L | alta | **B** | `operations` | bajo | activity_credentials, fase8c | dashboard de check-in |
| 18 | `session_to_activity` | lib/checkin → CheckinModule | L | media | **E** | investigar | bajo | activity_credentials | puente sesión→taller; si ya no existen rutas basadas en `session_id`, pasa a D |
| 19 | `session_credential_display` | — (solo test) | L | baja | **D** | deprecar | bajo | asistencia (4 llamadas) | wrapper legacy → `activity_credential_display` |
| 20 | `regenerate_session_credential` | — (solo test) | E | baja | **D** | deprecar | bajo | asistencia (6) | wrapper legacy → `regenerate_activity_credential` |
| 21 | `session_checkin_overview` | — (solo test) | L | baja | **D** | deprecar | bajo | asistencia (3) | `RETURN activity_checkin_overview()` |

### 4.4 Sorteo (evento en vivo)

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 22 | `draw_winner` | lib/raffleApi | E | CRÍTICA | **A** | RPC | alto | sorteo, concurrencia | aleatoriedad + idempotencia + unicidad (4.4 KB SQL) |
| 23 | `confirm_winner` | idem | E | CRÍTICA | **A** | RPC | alto | sorteo, concurrencia | |
| 24 | `mark_no_show` | idem | E | alta | **A** | RPC | medio | sorteo, concurrencia | |
| 25 | `invalidate_winner` | idem | E | alta | **A** | RPC | medio | sorteo | |
| 26 | `raffle_operator_view` | idem | L | alta | **E** | consolidar | medio | ✗ | las 6 lecturas del sorteo alimentan una sola pantalla: decidir tras el evento si se fusionan en 1 RPC/Edge `raffle` |
| 27 | `raffle_categories_read` | idem | L | media | **E** | consolidar | bajo | sorteo | |
| 28 | `raffle_prizes_read` | idem | L | media | **E** | consolidar | bajo | ✗ | |
| 29 | `raffle_pool_count` | idem | L | media | **E** | consolidar | bajo | ✗ | |
| 30 | `raffle_pending_selection` | idem | L | alta | **E** | consolidar | medio | sorteo, concurrencia | sustituyó a `get_pending_winner` |
| 31 | `raffle_winners_read` | idem | L | media | **E** | consolidar | bajo | sorteo | |
| 32 | `save_raffle_category` | idem | E | media | **B** | `event-config` (raffle) | bajo | ✗ | configuración previa al evento |
| 33 | `save_raffle_prize` | idem | E | media | **B** | `event-config` (raffle) | medio | sorteo, concurrencia | |

### 4.5 Participantes (PII, Staff/Coordinación)

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 34 | `search_participants` | admin/Participants | L | media | **B** | `participant-admin` | bajo | ✗ | typeahead con debounce; PII; limitar resultados/rate |
| 35 | `get_participant` | ParticipantDetail | L (+audit) | alta | **B** | `participant-admin` | medio | correcciones | PII completa + historial de correo |
| 36 | `create_participant_manual` | ParticipantForm | E | alta | **B** | `participant-admin` | medio | correcciones, initial_interests, reservaciones | |
| 37 | `update_participant` | ParticipantForm | E | alta | **B** | `participant-admin` | **alto** | correcciones, initial_interests | 6 KB de reglas (overrides manuales, alias de correo): conservar en SQL |
| 38 | `access_diagnosis` | AccessHelp | L (+audit) | media | **B** | `participant-admin` | bajo | ✗ | usa `access_lock_state` |
| 39 | `clear_access_lock` | AccessStatus | E | media | **B** | `participant-admin` | bajo | ✗ | |

### 4.6 Importación / exportación

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 40 | `preview_participant_import` | imports/ParticipantImport | L (dry-run) | alta | **C** | `data-io` | **alto** | correcciones | llama a `process_participant_import(batch=NULL)`; **la primitiva SQL (15 KB) se conserva interna** |
| 41 | `commit_participant_import` | idem | E | alta | **C** | `data-io` | **alto** | correcciones | lotes + progreso desde Edge; idempotencia por `import_batches` |
| 42 | `list_import_conflicts` | imports/Conflicts | L | media | **C** | `data-io` | bajo | ✗ | |
| 43 | `resolve_import_conflict` | idem | E | media | **C** | `data-io` | medio | ✗ | |
| 44 | `preview_catalog_import` | catalog/CatalogImport | L | media | **C** | `data-io` | medio | ✗ | wrapper de `process_catalog_import` |
| 45 | `commit_catalog_import` | idem | E | alta | **C** | `data-io` | medio | ✗ | |
| 46 | `export_participants` | export/ExportPage | L (PII) | alta | **C** | `data-io` | medio | correcciones | CSV/XLSX en servidor, `Content-Disposition`, auditoría de descarga |
| 47 | `export_vocational` | idem | L (PII) | alta | **C** | `data-io` | medio | ✗ | acceso ya restringido a Coordinación |

### 4.7 Catálogo

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 48 | `save_division` | catalog/DivisionsTab | E | media | **B** | `catalog-admin` | bajo | ✗ | |
| 49 | `save_career` | catalog/CareersTab | E | media | **B** | `catalog-admin` | bajo | ✗ | |
| 50 | `save_activity` | catalog/WorkshopModals | E | media | **B** | `catalog-admin` | bajo | correcciones, reservaciones | |
| 51 | `save_session` | idem | E | alta | **B** | `catalog-admin` | medio | correcciones, reservaciones | triggers de protección de sesiones con reservas |
| 52 | `save_activity_careers` | lib/recommendationsApi | E | media | **B** | `catalog-admin` | bajo | ✗ | |
| 53 | `delete_activity` | catalog/WorkshopsTab | E | media | **B** | `catalog-admin` | bajo | ✗ | |
| 54 | `delete_session` | idem | E | media | **B** | `catalog-admin` | bajo | reservaciones | |
| 55 | `set_session_location` | WorkshopModals | E | media | **B** | `catalog-admin` | bajo | reservaciones | |

### 4.8 Configuración del evento y tema

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 56 | `save_theme_draft` | admin/theme/ThemeEditor | E | media | **B** | `event-config` | bajo | ✗ | `validate_theme_config` queda en SQL |
| 57 | `publish_theme_draft` | idem | E | alta | **B** | `event-config` | bajo | ✗ | |
| 58 | `restore_theme_version` | idem | E | media | **B** | `event-config` | bajo | ✗ | |
| 59 | `relock_theme` | idem | E | media | **B** | `event-config` | bajo | ✗ | |
| 60 | `emergency_unlock_theme` | idem | E | alta | **B** | `operations` (zona de peligro) | bajo | ✗ | frase + motivo; candidata a step-up |
| 61 | `update_rank_rules` | admin/RankRules | E | media | **B** | `event-config` | bajo | ✗ | |

### 4.9 Operación / dashboards / zona de peligro

| # | Función | Consumidor | L/E | Crit. | Clase | Destino | Riesgo | Tests | Observaciones |
|---|---|---|---|---|---|---|---|---|---|
| 62 | `event_operations_overview` | lib/operationsApi | L | alta | **B** | `operations` | bajo | operaciones, fase8c | sondeo cada 20 s; candidata a caché corta; la agregación SQL se conserva |
| 63 | `coordination_summary` | admin/Overview | L | media | **B** | `operations` | bajo | ✗ | solapa con #62 |
| 64 | `declare_official_roster` | imports/RosterStatus | E | alta | **B** | `operations` | medio | correcciones | confirmación por frase |
| 65 | `reopen_roster_import` | idem | E | alta | **B** | `operations` | medio | correcciones | |
| 66 | `demo_purge_preview` | admin/Operation | L | media | **B** | `operations` | bajo | ✗ | |
| 67 | `purge_demo_data` | idem | E | **CRÍTICA destructiva** | **B** | `operations` | **alto** | ✗ | **cero pruebas** sobre una operación que borra datos: caracterizar antes de tocar |
| 68 | `activate_real_operation` | idem | E | **CRÍTICA irreversible** | **B** | `operations` | **alto** | ✗ | **cero pruebas**; candidata a step-up de autenticación |

### 4.10 Helpers que las policies necesitan (A†)

| # | Función | Consumidor | Clase | Observaciones |
|---|---|---|---|---|
| 69 | `is_operativo` | policies `activity_sessions`, realtime | **A†** | no es endpoint de aplicación; ejecutable porque las policies corren como el rol del llamador |
| 70 | `is_coordinacion` | policies `audit_log`, `staff_*`, `theme_versions` | **A†** | idem |
| 71 | `has_staff_role` | helpers SQL | **A†** | idem; `SECURITY DEFINER` es necesario (evita recursión de RLS) |
| 72 | `current_participant_id` | policies, realtime | **A†** | idem |
| 73 | `active_edition_id` | realtime, `staff-accounts` | **A†** | podría ser `INVOKER` (lee `editions`, pública) |

### 4.11 Recuento

| Clase | Nº | Funciones |
|---|---|---|
| **A** | 20 | 15 RPC de aplicación (#1–7, #9–11, #14, #22–25) + 5 helpers A† (#69–73) |
| **B** | 34 | #12–13, #15–17, #32–33, #34–39, #48–55, #56–61, #62–68 |
| **C** | 8 | imports/exports (#40–47) |
| **D** | 4 | `get_my_initial_interests`, `session_credential_display`, `regenerate_session_credential`, `session_checkin_overview` |
| **E** | 7 | `raffle_*` de lectura (6) + `session_to_activity` |
| **Total** | **73** | |

Adicionales fuera de la matriz (no ejecutables por clientes): `get_pending_winner` (sin llamadores → **D**), tabla `session_credentials` (0 filas, sin policies → **D**), alias `interests_prompt/interests_open` en `my_progress` (→ **D** una vez confirmado el frontend).

---

## 5. Problemas de seguridad y superficie

Severidad estimada en contexto (sistema pre-evento, sin datos reales aún).

### 5.1 Privilegios de tabla excesivos — **Media (defensa en profundidad)**
- `anon` y `authenticated`: `TRUNCATE`, `REFERENCES`, `TRIGGER` sobre `activities`, `activity_careers`, `activity_sessions`, `careers`, `divisions`, `editions`, `rank_levels`, `theme_versions`; `authenticated` además sobre `audit_log`, `participant_profiles`, `staff_members`, `staff_roles`.
- `participant_email_history`: **DML completo + TRUNCATE para `anon` y `authenticated`**; hoy solo lo frena RLS sin policies.
- **Explotabilidad actual: baja.** PostgREST no expone `TRUNCATE`/`TRIGGER`/`REFERENCES` y no hay función que ejecute SQL dinámico con input de cliente; haría falta una conexión directa a Postgres con esos roles. Pero viola mínimo privilegio, y `authenticated` puede (en teoría) truncar `audit_log` o `staff_roles`. Causa raíz: privilegios por defecto de Supabase en `public`.

### 5.2 Fugas por defaults en funciones — **Baja**
- Supabase otorga EXECUTE por defecto a `anon`/`authenticated`/`service_role` en funciones de `public`. Cada función nueva exige `REVOKE` explícito; basta olvidarlo una vez. **Caso real: `workshop_submissions_set_updated_at()` (función trigger de mi migración de Fase 9) tiene `EXECUTE` para `PUBLIC`** — no es invocable como RPC (es una función trigger) pero rompe el invariante "anon = 0" y demuestra el riesgo.

### 5.3 Las pruebas corren contra producción — **Media**
Todas las suites se pegan en `execute_sql` contra el proyecto oficial (con `RAISE EXCEPTION` final para revertir). Varias modifican `editions` (modo, ventanas, mínimos) dentro de la transacción. No hay proyecto de staging ni CI. Un error en una prueba podría escribir en producción.

### 5.4 `check_in` sin throttling y con oráculo — **Baja/Media**
`resolve_credential` acepta el código manual (6 caracteres de un alfabeto de 32 = ~30 bits). `check_in` distingue `INVALID_CREDENTIAL` de `NO_RESERVATION`, de modo que cualquier alumno autenticado puede sondear códigos válidos sin límite. Mitigaciones existentes: se exige reserva previa y ventana temporal; el token QR es de 256 bits. Falta un contador de intentos por participante (en SQL) o un rate limit HTTP.

### 5.5 Inconsistencias menores de política
- `post_event_interests` conserva `SELECT` para `authenticated` (lo concedí yo), aunque el frontend ya lee por RPC; el resto del dominio del alumno es "sin grants". Revocar para consistencia.
- `editions` es legible por `anon` completa (`mode`, `real_operation_at`, `roster_*`, `theme_unlock_until`, ventanas de check-in…). Sin secretos, pero expone estado operativo; exponer vista mínima sería más limpio.
- Las policies "inertes" (§1.2) pueden confundir a futuros desarrolladores.

### 5.6 Autorización por convención, sin lint — **Media a largo plazo**
Las 73 están correctamente guardadas hoy, pero nada impide una función nueva `SECURITY DEFINER` sin guard. Falta una prueba automática (§11): "toda función ejecutable por `authenticated` llama a un guard o está en lista blanca".

### 5.7 Duplicación y deuda
- 3 dashboards solapados (`event_operations_overview`, `activity_checkin_overview`, `coordination_summary`) + `session_reservation_counts`.
- 6 lecturas del sorteo para una pantalla.
- Tríada legacy de credenciales por sesión (4 funciones + tabla `session_credentials` vacía) y suite `regression_asistencia.sql` que aún la ejercita.
- `get_pending_winner` huérfana (reemplazada por `raffle_pending_selection`).
- Cliente `rpc<T>(name: string)` sin tipos generados ni registro central.

### 5.8 Edge Functions actuales — ver §1.4
Autorización duplicada en TS, escrituras multi-paso no atómicas, condición de carrera en `LAST_COORDINATOR`, sin límites de body, `console.error(err)` con objeto completo, CORS comodín.

### 5.9 `SECURITY DEFINER` — evaluación por grupo

| Grupo | ¿Necesita definer? | Conclusión |
|---|---|---|
| Alumno (`my_*`, reservas, check-in, intereses) | Sí: las tablas no tienen grants | Mantener. Alternativa (grants + RLS por tabla) es mayor riesgo/beneficio incierto |
| Staff/Coordinación (catálogo, participantes, tema, sorteo, operación) | Sí hoy; **tras migrar a Edge pasan a ser primitivas internas** | Siguen siendo definer pero no ejecutables por clientes |
| Helpers de rol (`is_*`, `has_staff_role`, `current_participant_id`) | Sí (recursión de RLS / tablas sin grants) | Mantener |
| `active_edition_id`, `theme_is_locked` | No | Candidatas a `INVOKER` (marginal) |
| Funciones puras (`fold_text`, `clean_phone`, …) | No | Ya son `INVOKER` |
| `search_path = public` | Aceptable (todas lo fijan) | Mejora opcional: `pg_catalog, public` o calificar nombres |

---

## 6. Arquitectura objetivo propuesta

```
React
│
├─ Supabase Auth ........................ sesiones (JWT) — sin cambios
├─ REST/RLS (lecturas simples) .......... editions, divisions, careers, activities(+sessions), activity_careers,
│                                         rank_levels, theme_versions, participant_profiles(propio)
├─ RPC públicas EXCEPCIONALES (~15) ..... alumno + operaciones atómicas/concurrentes (reservas, check-in, sorteo en vivo)
├─ Realtime ............................. canal privado de disponibilidad (sin cambios)
└─ Edge Functions (servicios agrupados)
     ├─ student-access ................... (existe) login
     ├─ staff-accounts ................... (existe) cuentas Staff → endurecer
     ├─ participant-admin ................ participantes + diagnóstico de acceso
     ├─ catalog-admin .................... divisiones/carreras/talleres/sesiones (+ publicación de propuestas, Fase 9)
     ├─ data-io .......................... importaciones + exportaciones + conflictos
     ├─ operations ....................... dashboards + roster + zona de peligro (purge/activate/unlock)
     ├─ event-config ..................... tema, rangos, ventanas de reserva, config de sorteo
     ├─ checkin-admin .................... ver/regenerar credenciales QR (secretos)
     └─ public-intake (workshop-intake) .. frontera pública de propuestas (Fase 9, pausada)
            │
            ▼
   Funciones SQL internas (schema `public` hoy → `private` a mediano plazo)
   • wrapper público fino = 1 línea → interna(auth.uid(), …)   [solo durante la transición]
   • internas con p_actor explícito; re-validan el rol del actor contra las tablas
   • reglas de negocio, locks, atomicidad y triggers: SE QUEDAN EN POSTGRES
```

### 6.1 Principios
1. **Postgres es dueño de las reglas** (atomicidad, constraints, locks, capacidad, unicidad, idempotencia). **Edge es dueño del protocolo** (HTTP, tamaño, formatos de archivo, orquestación de lotes, rate limit, auditoría de acceso, caché, secretos de integración).
2. **No reimplementar reglas en TypeScript.** Si la regla ya está bien en SQL, se envuelve; no se reescribe.
3. **Identidad explícita.** Edge verifica el JWT, obtiene el `actor`, y la función interna **vuelve a comprobar** que ese actor tiene el rol (no se confía ciegamente en Edge).
4. **Deny-by-default también para funciones**: las internas viven donde `anon`/`authenticated` no pueden ejecutarlas por construcción (schema no expuesto) y no por `REVOKE` manual.
5. **Una frontera por dominio**, no una por función.

### 6.2 Cantidades estimadas (con criterio)

| | Hoy | Objetivo | Criterio |
|---|---|---|---|
| RPC ejecutables por `authenticated` | 73 | **~21–27** | A (20) + sorteo-lectura consolidada (1–6, según decisión) + `session_to_activity` (0–1); sin D (4) |
| …de las cuales de aplicación (no helpers) | 68 | ~15–21 | |
| Escrituras privilegiadas Staff/Coord. expuestas al navegador | 32 | **4** | solo `draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner` |
| Escrituras totales expuestas | 38 | ~10 | las 4 anteriores + 6 del alumno |
| Funciones SQL internas (no ejecutables por clientes) | 50 | ~91 | +34 B +8 C pasan a internas; −`get_pending_winner`; los 4 D se retiran |
| Edge Functions | 2 (+1 pausada) | 8–9 | 6 nuevas + 2 existentes (+ intake) |
| Reducción de superficie pública | — | **−63 % a −71 %** | 73 → 21–27 |

No hay una cifra objetivo "a priori": sale de la clasificación. Si se decide que el sorteo en vivo debe tener también fachada, el piso sería ~15 + 5 helpers = 20.

---

## 7. Agrupación recomendada de Edge Functions

| Servicio | Contrato (acciones) | SQL interna que envuelve | Ventajas | Desventajas / riesgos |
|---|---|---|---|---|
| `participant-admin` | `search`, `get`, `create`, `update`, `access_diagnosis`, `clear_access_lock` | `update_participant`, `create_participant_manual`, `get_participant`, `search_participants`, `access_*` (reglas de overrides, alias, historial) | autorización y registro de **lecturas de PII** en un punto; límites de resultados; errores uniformes | un hop más en el typeahead; `update_participant` es la pieza más compleja: no se reescribe |
| `catalog-admin` | CRUD de divisiones/carreras/talleres/sesiones, `set_location`, carreras afines, `reservation_counts` | `save_*`, `delete_*`, `set_session_location` + triggers existentes | prerrequisito natural de la **publicación de propuestas (Fase 9)** (varios pasos: actividad + sesiones + carreras + credencial) | CRUD simple: la ganancia de seguridad es modesta; el valor es de orquestación futura |
| `data-io` | `import/preview`, `import/commit`, `import/conflicts`, `export/{participants,vocational}` | `process_*_import` (se conservan), nuevas `export_*_internal` paginadas | lotes con progreso e idempotencia, parseo de archivos en servidor, descargas con `Content-Disposition` y auditoría, evita acumular PII en el navegador | **mayor riesgo de regresión** (15 KB de reglas); PostgREST/`authenticator` aplica 8 s por llamada → hay que **dividir en lotes** (Edge no elimina el timeout si usa supabase-js) |
| `operations` | `overview`, `summary`, `roster/declare|reopen`, `demo/purge_preview|purge`, `real/activate`, `theme/emergency_unlock` | `event_operations_overview`, `coordination_summary`, `declare_official_roster`, `purge_demo_data`, `activate_real_operation` | caché corta de dashboards; salvaguardas HTTP (step-up/re-auth, frase, doble confirmación) para acciones irreversibles; auditoría | las acciones destructivas hoy tienen **cero pruebas**: caracterizar antes |
| `event-config` | tema (`draft/publish/restore/relock`), `rank_rules`, `reservation_settings`, `raffle config` | `save_theme_draft`, `publish_theme_draft`, …, `update_*` | una sola puerta de configuración y de auditoría | volumen bajo; ganancia moderada |
| `checkin-admin` | `credential/display`, `credential/regenerate` | `activity_credential_display`, `regenerate_activity_credential`, `rotate_*` | `no-store`, límite por usuario, registro de quién vio/rotó secretos | pequeño; se puede fusionar en `operations` si se quiere menos servicios |
| `raffle` (opcional, **al final**) | lecturas consolidadas + `save_*` de config | `raffle_*` | 6 lecturas → 1 contrato | riesgo en el evento en vivo: solo post-evento |

**Por qué agrupar y no 1:1:** menos despliegues y superficie, autorización y logging compartidos (`_shared/`), contratos cohesivos por pantalla/rol. **Contra:** funciones grandes se vuelven un "mini monolito" por dominio; mitigación: handler por acción + validación por acción + pruebas por acción (patrón del handler de `workshop-intake`).

**Qué NO va a Edge:** reservas, cancelación, cambio, check-in, intereses, lecturas del propio alumno, acciones del sorteo en vivo (§12).

---

## 8. Estrategia de migración incremental

### 8.1 Evaluación de la secuencia de 10 pasos propuesta
La secuencia es sensata en espíritu pero tiene **tres huecos**:

1. **Falta el paso 0: caracterización.** 27 de las 73 RPC no tienen prueba (`access_diagnosis`, `activate_real_operation`, `clear_access_lock`, `commit/preview_catalog_import`, `coordination_summary`, `delete_activity`, `demo_purge_preview`, `emergency_unlock_theme`, `export_vocational`, `list/resolve_import_conflict(s)`, `my_raffle_status`, `publish/restore/relock/save_theme*`, `purge_demo_data`, `raffle_operator_view/pool_count/prizes_read`, `save_activity_careers/career/division`, `save_raffle_category`, `search_participants`, `update_rank_rules`). No se debe mover lo que no se puede verificar.
2. **"Crear Edge equivalente + revocar" ignora la identidad.** Las funciones usan `auth.uid()`. Con `service_role`, `auth.uid()` es `NULL`: los guards fallarían y la auditoría perdería al actor.
3. **Falta un mecanismo de rollback instantáneo** durante la convivencia (feature flag por módulo en el frontend).

### 8.2 Estrategia propuesta: "extraer y envolver" (strangler con identidad explícita)

Por cada función de clase B/C:

| Paso | Acción | Cambia comportamiento | Reversible |
|---|---|---|---|
| 1 | **Caracterizar**: prueba SQL de entradas/salidas actuales (golden JSON) | no | — |
| 2 | **Extraer**: mover el cuerpo a `internal.fn(p_actor uuid, …)`; la guard pasa a `require_*_for(p_actor)`; `write_audit` recibe actor | no | sí |
| 3 | **Envolver**: la RPC pública pasa a `RETURN internal.fn(auth.uid(), …)` (1 línea). Misma firma, mismo resultado. Se corren las suites existentes | **no** | sí |
| 4 | **Fachada Edge fase 1 (opcional)**: Edge llama a la RPC *con el JWT del usuario* (`Authorization` reenviado) → aporta límites, validación, logs, caché **sin cambiar autoridad** | no | sí |
| 5 | **Fachada Edge fase 2**: Edge verifica JWT → `actor` → `internal.fn(actor, …)` con `service_role` | no (mismo contrato HTTP) | sí (flag) |
| 6 | **Frontend**: un módulo a la vez detrás de un flag (`VITE_USE_EDGE_<MODULO>`), cliente tipado | no | sí (flag) |
| 7 | **Equivalencia**: misma entrada por ambas rutas → mismo JSON | — | — |
| 8 | **Observar** en producción un ciclo completo de uso | — | — |
| 9 | **Revocar** `EXECUTE` del wrapper público a `authenticated` (queda para `service_role`) | sí | sí (re-grant) |
| 10 | **Mantener** la interna; borrar el wrapper solo cuando ningún frontend antiguo lo use | — | — |

Ventajas: una sola fuente de verdad de la regla (la interna); los pasos 2–3 se prueban con las suites que ya existen; compatibilidad "frontend viejo → RPC / frontend nuevo → Edge" durante todo el proceso; revocación como último paso.

### 8.3 Autorización en la fachada
Edge **no reimplementa** `require_coordinacion` en TS: verifica el JWT, extrae `actor`, y la función interna **re-valida** el rol del `actor` contra `staff_roles`/`staff_members` (misma lógica SQL actual, con parámetro). Así `staff-accounts` también debería migrar a "Edge → interna con `p_actor`" (hoy duplica la regla en TS).

### 8.4 Cambios estructurales de apoyo (propuestos, no hechos)
1. **Schema `private`** para funciones internas; `public` solo con la superficie intencional. Las policies pueden llamar helpers en `private` si `authenticated` tiene `USAGE` y `EXECUTE` en esos helpers.
2. **`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated`** (y revocar privilegios de tabla sobrantes): elimina la clase de error de §5.2/§5.1.
3. **Cliente tipado en el frontend**: sustituir `rpc<T>(name)` por módulos `src/lib/api/<dominio>.ts` con tipos generados (`supabase gen types`) y una regla ESLint que prohíba `supabase.rpc`/`from()` fuera de `src/lib/api/**`: obliga a que nuevas superficies sean una decisión explícita.
4. **Entorno de pruebas aislado** (rama/proyecto de staging de Supabase) y un runner (psql/`supabase db query` en CI) en lugar de pegar SQL en producción.

---

## 9. Orden de ejecución sugerido (por bloques)

**Restricción dominante: evento el 2026-10-15 (10 días).** No hay Staff real, hay 3 participantes demo y 0 importaciones, es decir: es *técnicamente* el mejor momento para reestructurar, pero es el *peor* momento operativo para tocar nada que se use el día del evento o que se necesite para cargar el roster.

| Bloque | Cuándo | Contenido | Riesgo | Por qué en este orden |
|---|---|---|---|---|
| **0 — Cimientos sin cambio funcional** | ahora → 15 oct | (a) pruebas de caracterización para las 27 sin cobertura (solo lectura/rollback, idealmente en staging); (b) cliente tipado + lint; (c) prueba automática de superficie (§11); (d) **higiene de privilegios** (§8.4-2) | muy bajo (no cambia contratos; el REVOKE de TRUNCATE/TRIGGER/REFERENCES no afecta a la Data API) | reduce riesgo y habilita todo lo posterior |
| **Congelamiento** | 8 oct → 16 oct | nada de migraciones en reservas, check-in, sorteo, imports/roster | — | el evento depende de ellos |
| **1 — Zona de peligro y configuración** | post-evento | `operations` (purge/activate/unlock/roster) y `event-config` (tema, rangos, ventanas, config de sorteo) | medio (pocas llamadas, alto impacto) → por eso se caracterizan primero | volumen mínimo, valor de seguridad alto (step-up, auditoría) |
| **2 — Participantes** | post-evento | `participant-admin` | medio | PII: máximo valor de control; `update_participant` se envuelve, no se reescribe |
| **3 — Catálogo** | post-evento (o antes de retomar Fase 9) | `catalog-admin` | bajo | prerrequisito del flujo de publicación de propuestas |
| **4 — Importación/exportación** | post-evento | `data-io`: primero **exportaciones** (solo lectura), luego previews, luego commits | alto en commits | mayor beneficio técnico (timeouts, PII), pero mayor superficie de reglas |
| **5 — Dashboards y credenciales** | post-evento | `operations` (overview/summary/checkin overview), `checkin-admin` | bajo | caché y secretos |
| **6 — Limpieza D** | tras observación | revocar/borrar `session_*` legacy, `get_my_initial_interests`, `get_pending_winner`, tabla `session_credentials`, alias de `my_progress` | bajo | solo cuando nadie las llame |
| **7 — Sorteo** | al final y solo si aporta | consolidar 6 lecturas (E); config ya en bloque 1 | medio-alto | evento en vivo |

*Si el negocio exigiera reestructurar **antes** del evento, lo único defendible es el Bloque 0 más, como máximo, las exportaciones (solo lectura, reversible por flag). Las importaciones no: el roster real se carga antes del evento con la ruta actual.*

**Orden alternativo considerado y descartado:** empezar por `data-io` (mayor valor técnico) → descartado por riesgo/calendario; empezar por catálogo (más simple) → válido, pero la zona de peligro tiene mejor relación valor/riesgo y hoy cero cobertura.

---

## 10. Compatibilidad temporal

- **Invariantes:** (1) la RPC antigua mantiene firma y resultado hasta el paso 9; (2) un solo lugar con la regla (la interna); (3) cambios de contrato y de backend nunca en el mismo paso; (4) nada se borra antes de migrar *todos* los consumidores.
- **Frontend nuevo → Edge / frontend viejo → RPC:** posible porque el wrapper público se conserva (pasos 3–8).
- **Flags** `VITE_USE_EDGE_*` por módulo para volver atrás en segundos.
- **Versionado de contrato Edge** (`/v1` o campo `version`) para poder evolucionar sin romper clientes en caché (PWA/pestañas abiertas durante el evento).
- **Realtime y reservas** no cambian de frontera: no hay convivencia que gestionar.
- **Respuesta a un rollback:** re-grant del wrapper (1 sentencia) + flag.

---

## 11. Plan de pruebas por bloque

### 11.1 Suites existentes y qué protegen

| Dominio | Suites | Cubren |
|---|---|---|
| Reservaciones | `regression_reservaciones.sql`, `regression_fase8c.sql`, `concurrency_reservations.mjs` (+ fixtures) | reglas, límites, ventana de check-in, histórico, concurrencia real |
| Check-in / QR / créditos | `regression_activity_credentials.sql`, `regression_asistencia.sql`*, `concurrency_checkin.mjs` (+ setup/cleanup), `regression_fase8c.sql` | un QR por taller, `already_registered`, créditos, concurrencia. \*`asistencia` aún ejercita las funciones legacy `session_*` |
| Sorteo | `regression_sorteo.sql`, `concurrency_sorteo.mjs` | draw/confirm/no-show/invalidate, idempotencia, concurrencia |
| Intereses | `regression_initial_interests.sql`, `regression_post_event_interests.sql` | iniciales (≤2), finales (≤3), gating, entorno demo/real, independencia |
| Operaciones | `regression_operaciones.sql`, `test_operationsHelpers.mjs` | autorización, métricas, privacidad |
| Participantes / imports / roster / seguridad general | `regression_correcciones.sql` | import (preview/commit), roster, export_participants, get/create/update participante, save_activity/session |
| Intake (Fase 9, rama) | `regression_workshop_intake.sql`, `handler.test.ts`, `integration.test.ts` | modelo, permisos, handler HTTP |

### 11.2 Suites a crear (propuestas)
1. **`regression_security_surface.sql`** (barata y de alto valor): toda función ejecutable por `authenticated` es `SECURITY DEFINER` con `search_path` fijo **y** llama a un guard o está en lista blanca; ninguna ejecutable por `anon`/`PUBLIC`; todo trigger-fn sin EXECUTE de clientes; todas las tablas con RLS; privilegios de tabla de clientes ⊆ lista blanca. Corre en cada bloque.
2. **Caracterización de las 27 RPC sin cobertura** — prerrequisito del bloque que las toque.
3. **Pruebas de equivalencia** por función migrada: misma entrada por la RPC pública y por la interna/Edge → mismo JSON y mismos efectos (incluida la fila de auditoría con el actor correcto).
4. **Pruebas del handler Edge** (Node, patrón de `workshop-intake`): método, content-type, tamaño, JSON, campos desconocidos, errores sin filtrar detalles.
5. **Smoke E2E por rol** (participante / staff / coordinación / sorteo) contra Edge, siguiendo el estilo de `concurrency_*.mjs`.

### 11.3 Qué ejecutar tras cada bloque

| Bloque | Obligatorias | Nuevas |
|---|---|---|
| 0 | todas las existentes (línea base) + `security_surface` | caracterización |
| 1 (operations/event-config) | `operaciones`, `correcciones` (roster), `reservaciones` (ventanas), `security_surface` | caracterización de purge/activate/tema; equivalencia |
| 2 (participantes) | `correcciones`, `initial_interests`, `reservaciones`, `post_event_interests`, `security_surface` | equivalencia + prueba de auditoría de lecturas PII |
| 3 (catálogo) | `correcciones`, `reservaciones` (guard de sesiones), `fase8c`, `activity_credentials` (creación de credencial por trigger) | caracterización de division/career/activity_careers |
| 4 (data-io) | `correcciones`, `initial_interests`, `post_event_interests`, `operaciones`, `security_surface` | equivalencia de import (preview/commit), lotes e idempotencia, export con descarga |
| 5 (dashboards/credenciales) | `operaciones`, `test_operationsHelpers`, `activity_credentials`, `fase8c`, `concurrency_checkin` | |
| 6 (limpieza D) | **todas** + `security_surface` | actualizar/retirar la parte legacy de `regression_asistencia` |
| 7 (sorteo) | `sorteo`, `concurrency_sorteo` | |

---

## 12. Funciones que NO tocaría (y por qué)

| Función / pieza | Motivo |
|---|---|
| `reserve_session`, `change_reservation`, `cancel_reservation` | locks, capacidad, conflictos, atomicidad; un hop HTTP no añade frontera (la identidad ya es el JWT); camino de máxima carga el día del evento |
| `check_in` (salvo throttle interno) | transaccional + idempotente (índice único), descifrado de credenciales con Vault |
| `draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner` | aleatoriedad, idempotencia, unicidad y concurrencia ya probadas; evento en vivo |
| `my_progress`, `my_reservation_board`, `my_recommended_activities`, `my_post_event_interests`, `my_raffle_status` | lecturas del propio alumno, definer necesario (tablas sin grants), sin beneficio de proxy |
| `save_post_event_interests`, `accept_platform_notice` | operaciones pequeñas, atómicas y data-centric |
| Motor interno (`assert_reservable`, `expire_past_reservation`, `session_reserved_count`, `active_reservation_count`, `broadcast_availability`) | reglas núcleo; justificadamente en SQL |
| `process_participant_import`, `process_catalog_import` | 20 KB de reglas de matching/conflictos: se **envuelven**, no se reescriben |
| Credenciales (`resolve_credential`, `rotate_*`, `ensure_*`, `credential_encryption_key`, `generate_*`) y trigger de creación | criptografía y Vault cerca de los datos |
| Helpers de rol y policies (`is_*`, `has_staff_role`, `current_participant_id`, `active_edition_id`) y policy de Realtime | requeridos por RLS/Realtime; sacarlos rompe la seguridad de lectura |
| Triggers (`guard_*`, `after_session_change`, `sync_participant_profile`) | invariantes en la base |
| `student-access` | es la puerta de entrada de los alumnos; solo **endurecer** (no mover), y no tocar antes del evento |

---

## 13. Funciones prioritarias para migrar (por valor/riesgo)

1. **`purge_demo_data`, `activate_real_operation`, `emergency_unlock_theme`, `declare_official_roster`/`reopen_roster_import`** (zona de peligro): máximo impacto, **cero pruebas**; fachada con salvaguardas, tras caracterizar.
2. **`export_participants`, `export_vocational`**: PII fuera de la frontera sin control de descarga; solo lectura, bajo riesgo de dato.
3. **`get_participant`, `search_participants`, `update_participant`, `create_participant_manual`**: PII y reglas complejas; un punto de autorización y auditoría de lecturas.
4. **`save_*`/`delete_*` del catálogo**: prerrequisito de la publicación de propuestas.
5. **`commit_participant_import`/`preview_*`**: valor técnico alto (timeouts, lotes, parseo), riesgo alto → después de lo anterior.
6. **`activity_credential_display`/`regenerate_*`**: secretos con trato `no-store` y límite.
7. Dashboards (`event_operations_overview`, `coordination_summary`, `activity_checkin_overview`): caché y consolidación.

---

## 14. Riesgos principales

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Identidad perdida** al pasar a `service_role` (`auth.uid()=NULL`) | patrón `p_actor` + re-validación del rol en SQL (§8.3); prueba de auditoría del actor |
| 2 | **Regresión en reglas complejas** (imports, `update_participant`) | envolver, no reescribir; caracterización + equivalencia por función |
| 3 | **Calendario**: evento en 10 días | congelamiento; solo Bloque 0 antes del 15-oct |
| 4 | **Doble fuente de verdad** (TS y SQL) | prohibido reimplementar reglas en TS; revisión de diseño por función |
| 5 | **Timeouts** no resueltos por Edge (`authenticator` 8 s al usar PostgREST) | lotes; si se requiere trabajo largo, conexión directa a Postgres desde Edge |
| 6 | **Pruebas contra producción** | staging/rama de Supabase antes de ampliar suites |
| 7 | **Mini-monolitos por servicio** | handler/validación por acción, módulos compartidos `_shared/` |
| 8 | **Clientes antiguos** (pestañas/PWA abiertas) | versionado de contrato, wrapper vivo hasta observar |
| 9 | **Hop extra** en rutas calientes | por eso reservas/check-in/sorteo quedan fuera |
| 10 | **Deriva** producción↔`main` (intake desplegado sin merge) | decidir §1.5; política "nada se despliega sin estar en `main`" |
| 11 | **Revocar demasiado pronto** | revocación = último paso, reversible (re-grant) |
| 12 | **Función nueva sin guard** | prueba automática de superficie (§11.2-1) |

---

## 15. Estimación final de la superficie RPC pública

| Componente | Nº |
|---|---|
| RPC de aplicación del alumno | 8 (`accept_platform_notice`, `my_progress`, `my_reservation_board`, `my_recommended_activities`, `my_post_event_interests`, `save_post_event_interests`, `my_raffle_status`, `check_in`) |
| Reservas | 3 (`reserve_session`, `change_reservation`, `cancel_reservation`) |
| Sorteo en vivo (escrituras) | 4 (`draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner`) |
| Sorteo en vivo (lecturas) | 1–6 (hoy 6; se decide tras el evento) |
| Helpers de policies | 5 (0 si se mueven a un schema no expuesto) |
| `session_to_activity` | 0–1 |
| **Total estimado** | **~21–27** (hoy 73) |

**Funciones SQL internas:** ~91 (hoy 50). **Edge Functions:** 8–9 (hoy 2 + 1 pausada). **D a retirar:** 4 RPC + `get_pending_winner` + tabla `session_credentials` + alias de `my_progress`.

---

## Anexo A — Metodología y límites del análisis

- Inventario desde `pg_proc`/`pg_class`/`pg_policy`/`pg_roles` (solo lectura) en `spoeehpziokmknecwcbd`, y desde el código en `main` @ `e1f66e0`.
- Lectura/escritura inferida por análisis estático del cuerpo (insert/update/delete y llamadas entre funciones) y revisada manualmente; `restore_theme_version`, `regenerate_activity_credential` y `accept_platform_notice` escriben aunque la heurística no lo marque directamente.
- Consumidores: búsqueda literal de `rpc('nombre')` y `.from('tabla')` en `src/` (más el único caso dinámico) y revisión de las Edge Functions.
- No se leyó el cuerpo completo de cada una de las 124 funciones; la clasificación **E** marca donde falta evidencia (sorteo-lecturas, `session_to_activity`).
- No se ejecutaron ni se modificaron pruebas.
- `statement_timeout` por rol proviene de `pg_roles.rolconfig`; su efecto exacto para llamadas de `service_role` vía PostgREST debería validarse empíricamente antes de diseñar `data-io`.
