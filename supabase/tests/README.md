# Regresiones SQL de la versión vigente

Ejecutar **solo en una base local/descartable** con las migraciones actuales. No ejecutar fixtures ni harnesses contra Supabase oficial. Los archivos con `BEGIN`/`ROLLBACK` salen con código 0; las suites que terminan deliberadamente en `RAISE EXCEPTION ..._OK` revierten toda la sentencia y se consideran exitosas únicamente si el mensaje contiene su marcador de éxito y cero fallos.

| Contrato | Suite vigente | Éxito |
|---|---|---|
| Importación en `preparacion` y `oficial` | `regression_official_participant_import.sql` | `OFFICIAL_IMPORT_OK`, salida 0 |
| Correo, contraseña, autorregistro, consentimiento y conciliación | `regression_participant_access.sql` | `PARTICIPANT_ACCESS_OK` |
| Reservaciones, cupos, cambio/cancelación, tiempo y check-in flexible | `regression_student_flexibility.sql` | `STUDENT_FLEX_OK` |
| Check-in con credencial por actividad | `regression_asistencia.sql` | `ASISTENCIA_OK`, salida 0 |
| Recomendador y aislamiento DEMO/real | `regression_recommender.sql` | `RECOMMENDER_OK` |
| Sorteo, permisos, no-show, idempotencia y selección pendiente | `regression_sorteo.sql` | `RAFFLE REGRESSION: ... 0 failed` |
| Centro de Operación | `regression_operaciones.sql` | `OPERACIONES REGRESSION: ... 0 failed` |
| Intereses posteriores | `regression_post_event_interests.sql` | `... 0 fail` |
| Talleres, publicación y edición | `regression_workshop_admin.sql`, `regression_workshop_intake.sql`, `regression_workshop_publishing.sql`, `regression_published_workshop_editing.sql`, `regression_workshops_single_flow_fixes.sql`, `regression_backend_legacy_cleanup.sql` | Marcador propio sin fallos |

El harness HTTP `concurrency_reservations.mjs` y su `concurrency_fixture_setup.sql` / `concurrency_fixture_cleanup.sql` prueban clientes distintos, cupo y máximo. `concurrency_checkin.mjs` tiene setup/cleanup propios. Requieren **Supabase local completo** (Auth, Edge Functions y base), una contraseña DEMO en `CONCURRENCY_TEST_PASSWORD` y la URL local en `CONCURRENCY_TEST_SUPABASE_URL`; los scripts rechazan URLs fuera de localhost. `node --check` solo confirma sintaxis y no reemplaza la prueba concurrente.

## Suites históricas fuera de la batería

- `regression_reservaciones.sql` codifica `SESSION_STARTED` y bloqueos de traslado retirados; su contrato vigente está en `regression_student_flexibility.sql`.
- `regression_correcciones.sql` y `regression_admin_simplification.sql` mezclan el antiguo cierre/reapertura del padrón, `access_attempts` y diagnóstico de acceso retirado. La importación y el acceso vigentes se prueban en las dos suites indicadas arriba.
- `regression_initial_interests.sql` depende del alta manual retirada; los intereses iniciales actuales se cubren al importar, autorregistrar y recomendar.
- `regression_activity_credentials.sql` conserva expectativas temporales retiradas; `regression_asistencia.sql` prueba el contrato de credencial de actividad vigente.
- `regression_preparation_reset.sql` no forma parte de la batería de Fase 6B: la operación global está prohibida en esta ronda.

No usar una suite histórica como criterio de liberación ni modificar código de producción para hacerla pasar. Si se necesita rescatar un escenario todavía vigente, trasladarlo con un fixture actual y comprobarlo por separado.
