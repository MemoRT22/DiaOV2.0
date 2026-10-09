# Auditoría de arquitectura backend — superficie RPC de Día OV

> Solo análisis. No se modificó código, no se crearon migraciones, no se aplicó SQL, no se desplegaron funciones, no se cambiaron grants.
> Base: `main` @ `e1f66e0` + inventario en vivo del proyecto `spoeehpziokmknecwcbd` (solo consultas de lectura) · 2026-10-05.
> Fase 9 (Portal de Talleristas) queda pausada; ver §1.5 sobre lo que ya está desplegado.
>
> **Revisión 2 — decisiones de producto incorporadas tras la primera versión:**
> 1. La reestructuración **no se pospone al después del evento**: Fase 9 no se retoma hasta haber reducido de forma sustancial y deliberada la superficie RPC administrativa (§9). Las rutas críticas siguen **congeladas salvo necesidad crítica** (§12).
> 2. Los helpers que requieren las policies/Realtime **ya no cuentan como RPC de aplicación**: nueva categoría **P — helper/primitiva de infraestructura** (§4.10, §4.12, §6.2, §15).
> 3. La deriva producción↔`main` de `workshop-intake` se resolverá en una **tarea separada de reconciliación** previa a las migraciones arquitectónicas (§1.5, §9).
>
> **Revisión 3 — dos correcciones técnicas surgidas del review:**
> 1. **Patrón Edge → SQL corregido.** `supabase-js.rpc()` usa PostgREST y PostgREST solo ve funciones de schemas **expuestos**; `service_role` omite RLS pero no esa restricción. Una Edge Function **no puede** invocar `private.fn` directamente. Patrón principal: `Edge → puente SQL service-role-only → private.fn(p_actor, …) → tablas`. Los puentes **no cuentan** como RPC cliente (§6, §8.2.1). Quedan documentadas, sin decidir, dos alternativas: schema dedicado expuesto solo a `service_role` y conexión directa a PostgreSQL.
> 2. **Feature flags corregidos.** Las variables `VITE_*` se fijan en el build: no hay rollback en runtime y no cambian los bundles ya cargados. Se sustituyen por **flags de runtime** (mecanismo a decidir en R1) con la RPC legacy viva hasta el final; el rollback por deployment es una segunda defensa, **no instantánea** (§10).

---

## 0. Resumen ejecutivo

1. **El diagnóstico es correcto, pero el matiz importa.** El backend es un "DB-as-API": las tablas de negocio no tienen privilegios para `anon`/`authenticated` y toda la lectura/escritura pasa por 73 funciones `SECURITY DEFINER` que autorizan al inicio con helpers centralizados (`require_*`). Eso es un diseño coherente y, en lo transaccional, correcto. Lo que **falta** no es "menos RPC": es una **capa HTTP de aplicación** (límites de payload, rate limiting, auditoría de lecturas de PII, descarga de archivos, orquestación, timeouts, observabilidad) para los workflows administrativos.
2. **Clasificación de las 73 funciones ejecutables por `authenticated`:** **A = 15** (RPC de aplicación intencionales), **B = 34**, **C = 8**, **D = 4**, **E = 7** y **P = 5** (helpers/primitivas de infraestructura que policies o Realtime necesitan; **no son endpoints de aplicación deseables**, §4.12).
3. **Estimación final, separando los cuatro conceptos** (detalle y criterio en §6.2/§15): **RPC de aplicación intencionales: 16–22** (hoy 15 + 7 por decidir); **helpers SQL de infraestructura: 4** (más `has_staff_role`, que ni siquiera lo requiere ninguna policy y puede pasar a interna de inmediato); **funciones SQL internas: ~92** (hoy 50); **Edge Functions: 8–9** servicios agrupados (hoy 2 + 1 pausada). Escrituras privilegiadas de Staff/Coordinación expuestas al navegador: de 32 a 4 (solo el sorteo en vivo). No se persigue un número: sale de la clasificación. Los **puentes service-role-only** entre Edge y SQL (~42, uno por operación migrada) son transporte: **no cuentan como RPC cliente** porque el navegador no puede ejecutarlos.
4. **Hallazgo técnico clave (cambia la estrategia):** todas las funciones SQL toman la identidad de `auth.uid()`. Una Edge Function que use `service_role` verá `auth.uid() = NULL`; por eso "crear Edge + revocar RPC" **no funciona sin un rediseño de identidad**. Propongo el patrón **extraer-y-envolver** (lógica a una función en el schema privado con `p_actor` explícito; la RPC pública legacy pasa a ser un wrapper de una línea) — conserva las reglas en SQL (una sola fuente de verdad) y permite strangler sin big-bang. **Corrección de la revisión 3:** como PostgREST solo ve schemas expuestos, la Edge Function no llama a `private.fn` directamente sino a través de un **puente SQL accesible solo para `service_role`** (`Edge → puente → private.fn(p_actor, …)`). Ver §6 y §8.
5. **Decisión de producto y calendario:** Fase 9 queda pausada **hasta sanear la arquitectura** (no "construir ahora → evento → corregir después"). El sistema está en `preparacion`, con 0 cuentas Staff reales, 3 participantes demo y 0 importaciones: es el momento de menor coste para reestructurar. El evento (2026-10-15) no cambia el plan; solo impone **reglas**: rutas críticas congeladas salvo necesidad crítica (reservas, check-in, sorteo y sus motores SQL), cada migración detrás de un flag con rollback, y una ventana de despliegue prudente alrededor del evento (§9.3). La secuencia propuesta (§9): reconciliación → staging/caracterización → higiene de permisos → deprecación segura → operaciones/configuración → participantes/PII → catálogo → import/export → dashboards y credenciales → reevaluar E → solo entonces valorar rutas críticas. **Criterio explícito para reanudar Fase 9 en §9.2.**
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

**Veredicto:** no deben ser el estándar tal cual. Sí sirve el *patrón* de `student-access` ("Edge → service_role → función SQL `access_lock_state`"): esa función ya es, de hecho, un **puente service-role-only en `public`** (EXECUTE solo para `service_role`, invocada con `supabase-js`), es decir, un precedente real del patrón objetivo (§8.2.1). El mejor punto de partida disponible es el **handler de `workshop-intake`** (handler/validación separados del runtime Deno, lista blanca de campos, tope de body, mapeo de errores sin filtrar internals, pruebas en Node) — hoy en la rama `claude/workshop-intake`, **sin merge a `main`**. Mejoras para el estándar: módulo `_shared/` (CORS, `json`, `Fail`, parseo seguro de body, verificación de JWT, `actor`), validación de esquema, logs solo con códigos, tests, y **no reimplementar autorización en TS** (§8.3).

### 1.5 Deriva producción ↔ `main` (importante)

`workshop-intake` **está desplegada en producción** (v1, `verify_jwt=false`) junto con 2 migraciones y 5 funciones SQL, pero **no está en `main`** (rama `claude/workshop-intake`, commit `848a88b`). Las tablas `workshop_submissions`/`workshop_submission_careers` existen vacías (la fila de la prueba de integración fue eliminada). Mientras exista, el endpoint público GET/POST acepta propuestas (modelo seguro, pero es superficie pública viva), y una de sus funciones (`workshop_submissions_set_updated_at`) tiene `EXECUTE` para `PUBLIC` (§5.2).

**Tratamiento acordado:** no se modifica esa rama ni producción en este PR. Se resolverá como una **tarea separada de reconciliación**, **previa** al inicio de las migraciones arquitectónicas (§9, bloque R-0): decidir si se mergea tal cual y se congela, si el endpoint queda inactivo o si se retira de producción hasta retomar Fase 9, y dejar `main` y producción alineados bajo la política "nada se despliega sin estar en `main`".

---

## 2. Inventario completo de funciones

### 2.1 Resumen por grupo (124 funciones en `public`)

| Grupo | Nº | Ejecutable por clientes | Ejemplos |
|---|---|---|---|
| RPC de aplicación del alumno | 11 | sí | `my_*`, `reserve_session`, `check_in`, `save_post_event_interests`, `accept_platform_notice` |
| RPC de Staff/Coordinación | 52 | sí | catálogo, participantes, import/export, tema, sorteo, operación |
| Helpers/primitivas de infraestructura **(P)** | 5 | sí (4 por requisito de policy/Realtime; `has_staff_role` ya no) | `is_operativo`, `is_coordinacion`, `has_staff_role`, `current_participant_id`, `active_edition_id` |
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

**Leyenda.** Clase: **A** mantener RPC pública (RPC de aplicación intencional) · **B** mantener SQL pero interna tras Edge · **C** migrar lógica principal a Edge · **D** candidata a deprecar · **E** requiere investigación · **P** helper/primitiva de infraestructura requerida por policy/Realtime (función PostgreSQL necesaria, **no** un endpoint de aplicación). SD = `SECURITY DEFINER` (**sí en las 73**, todas con `search_path` fijo). L/E = lectura/escritura. Crit.: criticidad en el evento. Riesgo = riesgo de migración. Tests = suites SQL que la ejercitan (✗ = sin cobertura).

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

### 4.10 Helpers / primitivas de infraestructura (P)

Estas cinco funciones **no se cuentan como RPC de aplicación**. Ningún componente de la UI las llama (§3); existen como funciones PostgreSQL porque las policies RLS y la policy de Realtime las evalúan **con los privilegios del rol que consulta**, y por eso hoy tienen `EXECUTE` para `authenticated` (y, como efecto colateral, aparecen como endpoints en `/rest/v1/rpc`).

| # | Función | Quién la necesita | Clase | ¿Requerida por policy/Realtime? | ¿Puede vivir en un schema no expuesto? |
|---|---|---|---|---|---|
| 69 | `is_operativo` | policy `activity_sessions` ("Operativos read all sessions"), policy `realtime.messages`; 5 funciones SQL | **P** | **sí** | sí (§4.12) |
| 70 | `is_coordinacion` | policies `audit_log`, `staff_roles`, `staff_members`, `theme_versions`; 2 funciones SQL | **P** | **sí** | sí (§4.12) |
| 71 | `has_staff_role` | **ninguna policy**; 12 funciones SQL (`is_*`, guards del sorteo) | **P (no requerido)** | **no**: sus llamadores son funciones `SECURITY DEFINER`, que la ejecutan como propietario | **ya mismo**: basta revocar `EXECUTE` a `authenticated` (pasa a "interna") tras verificarlo en staging |
| 72 | `current_participant_id` | policies de `attendances`, `reservations`, `initial_interests` (inertes), `post_event_interests`, y `realtime.messages`; **0 funciones SQL** | **P** | **sí** | sí (§4.12) |
| 73 | `active_edition_id` | policy `realtime.messages`; **49 funciones SQL**; Edge `staff-accounts` (vía RPC) | **P** | **sí** (Realtime) | sí, pero **mayor radio de impacto** (§4.12); podría ser `SECURITY INVOKER` (lee `editions`, pública) |

### 4.11 Recuento

| Clase | Nº | Funciones |
|---|---|---|
| **A** — RPC de aplicación intencionales | **15** | #1–7, #9–11, #14, #22–25 |
| **B** | 34 | #12–13, #15–17, #32–33, #34–39, #48–55, #56–61, #62–68 |
| **C** | 8 | imports/exports (#40–47) |
| **D** | 4 | `get_my_initial_interests`, `session_credential_display`, `regenerate_session_credential`, `session_checkin_overview` |
| **E** | 7 | `raffle_*` de lectura (6) + `session_to_activity` |
| **P** — helpers/primitivas de infraestructura | **5** | #69–73 (4 requeridos por policy/Realtime + `has_staff_role`) |
| **Total** | **73** | 15 + 34 + 8 + 4 + 7 + 5 |

Adicionales fuera de la matriz (no ejecutables por clientes): `get_pending_winner` (sin llamadores → **D**), tabla `session_credentials` (0 filas, sin policies → **D**), alias `interests_prompt/interests_open` en `my_progress` (→ **D** una vez confirmado el frontend).

### 4.12 Análisis: ¿qué helpers P pueden vivir en un schema no expuesto sin romper policies/Realtime?

**Mecanismo.** PostgREST solo expone como `/rpc/*` las funciones de los schemas configurados como expuestos (por defecto `public`). Una función en otro schema (por ejemplo `private`) **no es invocable desde el navegador**, pero una policy puede seguir llamándola si el rol que consulta tiene `USAGE` sobre el schema y `EXECUTE` sobre la función (la policy se evalúa con los privilegios del rol llamador). Es el patrón que recomienda la documentación de Supabase para helpers de RLS.

| Helper | Veredicto | Cambios necesarios (cuando se haga) | Riesgo |
|---|---|---|---|
| `has_staff_role` | **Interna ya**, sin schema nuevo | `REVOKE EXECUTE … FROM authenticated`. Sus llamadores son `SECURITY DEFINER` (se ejecutan como propietario). Verificar en staging que ningún llamador sea `INVOKER` | muy bajo |
| `is_operativo`, `is_coordinacion` | **Sí** | crear `private.is_*`; `ALTER POLICY … USING (private.is_…())` en las policies afectadas (y la de Realtime); `GRANT USAGE` en `private` y `EXECUTE` a `authenticated` solo sobre estos helpers; mantener la versión de `public` hasta cambiar los pocos llamadores SQL (5 y 2) | bajo-medio; requiere prueba de Realtime y de las policies de `staff_*`/`audit_log` (riesgo de recursión de RLS si el helper deja de ser `SECURITY DEFINER`: **debe seguir siéndolo**) |
| `current_participant_id` | **Sí** | `ALTER POLICY` en 4 tablas + Realtime; ninguna función SQL lo llama | bajo-medio (3 de las 4 policies están inertes por falta de GRANT) |
| `active_edition_id` | **Sí, pero el último** | 49 funciones lo llaman sin calificar (resuelto por `search_path = public`): añadir `private` al `search_path` de esas funciones o conservar un alias; `staff-accounts` debe dejar de usar `admin.rpc('active_edition_id')` | medio (radio amplio, beneficio mínimo: devuelve un UUID de dato público) |

**Cautelas.** (1) Validar en staging que la policy de Realtime (`realtime.messages`) evalúa correctamente helpers de un schema no expuesto con el rol del usuario (suscripción real, no solo SQL). (2) Para que el beneficio sea permanente, combinar con `ALTER DEFAULT PRIVILEGES` (§8.4) en el schema `private`. (3) Esto es **hardening conceptual, no urgente**: ninguno devuelve datos sensibles (booleanos del propio usuario o un UUID público); por eso va en el bloque R9, después de lo administrativo. (4) **Alcance de esta técnica:** lo anterior vale para policies, triggers y funciones SQL (evaluación dentro de Postgres). **No** significa que una Edge Function pueda llamar funciones de un schema no expuesto con `supabase-js`: PostgREST no las ve, ni siquiera con `service_role` (ver §8.2.1).

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
├─ RPC de aplicación INTENCIONALES (16–22) alumno + operaciones atómicas/concurrentes (reservas, check-in, sorteo en vivo)
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
            │  Edge: valida JWT → actor; valida input; límites; orquestación
            │  supabase-js .rpc()  ── PostgREST (solo ve schemas EXPUESTOS) ──
            ▼
   Puente SQL service-role-only   (en `public` al inicio; ~42, uno por operación migrada)
   • EXECUTE: solo `service_role`  (PUBLIC, anon y authenticated revocados)
   • recibe p_actor derivado del JWT validado por la Edge; sin reglas de negocio; delega de inmediato
   • NO es una RPC cliente: el navegador no puede ejecutarlo  → no cuenta en el conteo de RPC
            │
            ▼
   private.fn(p_actor, …)   schema NO expuesto — funciones reales
   • reglas de negocio, locks, atomicidad, auditoría con actor
   • re-validan el rol del actor contra las tablas (autorización final en SQL)
            │
            ▼
         tablas

   Helpers SQL de infraestructura (P): is_operativo, is_coordinacion, current_participant_id, active_edition_id
   → schema no expuesto; los usan policies/Realtime (evaluación dentro de Postgres); has_staff_role: interna
   Durante la transición coexiste la RPC legacy (wrapper de una línea → private.fn(auth.uid(), …))
```

### 6.1 Principios
1. **Postgres es dueño de las reglas** (atomicidad, constraints, locks, capacidad, unicidad, idempotencia). **Edge es dueño del protocolo** (HTTP, tamaño, formatos de archivo, orquestación de lotes, rate limit, auditoría de acceso, caché, secretos de integración).
2. **No reimplementar reglas en TypeScript.** Si la regla ya está bien en SQL, se envuelve; no se reescribe.
3. **Identidad explícita.** Edge verifica el JWT, obtiene el `actor` **solo del token validado (nunca del body)**, y la función real **vuelve a comprobar** que ese actor tiene el rol (no se confía ciegamente en Edge).
4. **Deny-by-default también para funciones**: las funciones reales viven en un schema no expuesto (`private`), donde el navegador no puede alcanzarlas por construcción y no por `REVOKE` manual.
5. **PostgREST es el transporte, y solo ve schemas expuestos.** Por eso la Edge Function no llama a `private.*`: llama a un **puente service-role-only** que delega en la función real. El puente es transporte, no lógica.
6. **Una frontera por dominio**, no una por función.

### 6.2 Cantidades estimadas (con criterio) — cuatro conceptos distintos

| Concepto | Hoy | Objetivo | Criterio |
|---|---|---|---|
| **RPC de aplicación intencionales** (endpoints que la UI llama) | 15 (A) + 7 sin decidir (E) | **16–22** | A (15) + lecturas del sorteo consolidadas (1–6, tras evaluar clase E) + `session_to_activity` (0–1) |
| **Helpers SQL de infraestructura (P)** | 5 expuestos como RPC | **4** (no endpoints; schema no expuesto) | `is_operativo`, `is_coordinacion`, `current_participant_id`, `active_edition_id`; `has_staff_role` pasa a interna de inmediato |
| **Funciones SQL internas** (no ejecutables por clientes) | 50 | **~92** | +34 B +8 C +1 `has_staff_role`; −1 `get_pending_winner`; los 4 D se retiran |
| **Edge Functions** | 2 (+1 pausada) | **8–9** | 6 nuevas + 2 existentes (+ intake) |
| **Puentes SQL service-role-only** (transporte Edge → `private.fn`) | 0 (precedente: `access_lock_state`) | **~42** | uno por operación migrada de clase B/C; **no son RPC cliente y no entran en el conteo de RPC** (el navegador no puede ejecutarlos); pueden vivir en `public` al inicio |

Métricas derivadas (informativas, no objetivos):

| | Hoy | Objetivo |
|---|---|---|
| Funciones ejecutables por `authenticated` vía `/rpc` | 73 | 16–22 intencionales (+ 4 P mientras no se muevan de schema → 20–26) |
| Reducción de superficie RPC | — | **−64 % a −73 %** con P pendientes; **−70 % a −78 %** con P ya movidas |
| Escrituras privilegiadas Staff/Coord. expuestas al navegador | 32 | **4** (`draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner`) |
| Escrituras totales expuestas | 38 | ~10 (las 4 anteriores + 6 del alumno) |

Los puentes se cuentan aparte a propósito: tienen `EXECUTE` solo para `service_role`, así que no forman parte de la superficie que un usuario puede invocar. La suite `security_surface` los verifica con una lista explícita (§11.2). No hay una cifra objetivo "a priori": sale de la clasificación. Si el sorteo en vivo tuviera también fachada (no recomendado, §12), el piso de RPC de aplicación sería 11–12.

---

## 7. Agrupación recomendada de Edge Functions

| Servicio | Contrato (acciones) | SQL real (schema `private`) a la que llega vía puente | Ventajas | Desventajas / riesgos |
|---|---|---|---|---|
| `participant-admin` | `search`, `get`, `create`, `update`, `access_diagnosis`, `clear_access_lock` | `update_participant`, `create_participant_manual`, `get_participant`, `search_participants`, `access_*` (reglas de overrides, alias, historial) | autorización y registro de **lecturas de PII** en un punto; límites de resultados; errores uniformes | un hop más en el typeahead; `update_participant` es la pieza más compleja: no se reescribe |
| `catalog-admin` | CRUD de divisiones/carreras/talleres/sesiones, `set_location`, carreras afines, `reservation_counts` | `save_*`, `delete_*`, `set_session_location` + triggers existentes | prerrequisito natural de la **publicación de propuestas (Fase 9)** (varios pasos: actividad + sesiones + carreras + credencial) | CRUD simple: la ganancia de seguridad es modesta; el valor es de orquestación futura |
| `data-io` | `import/preview`, `import/commit`, `import/conflicts`, `export/{participants,vocational}` | `process_*_import` (se conservan), nuevas `export_*_internal` paginadas | lotes con progreso e idempotencia, parseo de archivos en servidor, descargas con `Content-Disposition` y auditoría, evita acumular PII en el navegador | **mayor riesgo de regresión** (15 KB de reglas); PostgREST/`authenticator` aplica 8 s por llamada → hay que **dividir en lotes** (Edge no elimina el timeout si usa supabase-js) |
| `operations` | `overview`, `summary`, `roster/declare|reopen`, `demo/purge_preview|purge`, `real/activate`, `theme/emergency_unlock` | `event_operations_overview`, `coordination_summary`, `declare_official_roster`, `purge_demo_data`, `activate_real_operation` | caché corta de dashboards; salvaguardas HTTP (step-up/re-auth, frase, doble confirmación) para acciones irreversibles; auditoría | las acciones destructivas hoy tienen **cero pruebas**: caracterizar antes |
| `event-config` | tema (`draft/publish/restore/relock`), `rank_rules`, `reservation_settings`, `raffle config` | `save_theme_draft`, `publish_theme_draft`, …, `update_*` | una sola puerta de configuración y de auditoría | volumen bajo; ganancia moderada |
| `checkin-admin` | `credential/display`, `credential/regenerate` | `activity_credential_display`, `regenerate_activity_credential`, `rotate_*` | `no-store`, límite por usuario, registro de quién vio/rotó secretos | pequeño; se puede fusionar en `operations` si se quiere menos servicios |
| `raffle` (opcional, **al final**) | lecturas consolidadas + `save_*` de config | `raffle_*` | 6 lecturas → 1 contrato | toca el sorteo en vivo: último (R9), fuera de la ventana del evento y tras evaluar la clase E |

**Por qué agrupar y no 1:1:** menos despliegues y superficie, autorización y logging compartidos (`_shared/`), contratos cohesivos por pantalla/rol. **Contra:** funciones grandes se vuelven un "mini monolito" por dominio; mitigación: handler por acción + validación por acción + pruebas por acción (patrón del handler de `workshop-intake`).

**Qué NO va a Edge:** reservas, cancelación, cambio, check-in, intereses, lecturas del propio alumno, acciones del sorteo en vivo (§12).

---

## 8. Estrategia de migración incremental

### 8.1 Evaluación de la secuencia de 10 pasos propuesta
La secuencia es sensata en espíritu pero tiene **tres huecos**:

1. **Falta el paso 0: caracterización.** 27 de las 73 RPC no tienen prueba (`access_diagnosis`, `activate_real_operation`, `clear_access_lock`, `commit/preview_catalog_import`, `coordination_summary`, `delete_activity`, `demo_purge_preview`, `emergency_unlock_theme`, `export_vocational`, `list/resolve_import_conflict(s)`, `my_raffle_status`, `publish/restore/relock/save_theme*`, `purge_demo_data`, `raffle_operator_view/pool_count/prizes_read`, `save_activity_careers/career/division`, `save_raffle_category`, `search_participants`, `update_rank_rules`). No se debe mover lo que no se puede verificar.
2. **"Crear Edge equivalente + revocar" ignora la identidad y el transporte.** Las funciones usan `auth.uid()`; con `service_role` es `NULL`, así que los guards fallarían y la auditoría perdería al actor. Y si además la lógica se mueve a un schema no expuesto, `supabase-js` (PostgREST) **no puede llamarla**, ni siquiera con `service_role`: hace falta un puente (§8.2.1).
3. **Falta un mecanismo de rollback en runtime durante la convivencia.** La primera versión de este documento proponía `VITE_USE_EDGE_<MODULO>`; eso **no** es rollback rápido: se sustituye en el build y exige recompilar y redesplegar, y no afecta a pestañas ya abiertas. Se reemplaza por flags de runtime (§10).

### 8.2 Estrategia propuesta: "extraer y envolver" (strangler con identidad explícita)

Por cada función de clase B/C (`private` = schema no expuesto; los nombres definitivos de puentes y funciones **no se fijan todavía**):

| Paso | Acción | Cambia comportamiento | Reversible |
|---|---|---|---|
| 1 | **Caracterizar**: prueba SQL de entradas/salidas actuales (golden JSON) | no | — |
| 2 | **Extraer**: mover el cuerpo a `private.fn(p_actor uuid, …)`; la guard pasa a una variante con actor (`require_*_for(p_actor)`); `write_audit` recibe el actor | no | sí |
| 3 | **Envolver la RPC legacy**: queda con la misma firma y pasa a `RETURN private.fn(auth.uid(), …)` (1 línea). Se corren las suites existentes | **no** | sí |
| 4 | **Crear el puente service-role-only**: `public.<puente>(p_actor, …)` que delega de inmediato en `private.fn(p_actor, …)`; `PUBLIC`/`anon`/`authenticated` sin `EXECUTE`, `service_role` con `EXECUTE`; sin reglas de negocio | no (nadie lo usa aún) | sí |
| 5 | **Edge Function**: verifica el JWT, valida input, resuelve el `actor` del token, y llama al puente con `supabase-js` y `service_role`. Pruebas del handler + **equivalencia** legacy vs Edge | no (misma regla, nueva frontera) | sí |
| 6 | **Frontend de doble ruta**: el cliente tipado trae **ambas** rutas (RPC legacy y Edge) y un **flag de runtime** (§10) decide cuál usa; por defecto, legacy | no | sí (flag, sin redeploy) |
| 7 | **Equivalencia en vivo**: mismo resultado por ambas rutas en staging y luego en producción; activación gradual (por rol/ámbito) | — | sí (flag) |
| 8 | **Edge pasa a ser el default** (cambio del flag) y **observación** durante un ciclo completo de uso | no | sí (flag) |
| 9 | **Recién después, `REVOKE EXECUTE` de la RPC legacy** a `authenticated` (versión mínima de bundle soportada ya forzada, §10) | sí | sí (re-grant) |
| 10 | **Más adelante, `DROP` de la RPC legacy** cuando no queden bundles antiguos; se conservan el puente y `private.fn` | — | — |

Ventajas: una sola fuente de verdad (la función en `private`); los pasos 2–3 se prueban con las suites que ya existen; la RPC legacy sigue viva y el flag decide el consumidor mientras se demuestra la equivalencia; la revocación es el último paso reversible.

#### 8.2.1 Por qué hace falta un puente (restricción de PostgREST) y qué opciones hay

`supabase-js.rpc()` llama a PostgREST, y PostgREST solo puede acceder a funciones de los **schemas expuestos** (hoy `public`). `service_role` omite RLS pero **no** esa restricción: una Edge Function no puede invocar `private.fn` directamente. La versión anterior de este documento lo daba por posible; era incorrecto.

**Opción por defecto para la migración inicial: puente service-role-only + funciones reales en schema privado.**

```
React → Edge Function → puente SQL (solo service_role) → private.fn(p_actor, …) → tablas
```

Características del puente: puede permanecer temporalmente en `public` (o evaluarse luego un schema de API interno expuesto); `PUBLIC` revocado; `anon` sin `EXECUTE`; `authenticated` sin `EXECUTE`; `service_role` con `EXECUTE`; recibe `p_actor` derivado del JWT que la Edge Function ya validó; **no contiene reglas de negocio importantes** y delega de inmediato; **no se cuenta como RPC pública de aplicación**. Ejemplo conceptual (nombres no definitivos):

```
public.edge_update_participant_internal_bridge(p_actor uuid, p_payload jsonb)
   → private.update_participant(p_actor, p_payload)
```

Por qué es la opción por defecto: mantiene `supabase-js`, **evita introducir credenciales directas de PostgreSQL** en las Edge Functions y mantiene una separación clara entre transporte (puente) y lógica (`private`). Hay precedente en producción: `access_lock_state` ya es una función de `public` solo ejecutable por `service_role` que `student-access` invoca así.

**Salvaguardas del patrón:**
- `p_actor` solo puede venir de la Edge Function (token validado), nunca del body del cliente; como el puente es service-role-only, el navegador no puede falsificarlo. La clave `service_role` jamás sale del runtime de la función. `private.fn` **re-valida** el rol del actor contra las tablas, de modo que un error de la Edge no concede privilegios por sí solo.
- Los puentes viven en `public`, donde Supabase otorga `EXECUTE` por defecto a `anon`/`authenticated`: cada uno exige `REVOKE` explícito, y `ALTER DEFAULT PRIVILEGES` (R2) elimina ese riesgo para los nuevos. `security_surface` verifica con una lista explícita (o una marca estable, p. ej. un `COMMENT`) que **todo puente sea service-role-only** y que ninguna función de `private` sea ejecutable por clientes.
- Detalle de diseño pendiente (R1): puente `SECURITY INVOKER` (corre como `service_role`, con `USAGE` en `private` y `EXECUTE` solo sobre las funciones concretas) frente a `SECURITY DEFINER`; se prefiere `INVOKER` para que el puente no sea otro punto de elevación de privilegios.
- Sin coste de duplicación: durante la transición existen la RPC legacy (con `auth.uid()`) y el puente (con `p_actor`), pero ambos delegan en la misma `private.fn`.

**Alternativas documentadas (no son la decisión actual):**

| Alternativa | Cómo sería | A favor | En contra |
|---|---|---|---|
| **A. Schema dedicado expuesto solo a `service_role`** | un schema de API interno añadido a los schemas expuestos de PostgREST; `USAGE` y `EXECUTE` únicamente para `service_role`; `supabase-js` con `db: { schema }` | saca los puentes de `public`; reduce la clase de error por defaults | requiere cambiar la configuración de la API (schemas expuestos); más piezas que mantener; el schema aparece en la configuración de PostgREST |
| **B. Conexión directa PostgreSQL desde la Edge Function** | cliente Postgres con una credencial de base de datos (idealmente un rol dedicado, vía pooler); `SET LOCAL` de claims o llamada directa a `private.fn` | no necesita puentes; transacciones multi-sentencia reales; mejor para trabajos largos (importaciones, exportaciones) | introduce **credenciales de base de datos** como secreto de las Edge Functions; gestión de conexiones/pooling; se aparta de `supabase-js`; requiere un rol de base de datos dedicado y bien acotado |

La opción B puede reevaluarse específicamente para `data-io` en R1/R7 si los tiempos por llamada (PostgREST, 8 s en `authenticator`/`authenticated`; efecto exacto para `service_role` por validar) obligan a lotes demasiado pequeños.

### 8.3 Autorización en la fachada
Edge **no reimplementa** `require_coordinacion` en TS: verifica el JWT, extrae el `actor` del token validado, llama al puente con ese `actor`, y la función en `private` **re-valida** el rol del `actor` contra `staff_roles`/`staff_members` (misma lógica SQL actual, con parámetro). Así `staff-accounts` también debería migrar a "Edge → puente → `private` con `p_actor`" (hoy duplica la regla en TS).

### 8.4 Cambios estructurales de apoyo (propuestos, no hechos)
1. **Schema `private`** para las funciones reales; `public` solo con la superficie intencional **más los puentes service-role-only** (transitoriamente). Las policies pueden llamar helpers en `private` si `authenticated` tiene `USAGE` y `EXECUTE` sobre ellos (evaluación dentro de Postgres); la Edge Function accede a `private` **solo a través de puentes** (§8.2.1).
2. **`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated`** (y revocar privilegios de tabla sobrantes): elimina la clase de error de §5.2/§5.1, incluida la de olvidar el `REVOKE` de un puente.
3. **Cliente tipado en el frontend**: sustituir `rpc<T>(name)` por módulos `src/lib/api/<dominio>.ts` con tipos generados (`supabase gen types`) y una regla ESLint que prohíba `supabase.rpc`/`from()` fuera de `src/lib/api/**`: obliga a que nuevas superficies sean una decisión explícita. Estos módulos traen la **doble ruta** (legacy/Edge) gobernada por el flag de runtime.
4. **Entorno de pruebas aislado** (rama/proyecto de staging de Supabase) y un runner (psql/`supabase db query` en CI) en lugar de pegar SQL en producción.
5. **Mecanismo de flags de runtime** (§10): se decide en R1.

---

## 9. Orden de ejecución sugerido (por bloques)

### 9.1 Decisión de producto y principios

**Decisión:** no continuar Fase 9 hasta haber reducido de forma sustancial y deliberada la superficie RPC administrativa. El camino es

```
pausar Fase 9 → sanear la arquitectura de forma incremental → retomar desarrollo sobre la nueva frontera
```

y **no** "seguir construyendo → evento → corregir después". Esto **no** implica tocar indiscriminadamente las rutas críticas:

- **Congeladas salvo necesidad crítica:** `reserve_session`, `change_reservation`, `cancel_reservation`, `check_in`, `draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner` y los motores SQL transaccionales relacionados (`assert_reservable`, `expire_past_reservation`, `session_reserved_count`, `active_reservation_count`, `broadcast_availability`, `resolve_credential` y demás credenciales, y los helpers de selección/sorteo).
- Todo lo demás se sanea por bloques, cada uno con: caracterización previa, extraer-y-envolver (con puente service-role-only, §8.2.1), flag de runtime para elegir consumidor, equivalencia, y revocación como último paso reversible (§8, §10). El rollback por deployment es una segunda defensa, no instantánea.

### 9.2 Bloques

El orden recibido se adopta, con **ajustes** señalados con ▲ (justificados en §9.3).

| Bloque | Contenido | Riesgo | Gate de salida |
|---|---|---|---|
| **R-0 ▲ Reconciliación `workshop-intake`** (tarea separada) | decidir mergear/congelar, desactivar o retirar la función, tablas y funciones SQL de la Fase 9; alinear `main` y producción; corregir el `EXECUTE` de `PUBLIC` de su trigger | bajo | `main` ≡ producción (esquema, funciones, Edge); política "nada se despliega sin estar en `main`" |
| **R1 — Baseline, staging y caracterización** | proyecto/rama de **staging** de Supabase; runner de pruebas que ya no pega SQL en producción; correr las 14 suites existentes como línea base; **caracterización de las 27 RPC sin cobertura** (empezando por `purge_demo_data`, `activate_real_operation`, tema, catálogo, conflictos, `export_vocational`); `regression_security_surface.sql` en modo informe; cliente tipado + regla ESLint (andamiaje, sin cambio de comportamiento); **decisiones de diseño de R1:** (a) mecanismo de **flags de runtime** (§10), (b) convención de puentes service-role-only (nombres, marca, `INVOKER`/`DEFINER`, §8.2.1) y su verificación en `security_surface`, (c) evaluar la alternativa B (conexión directa) para `data-io` | muy bajo | staging verde; línea base registrada; 27 caracterizadas; mecanismo de flags y convención de puentes decididos |
| **R2 — Higiene de permisos y default privileges** | revocar `TRUNCATE`/`REFERENCES`/`TRIGGER` a `anon`/`authenticated`; cerrar `participant_email_history`; revocar `SELECT` residual en `post_event_interests`; `ALTER DEFAULT PRIVILEGES` (funciones y tablas) para que lo nuevo nazca sin acceso de clientes; revocar `has_staff_role` a `authenticated`. **Primero en staging**, luego producción | bajo (no afecta a la Data API ni a contratos) | `security_surface` en modo bloqueante y verde |
| **R3 ▲ Deprecación/eliminación claramente segura (D)** | **deprecar = revocar `EXECUTE` (reversible)** de `get_my_initial_interests`, `session_credential_display`, `regenerate_session_credential`, `session_checkin_overview`; retirar `get_pending_winner`, tabla `session_credentials`, alias de `my_progress`; retirar la parte legacy de `regression_asistencia.sql`. Verificar ausencia de llamadas reales con `pg_stat_statements` antes de borrar | bajo | 0 funciones D ejecutables; suites verdes |
| **R4 — Operaciones y configuración administrativa de bajo volumen** | `operations` (zona de peligro: `purge_demo_data`, `activate_real_operation`, `emergency_unlock_theme`; roster `declare/reopen`) y `event-config` (tema, rangos, ventanas de reserva, config de sorteo); ▲ aquí también se **endurece `staff-accounts`** al estándar `_shared` (autorización por actor en SQL, sin escrituras multi-paso no atómicas) | medio (pocas llamadas, alto impacto) → caracterizadas en R1 | B de estos grupos no ejecutable por `authenticated`; flags de runtime retirables |
| **R5 — Participantes / PII** | `participant-admin` (`search`, `get`, `create`, `update`, diagnóstico y desbloqueo de acceso) con auditoría de lecturas de PII | medio-alto (`update_participant`: se envuelve, no se reescribe) | idem |
| **R6 — Catálogo** | `catalog-admin` (divisiones, carreras, talleres, sesiones, carreras afines, ubicación, conteos) | bajo-medio | idem; prerrequisito técnico de la publicación de propuestas (Fase 9) |
| **R7 ▲ Import/export** | `data-io`: **exportaciones primero** (solo lectura), luego previews/conflictos, luego commits **al final y tras un dry-run completo en staging con archivos reales**; ▲ el cut-over del `commit_participant_import` se hace con el flag de runtime en *legacy* por defecto y se cambia solo cuando la carga del roster real no dependa de esa ruta o ya esté probada con el archivo real | alto en commits | equivalencia de preview/commit; lotes e idempotencia |
| **R8 — Dashboards y credenciales administrativas** | `operations` (overview/summary/checkin overview, caché corta) y `checkin-admin` (`activity_credential_display`, `regenerate_activity_credential`) | bajo | idem |
| **R9 ▲ Reevaluación de las clases E y de P** | decidir las 6 lecturas del sorteo (consolidar o mantener), `session_to_activity` (D si ya no existen rutas por `session_id`); mover los helpers P a schema no expuesto (§4.12), `active_edition_id` el último | medio (Realtime) | superficie final medida |
| **R10 — Rutas críticas (solo valoración)** | **solo después** de R1–R9: evaluar si algo de reservas/check-in/sorteo justifica fachada; el único candidato con argumento hoy es el **throttle de `check_in`** (§5.4), preferiblemente **en SQL**. Si el riesgo se considerara crítico antes, sería una **excepción explícita** al congelamiento, no un bloque del plan | alto | decisión documentada |

**Criterio de reanudación de Fase 9 (propuesto):** retomar la Fase 9 cuando se cumpla todo lo siguiente: (1) R-0 cerrado; (2) R1–R7 completos, es decir, **ninguna función B o C ejecutable por `authenticated`** y ningún flujo administrativo con escritura directa desde el navegador salvo el sorteo en vivo; (3) D retiradas (R3); (4) `regression_security_surface` bloqueante y verde en staging y producción; (5) `catalog-admin` y el patrón `_shared` disponibles para construir sobre ellos el CRUD/publicación de propuestas; (6) wrappers públicos revocados o con fecha de retiro. R8–R10 pueden solaparse con el desarrollo de Fase 9 porque no son prerrequisito de su frontera.

### 9.3 Ajustes al orden recibido y por qué

1. **R-0 antes de todo.** No se debe migrar sobre una base donde producción y `main` difieren; además la Fase 9 depende del resultado (qué pasa con `workshop-intake`).
2. **Staging (R1) bloquea todo lo demás.** Hoy las pruebas se ejecutan contra producción (§5.3); ampliar suites y migrar sin staging aumenta el riesgo.
3. **R2 después de staging, no antes.** Aunque es de bajo riesgo, los `REVOKE`/`DEFAULT PRIVILEGES` deben ensayarse donde se pueda comprobar login, roles, Realtime y todas las suites.
4. **R3: deprecar antes que borrar.** Revocar es reversible con un `GRANT`; borrar no. `pg_stat_statements` está instalado y permite comprobar llamadas reales.
5. **R4 incluye `staff-accounts`.** Es la única Edge Function administrativa existente y comparte el patrón que queremos corregir (§1.4); no tiene sentido crear servicios nuevos con el estándar nuevo y dejar el viejo sin alinear.
6. **R7: los commits de importación al final y con flag de runtime.** El roster real se carga con esa ruta antes del evento; el cut-over solo se hace con equivalencia demostrada en staging con el archivo real.
7. **R9 agrupa E y P; R10 es solo valoración.** Coincide con el orden recibido (reevaluar E; solo después valorar rutas críticas) y evita tocar Realtime hasta que lo administrativo esté estable.

**Regla de ventana de despliegue (propuesta, no un aplazamiento del plan):** como el evento es el 2026-10-15, conviene no cambiar el consumidor por defecto (flags de runtime) ni aplicar migraciones de privilegios en las ~72 h previas ni durante el evento; los bloques continúan fuera de esa ventana. Las rutas críticas permanecen congeladas todo el tiempo salvo necesidad crítica.

**Órdenes alternativos considerados:** empezar por `data-io` (mayor valor técnico) → descartado por riesgo; empezar por catálogo (más simple) → válido, pero operaciones/configuración tienen mejor relación valor/riesgo y hoy cero cobertura.

---

## 10. Compatibilidad temporal y flags de runtime

### 10.1 Invariantes
(1) la RPC legacy mantiene firma y resultado hasta el paso 9 de §8.2; (2) un solo lugar con la regla (`private.fn`); (3) cambios de contrato y de backend nunca en el mismo paso; (4) nada se revoca ni se borra antes de migrar *todos* los consumidores y observar.

### 10.2 Por qué `VITE_*` no sirve como rollback
Las variables `VITE_*` se sustituyen **durante el build**: cambiar el valor exige recompilar y redesplegar, y no afecta a los bundles que ya cargaron las pestañas abiertas. Sirven para configuración de despliegue, no para conmutar comportamiento en runtime. Esta estrategia **sustituye** a la propuesta original (`VITE_USE_EDGE_<MODULO>`).

### 10.3 Flag de runtime
Conceptualmente:

```
frontend arranca → obtiene configuración runtime → decide Edge vs RPC legacy (por módulo)
```

El valor debe poder cambiar **sin recompilar** el frontend. Opciones apropiadas para este sistema (el mecanismo definitivo se decide en R1; no se implementa todavía):

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Configuración remota de edición** | una columna/objeto de configuración en `editions` (el frontend ya lee `editions` al arrancar, `ThemeProvider`) | cero peticiones extra; encaja con el modelo actual; editable por SQL o por una pantalla de Coordinación | legible por `anon` (la tabla es pública): el estado de la migración sería visible, sin secretos; granularidad limitada (sin por-rol salvo convención); necesita refresco para afectar pestañas abiertas |
| **B. Tabla de feature flags de lectura controlada** | tabla `(clave, valor, ámbito/rol, actualizado)` con policy de lectura por rol | granular por módulo y por rol (Staff antes que Coordinación, etc.); auditable; permite activación gradual | pieza nueva (tabla, policy, pantalla); otra superficie a cubrir en `security_surface` |
| **C. Endpoint de configuración runtime** | una Edge Function `runtime-config` (GET) que combina flags y versión mínima y puede decidir por usuario | decisión por usuario/porcentaje; un solo contrato; puede incluir "versión mínima soportada" | un salto más al arrancar y un servicio más; si cae, hay que definir el valor por defecto |

Orientación inicial (no decisión): A para empezar, evolucionable a B si se necesita granularidad por rol; C solo si se requiere decisión por usuario.

**Propiedades exigidas, sea cual sea el mecanismo:**
- Cambia **sin recompilar** y **sin redesplegar**.
- Se lee al arrancar **y se refresca** (al volver el foco a la pestaña, cada cierto intervalo, o antes de una acción crítica) para alcanzar pestañas abiertas; en operaciones de escritura se consulta el valor **al momento de la acción**, no solo al inicio.
- Es **por módulo** (no global) y permite volver a *legacy* de forma inmediata (interruptor de emergencia).
- Valor por defecto seguro si no se puede leer la configuración: ruta *legacy*.
- Estable durante un flujo (no cambiar de ruta a mitad de un asistente de varios pasos).
- Los cambios del flag quedan **auditados**; no contiene secretos.
- Incluye una **versión mínima de bundle soportada**: antes de revocar la RPC legacy, los clientes viejos reciben la instrucción de recargar (si no, dejarían de funcionar).
- El cliente trae **ambas rutas en el mismo bundle** desde antes del primer cut-over; un bundle "solo Edge" no podría volver atrás.
- Cualquier *fallback* automático (Edge falla → RPC legacy) solo es válido para operaciones idempotentes o con clave de idempotencia; en escrituras no idempotentes podría duplicar efectos.

### 10.4 Secuencia de transición

```
RPC legacy sigue viva
+ Edge nueva disponible
+ flag de runtime decide el consumidor (default: legacy)
+ equivalencia comprobada
+ Edge se vuelve default (cambio del flag)
+ observación
+ recién después REVOKE de la RPC legacy (y DROP más adelante)
```

### 10.5 Rollback: dos defensas, con límites distintos

| Defensa | Velocidad | Alcance |
|---|---|---|
| **Flag de runtime → *legacy*** | **inmediata** (sin recompilar) en cuanto los clientes refrescan la configuración | pestañas abiertas incluidas, si implementan el refresco de §10.3 |
| **Rollback por deployment** (volver a un bundle/Edge anterior) | **no instantáneo**: requiere redesplegar, y los bundles ya cargados siguen ejecutándose hasta recargar | segunda defensa, no el mecanismo principal |
| Re-grant de la RPC legacy (tras el paso 9) | inmediato en base de datos (1 sentencia) | solo útil si el flag aún puede enviar tráfico a *legacy* |

### 10.6 Otros puntos de compatibilidad
- **Versionado de contrato Edge** (`/v1` o campo `version`) para evolucionar sin romper clientes en caché (PWA/pestañas abiertas durante el evento).
- **Realtime y reservas** no cambian de frontera: no hay convivencia que gestionar.
- **Frontend nuevo → Edge / frontend viejo → RPC legacy**: posible porque la RPC legacy se conserva hasta el paso 9 y el flag decide el consumidor.

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
6. **Verificación de puentes en `security_surface`:** todo puente tiene `EXECUTE` solo para `service_role`; ninguna función de `private` es ejecutable por `anon`/`authenticated` (salvo los helpers P que las policies requieren); ningún puente contiene reglas (delegación pura, revisable por tamaño/forma).
7. **Pruebas del flag de runtime:** valor por defecto seguro, refresco en pestaña abierta, interruptor de emergencia a *legacy*, versión mínima de bundle, y equivalencia legacy vs Edge con el flag en cada posición.

### 11.3 Qué ejecutar tras cada bloque

Los identificadores corresponden a los bloques de §9.2. Las suites de reservaciones, check-in y sorteo se ejecutan en **todos** los bloques como protección de las rutas congeladas (no se espera que cambien).

| Bloque | Obligatorias | Nuevas |
|---|---|---|
| R-0 (reconciliación) | todas las existentes + `regression_workshop_intake` (si el modelo se conserva) + `security_surface` | verificación de que esquema/funciones/Edge de producción ≡ `main` |
| R1 (baseline/staging) | todas las existentes en staging (línea base) | caracterización de las 27 RPC sin cobertura; `security_surface` en modo informe |
| R2 (permisos/default privileges) | todas + `security_surface` (bloqueante) | smoke de login (participante y Staff), policies y suscripción Realtime tras los `REVOKE` |
| R3 (limpieza D) | **todas** + `security_surface` | actualizar/retirar la parte legacy de `regression_asistencia`; verificación de llamadas reales con `pg_stat_statements` |
| R4 (operaciones/config + `staff-accounts`) | `operaciones`, `correcciones` (roster), `reservaciones` (ventanas), `security_surface` | caracterización de purge/activate/tema; equivalencia; pruebas de `staff-accounts` (atomicidad, `LAST_COORDINATOR`) |
| R5 (participantes) | `correcciones`, `initial_interests`, `reservaciones`, `post_event_interests`, `security_surface` | equivalencia + prueba de auditoría de lecturas PII |
| R6 (catálogo) | `correcciones`, `reservaciones` (guard de sesiones), `fase8c`, `activity_credentials` (credencial por trigger) | caracterización de division/career/activity_careers |
| R7 (data-io) | `correcciones`, `initial_interests`, `post_event_interests`, `operaciones`, `security_surface` | equivalencia de import (preview/commit), lotes e idempotencia, export con descarga |
| R8 (dashboards/credenciales) | `operaciones`, `test_operationsHelpers`, `activity_credentials`, `fase8c`, `concurrency_checkin` | caché de dashboards; `no-store` en credenciales |
| R9 (clases E y helpers P) | `sorteo`, `concurrency_sorteo`, `security_surface`, pruebas de policies | ensayo de suscripción Realtime con helpers en schema no expuesto |
| R10 (rutas críticas, solo si se decide) | `reservaciones`, `fase8c`, `concurrency_reservations`, `activity_credentials`, `asistencia`, `concurrency_checkin`, `sorteo`, `concurrency_sorteo` | según el cambio |

---

## 12. Funciones que NO tocaría (y por qué)

**Estado:** congeladas **salvo necesidad crítica** (decisión de producto). La lista se mantiene aunque la reestructuración avance antes de retomar Fase 9.

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
| Helpers P requeridos por policies/Realtime (`is_operativo`, `is_coordinacion`, `current_participant_id`, `active_edition_id`) y la policy de Realtime | siguen siendo funciones PostgreSQL; solo cambiaría **dónde viven** (schema no expuesto, R9), nunca su lógica. `has_staff_role` es la excepción: no lo requiere ninguna policy |
| Triggers (`guard_*`, `after_session_change`, `sync_participant_profile`) | invariantes en la base |
| `student-access` | es la puerta de entrada de los alumnos; solo **endurecer** (no mover); congelada salvo necesidad crítica |

---

## 13. Funciones prioritarias para migrar (por valor/riesgo)

*Lista por valor/riesgo; el orden de ejecución lo fija §9 (R4 → R8).*

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
| 1 | **Identidad perdida** al pasar a `service_role` (`auth.uid()=NULL`) | patrón `p_actor` derivado del JWT validado + re-validación del rol en SQL (§8.3); prueba de auditoría del actor |
| 2 | **Regresión en reglas complejas** (imports, `update_participant`) | envolver, no reescribir; caracterización + equivalencia por función |
| 3 | **Calendario**: evento el 2026-10-15 con la reestructuración en curso | rutas críticas congeladas; flags de runtime con rollback inmediato (el rollback por deployment es una segunda defensa, no instantánea); ventana de despliegue prudente alrededor del evento (§9.3); cada bloque cierra con suites verdes en staging |
| 4 | **Doble fuente de verdad** (TS y SQL) | prohibido reimplementar reglas en TS; revisión de diseño por función |
| 5 | **Timeouts** no resueltos por Edge (`authenticator` 8 s al usar PostgREST) | lotes; si se requiere trabajo largo, conexión directa a Postgres desde Edge |
| 6 | **Pruebas contra producción** | staging/rama de Supabase antes de ampliar suites |
| 7 | **Mini-monolitos por servicio** | handler/validación por acción, módulos compartidos `_shared/` |
| 8 | **Clientes antiguos** (pestañas/PWA abiertas) | versionado de contrato; RPC legacy viva hasta observar; versión mínima de bundle en la configuración runtime; refresco del flag en pestañas abiertas (§10.3) |
| 9 | **Hop extra** en rutas calientes | por eso reservas/check-in/sorteo quedan fuera |
| 10 | **Deriva** producción↔`main` (intake desplegado sin merge) | tarea separada R-0 antes de cualquier migración (§1.5, §9); política "nada se despliega sin estar en `main`" |
| 11 | **Revocar demasiado pronto** | revocación = último paso, reversible (re-grant) |
| 12 | **Función nueva sin guard** | prueba automática de superficie (§11.2-1) |
| 13 | **Presión por retomar Fase 9** antes de terminar el saneamiento | criterio de reanudación explícito y medible (§9.2) |
| 14 | **Mover helpers P a un schema no expuesto** rompe policies/Realtime si se hace mal | solo en R9, tras ensayo con suscripción Realtime real en staging; `is_*` siguen siendo `SECURITY DEFINER` (§4.12) |
| 15 | **Asumir que Edge puede llamar a `private.*` con `supabase-js`** (PostgREST solo ve schemas expuestos) | patrón con puente service-role-only (§8.2.1); alternativas A/B documentadas; verificación temprana en staging |
| 16 | **Puente mal protegido** (olvidar el `REVOKE` en `public` → ejecutable por clientes con `p_actor` arbitrario) | `ALTER DEFAULT PRIVILEGES` (R2), verificación en `security_surface`, convención de puentes decidida en R1, `private.fn` re-valida el rol del actor |
| 17 | **Flag de runtime mal diseñado** (no refresca, valor por defecto inseguro, fallback duplica escrituras) | propiedades exigidas en §10.3; pruebas del flag (§11.2-7) |

---

## 15. Estimación final de la superficie

Se separan cuatro conceptos que antes se mezclaban. No se persigue un número: es el resultado de la clasificación.

### 15.1 RPC de aplicación intencionales (endpoints que la UI llama)

| Componente | Nº |
|---|---|
| Alumno | 8 (`accept_platform_notice`, `my_progress`, `my_reservation_board`, `my_recommended_activities`, `my_post_event_interests`, `save_post_event_interests`, `my_raffle_status`, `check_in`) |
| Reservas | 3 (`reserve_session`, `change_reservation`, `cancel_reservation`) |
| Sorteo en vivo (escrituras) | 4 (`draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner`) |
| Sorteo en vivo (lecturas, clase E) | 1–6 (hoy 6; se decide en R9) |
| `session_to_activity` (clase E) | 0–1 |
| **Total estimado** | **16–22** (hoy 15 + 7 por decidir; la superficie total hoy es 73) |

### 15.2 Helpers SQL de infraestructura (P)

| Estado | Nº |
|---|---|
| Hoy | 5, expuestos como `/rpc` aunque no son endpoints |
| Objetivo | **4** (`is_operativo`, `is_coordinacion`, `current_participant_id`, `active_edition_id`) viviendo en un schema no expuesto y usados solo por policies/Realtime; `has_staff_role` pasa a interna de inmediato (R2) |

### 15.3 Funciones SQL internas
~**92** (hoy 50): +34 (B) +8 (C) +1 (`has_staff_role`) −1 (`get_pending_winner`). Siguen siendo `SECURITY DEFINER` donde corresponda, no ejecutables por clientes.

### 15.3b Puentes SQL service-role-only (no son RPC cliente)
~**42**, uno por operación migrada de clase B/C (hoy 0; precedente: `access_lock_state`). Viven en `public` al inicio (o en un schema de API interno si se adopta la alternativa A de §8.2.1). `EXECUTE` solo para `service_role`; el navegador no puede ejecutarlos, por lo que **no forman parte del conteo de RPC cliente** ni de la reducción de superficie de §15.6.

### 15.4 Edge Functions / servicios
**8–9** (hoy 2 + 1 pausada): `student-access`, `staff-accounts` (endurecer), `participant-admin`, `catalog-admin`, `data-io`, `operations`, `event-config`, `checkin-admin` y, tras R-0 y según se decida, `public-intake` (`workshop-intake`).

### 15.5 Retiros (clase D)
4 RPC + `get_pending_winner` + tabla `session_credentials` + alias de `my_progress`.

### 15.6 Reducción de superficie
Hoy 73 funciones ejecutables por `authenticated`. Objetivo: 16–22 RPC de aplicación; con los 4 helpers P todavía en `public` serían 20–26 (**−64 % a −73 %**); con los P movidos, **−70 % a −78 %**. Escrituras privilegiadas Staff/Coordinación expuestas: 32 → 4.

---

## Anexo A — Metodología y límites del análisis

- Inventario desde `pg_proc`/`pg_class`/`pg_policy`/`pg_roles` (solo lectura) en `spoeehpziokmknecwcbd`, y desde el código en `main` @ `e1f66e0`.
- Lectura/escritura inferida por análisis estático del cuerpo (insert/update/delete y llamadas entre funciones) y revisada manualmente; `restore_theme_version`, `regenerate_activity_credential` y `accept_platform_notice` escriben aunque la heurística no lo marque directamente.
- Consumidores: búsqueda literal de `rpc('nombre')` y `.from('tabla')` en `src/` (más el único caso dinámico) y revisión de las Edge Functions.
- No se leyó el cuerpo completo de cada una de las 124 funciones; la clasificación **E** marca donde falta evidencia (sorteo-lecturas, `session_to_activity`).
- No se ejecutaron ni se modificaron pruebas.
- Revisión 3: la restricción de PostgREST (solo schemas expuestos, también para `service_role`) proviene del review y de la documentación de Supabase; el diseño del puente y de los flags no se ha implementado ni probado y debe ensayarse en staging (R1) antes de fijar nombres y convenciones.
- Revisión 2: recuentos de llamadores de helpers (`active_edition_id` 49, `has_staff_role` 12, `is_operativo` 5, `is_coordinacion` 2, `current_participant_id` 0) obtenidos con búsqueda textual en `pg_proc.prosrc`; deben confirmarse en staging antes de revocar `has_staff_role` o mover helpers de schema (en particular, que todos los llamadores de `has_staff_role` sean `SECURITY DEFINER`).
- `statement_timeout` por rol proviene de `pg_roles.rolconfig`; su efecto exacto para llamadas de `service_role` vía PostgREST debería validarse empíricamente antes de diseñar `data-io`.
