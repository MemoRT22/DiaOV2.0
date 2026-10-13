# Correcciones prioritarias QA - Día OV 2026

Base: `58c7c7a1231c598d1b140d9c56e9b057031eab29`. Rama: `codex/qa-priority-fixes`.
Las modificaciones están preparadas para revisión. No se aplicaron a Supabase remoto y no se desplegó la aplicación.

## Cambios

- `20261013034241_qa_checkin_window_and_student_audience.sql`: reemplaza únicamente `check_in(text)`, partiendo de la definición desplegada consultada mediante `pg_get_functiondef`. Usa `statement_timestamp()` del servidor capturado una vez por solicitud. Apertura y cierre inclusivos según `editions.checkin_open_before_minutes` y `checkin_close_after_minutes`.
- La asistencia ya registrada se devuelve antes de validar la ventana, incluso tras cierre o cancelación. Se mantiene el bloqueo por participante, el índice único por actividad, las reservas expiradas válidas y la regla 60 minutos = 2 sellos / otras duraciones = 1.
- `20261013034404_student_audience_and_recommender_contract.sql`: agrega `activities.audience` con valores explícitos `students` y `educators`. Solo clasifica como `educators` la actividad `cef9d429-d193-49fc-8883-d15a5ee30fdc`.
- `assert_reservable` protege tanto reserva como cambio de reserva; el tablero y el detalle estudiantil omiten actividades educativas exclusivas. Las reservaciones anteriores se conservan en el itinerario para que puedan cancelarse legítimamente.
- Coordinación puede consultar/cambiar la audiencia mediante RPC autorizados y la sección “Público del taller” de los talleres publicados. El cambio queda auditado. No depende de título, descripción o cantidad de carreras.
- El recomendador incremental restablece `recommendation_type`, `matched_careers`, `matched_division`, `interest_priority`, `has_open_session` y `summary`. Conserva claves anteriores para clientes en caché, cálculo de cupos incluyendo reservas expiradas e aislamiento de edición/DEMO.
- Los nuevos errores se muestran en español comprensible para estudiantes.

## Discrepancia de despliegue confirmada

El historial remoto consultado no contiene `deterministic_workshop_recommender`. La definición instalada conserva el contrato anterior. Se revisaron las funciones desplegadas de check-in, reserva, tablero y detalle, y las migraciones posteriores de sellos, sorteo, CRUD y exportación de QR. La nueva migración del recomendador integra esas reglas; no requiere aplicar la migración antigua omitida.

La configuración remota consultada sigue siendo 5 minutos antes y 20 después. Las consultas remotas fueron de solo lectura.

## Validación aislada

Se copió la base PostgreSQL local `diaov-credits-test-db` a `diaov_priority_qa_full`, se reprodujeron sus permisos y se añadieron las migraciones posteriores de CRUD/exportación y estas dos migraciones nuevas. La clave de cifrado local es ficticia. No se copiaron secretos remotos.

La suite `regression_qa_priority.sql` usa exactamente los UUID Auth/participante y correos de los tres estudiantes documentados, con carreras equivalentes en fixtures locales. Todo termina en `ROLLBACK`.

| Alumno | Carrera | Reserva/cupo | Sellos académicos + Vida Universitaria | Categoría |
|---|---|---|---|---|
| A | Biotecnología | Aprobado, 30 → 29 | 2 + 1 | Galaxia |
| B | TI e Inteligencia Artificial | Aprobado, 30 → 29 | 2 + 1 | Galaxia |
| C | Negocios Internacionales | Aprobado, 30 → 29 | 1 + 1 | Sistema Solar |

Los tres reciben coincidencia exacta y complemento por división diferenciados. Se comprueban los cambios `already_reserved` y `already_attended`, y la exclusión del taller de personal tanto en recomendaciones como en reserva directa, detalle y descubrimiento.

### Evidencias temporales

Se ejecutan ambos métodos (QR y manual) usando la hora del servidor y sesiones relativas a ella:

| Momento | Resultado |
|---|---|
| Tres días antes | CHECKIN_NOT_OPEN |
| Seis minutos antes | CHECKIN_NOT_OPEN |
| Cinco minutos y un segundo antes | CHECKIN_NOT_OPEN |
| Exactamente cinco minutos antes | Permitido |
| Inicio exacto / durante el taller | Permitido |
| Diez minutos después del fin | Permitido con reservación expirada |
| Exactamente veinte minutos después del fin | Permitido |
| Veinte minutos y un segundo después del fin | CHECKIN_CLOSED |

También se prueban ausencia de reserva, cancelación, otro dataset, repetición tras cierre/cancelación, elección de una reserva pasada todavía válida frente a una futura y configuración alternativa 10/30 (para descartar valores hardcodeados).

### Concurrencia

`concurrency_qa_priority.mjs` ejecutó 20 conexiones PostgreSQL independientes, mezclando QR y código manual:

```json
{"requests":20,"new_attendances":1,"idempotent_responses":19,"stored_rows":1,"stored_stamps":2,"passed":true}
```

El harness solo acepta una base Docker local con nombre `diaov_priority_qa...` y limpia únicamente sus propios fixtures al terminar. Esta prueba comprueba concurrencia real de la función SQL; no es una prueba HTTP de PostgREST.

### Regresiones completas

- Vitest: **76 archivos, 920 pruebas aprobadas**.
- TypeScript/Vite: **build aprobado**.
- **18 suites SQL** verificadas. Algunas suites históricas terminan deliberadamente con excepción de éxito y revierten su sentencia; se verificó su marcador y ausencia de fallos.

| Suite | Resultado |
|---|---|
| regression_qa_priority | PRIORITY_QA_OK |
| regression_student_flexibility | STUDENT_FLEX_OK, 49 comprobaciones |
| regression_recommender | RECOMMENDER_OK, 24 comprobaciones |
| regression_asistencia | ASISTENCIA_OK + ASISTENCIA_SELLOS_OK |
| regression_conciliacion_sellos | CONCILIACION_SELLOS_OK |
| regression_sorteo | 234 aprobadas, 0 fallos |
| regression_admin_crud | ADMIN_CRUD_OK |
| regression_official_participant_import | OFFICIAL_IMPORT_OK |
| regression_participant_access | PARTICIPANT_ACCESS_OK, 65 comprobaciones |
| regression_activity_export_metadata | EXPORT_METADATA_OK, 23 aprobadas |
| regression_operaciones | 48 aprobadas, 0 fallos |
| regression_post_event_interests | 63 aprobadas, 0 fallos |
| regression_workshop_admin | workshop_admin_regression_ok |
| regression_workshop_intake | 192 aprobadas, 0 fallos |
| regression_workshop_publishing | workshop_publishing_regression_ok |
| regression_published_workshop_editing | PUBLISHED_WORKSHOP_EDITING_OK |
| regression_workshops_single_flow_fixes | FIXES_OK, 17 comprobaciones |
| regression_backend_legacy_cleanup | backend_legacy_cleanup_ok |

Se ajustaron únicamente los fixtures de asistencia/CRUD/flexibilidad que asumían check-in futuro o sin cierre. No se alteraron migraciones históricas para hacer pasar los tests.

## Datos oficiales

No hubo escrituras remotas. Una consulta final confirmó **64 actividades reales, 242 sesiones reales y 64 credenciales reales**. No se crearon ganadores ni se modificó inventario.

Huellas de la consulta remota de catálogo (MD5 de filas ordenadas, sin publicar material de credenciales):
- actividades: `14453745606bcef05640c059ba397467`
- sesiones: `7ff459c43678b8d1bf44d8262c215ce2`

La prueba local de audiencia verifica que sesiones completas, capacidades, credenciales y asociaciones de carreras permanecen idénticas antes/después de cambiar la audiencia. Al autorizar la migración remota, el único cambio de datos oficiales será el nuevo metadato de audiencia del taller indicado.

## Bootstrap histórico: trabajo separado

El arranque desde cero observado durante la auditoría anterior falla en:
1. `20261004190200_raffle_seed_default_categories.sql`: no hay edición activa y `edition_id` resulta nulo; el bootstrap `20261005005629_20261005003000_bootstrap_edition_and_coordinator.sql` aparece después.
2. Tras añadir una edición ficticia exclusivamente en /tmp, `20261005002227_20261004173441_20261004170300_attendance_checkin.sql` intenta reemplazar `resolve_credential(text)` con retorno UUID, cuando `20261004182133_20261004180200_checkin_method_and_rank.sql` ya cambió su retorno.
3. Conviven la serie original `20261004...` y sus copias `20261005001403...` en adelante. El historial remoto comienza en la segunda serie y contiene además versiones remotas distintas para algunas migraciones posteriores.

Este PR no repara, borra ni reordena esa historia. La reparación reproducible del bootstrap y la conciliación global de versiones requieren un trabajo separado.

## Aplicación futura y pendientes del reporte QA

1. Revisar y fusionar el PR solo con autorización.
2. Aplicar exclusivamente las dos migraciones nuevas en su orden; evitar `db push` indiscriminado mientras el historial global no esté reconciliado.
3. Desplegar el frontend después del backend para habilitar los RPC de audiencia.
4. Repetir el recorrido HTTP/navegador sobre el entorno autorizado. Producción mantiene los defectos hasta que las migraciones se apliquen.
5. Quedan pendientes el ensayo completo del sorteo público/animación/no presentado y último cupo simultáneo por HTTP, además de limpieza autorizada de las cuentas y reservas de la auditoría original.

No se ejecutaron merge, despliegue ni migraciones remotas.

## Revisión P2: visibilidad según historial de reservación (13 de octubre)

Ajuste sobre el HEAD revisado `28e957238727b9dab66a4ace2c30aa620272f2da`, en el mismo PR #40.

La excepción de audiencia en `my_reservation_board().sessions` ahora exige que la reservación propia tenga uno de los mismos estados que conserva `reservations`: `vigente`, `cancelada_sesion` o `expirada`. El cambio funcional es un solo predicado añadido a la migración pendiente del PR; no se agregan ni reestructuran migraciones.

| Reservación propia | Sesión exclusiva en tablero | Itinerario |
|---|---|---|
| Ninguna | Oculta | Sin entrada |
| vigente anterior a la clasificación | Visible | Conservado, estado active |
| cancelada_alumno | Oculta | Sin entrada |
| cambiada | Oculta | Sin entrada |
| cancelada_sesion, sesión cancelada administrativamente | Visible | Conservado, estado cancelled |
| expirada, sesión pasada | Visible | Conservado, estado expired |

Para los seis casos se verifican el rechazo de reserva y de cambio con `ACTIVITY_EDUCATORS_ONLY`, la conservación de la reserva original cuando el cambio falla, y la exclusión en recomendador y detalle. Se prueban en paralelo actividades ordinarias para garantizar que sus sesiones continúan visibles y su itinerario conserva exactamente el comportamiento anterior.

La nueva matriz reproduce el fallo con el código previo: `FAIL: P2 exclusive session visibility: cancelada_alumno`. Tras cargar únicamente la función corregida en PostgreSQL Docker local, pasa la matriz completa (63 comprobaciones P2). La suite acumulada tiene 145 comprobaciones aprobadas y termina con `ROLLBACK`; la evidencia actualizada está en `docs/qa-evidence/priority-postgres.txt`.

Validación de esta revisión:
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `npm test`: 76 archivos, 920 pruebas aprobadas.
- PostgreSQL local: `regression_qa_priority`, `regression_student_flexibility` (49), `regression_recommender` (24), `regression_admin_crud` y `regression_asistencia` aprobadas. Las excepciones finales `STUDENT_FLEX_OK` y `RECOMMENDER_OK` son los marcadores de éxito deliberados de esas suites.

No se ejecutaron operaciones contra Supabase remoto, ni se tocaron los datos de producción. Para respetar la prohibición de despliegue al subir esta revisión, el PR y el commit se marcan con `[skip netlify]`, según el mecanismo documentado por Netlify.

