# Calendario oficial de talleres 2026

## Diagnóstico

La publicación vigente avanzaba `session_duration_minutes` desde las 10:00 hasta las 12:00. Por eso generaba bloques consecutivos y no representaba los traslados. La edición de un taller publicado repetía un segundo algoritmo con la misma regla, de modo que un cambio de duración podía restaurar el calendario incorrecto.

Las altas desde Coordinación ya reutilizan `publish_workshop_submission_internal`; no existe un tercer generador en la aplicación. Las pantallas de Mi ruta, Misiones, detalle del alumno, Operación y check-in ya leen `activity_sessions.starts_at` y `activity_sessions.ends_at`. El detalle de Coordinación sí mostraba además el rango legado `operating_start_time`–`operating_end_time`, que podía contradecir las sesiones del servidor.

## Fuente única

`official_workshop_session_slots(event_date, duration)` define los únicos bloques automáticos, en `America/Cancun`:

| Duración | Sesiones efectivas |
|---|---|
| 15 min | 10:00–10:15, 10:25–10:40, 10:50–11:05, 11:15–11:30, 11:40–11:55, 12:05–12:20 |
| 30 min | 10:00–10:30, 10:40–11:10, 11:20–11:50, 12:00–12:30 |
| 60 min | 10:00–11:00, 11:20–12:20 |

Los traslados están fuera de `starts_at`/`ends_at`. Por tanto, el trigger vigente de sellos conserva 1 sello para 15/30 minutos y 2 sellos para 60 minutos. Las reglas de reservación siguen tratando únicamente el solapamiento real como conflicto y el traslado como advertencia.

## Protección de datos existentes

La migración no contiene `UPDATE`, `DELETE` ni `INSERT` sobre sesiones existentes: al instalarla solo crea/reemplaza funciones. En particular, no altera las 63 actividades oficiales ni las 216 sesiones que Coordinación confirmó como ya corregidas.

Para futuros cambios de duración permitidos:

- se bloquean todas las sesiones del taller;
- cualquier reservación o asistencia impide el cambio completo con `SESSION_SCHEDULE_LOCKED`;
- las filas reutilizables se actualizan en sitio, conservando su `id`, estado y ubicación específica;
- solo se insertan los horarios que falten;
- solo pueden retirarse filas excedentes después de comprobar que ninguna tiene reservaciones ni asistencias;
- la actividad y su credencial QR no se reemplazan.

Un cambio editorial o de cupo con la misma duración conserva todos los identificadores y horarios.

## Inventario

El repositorio no contiene una fuente versionada que permita reconstruir por sí sola el inventario histórico de 64 talleres/242 sesiones. La especificación operativa más reciente confirma 63 talleres oficiales y 216 sesiones, después de corregir directamente el calendario y retirar reservaciones/asistencias de ensayo. Este PR toma ese estado como autoridad y no intenta inferir, restaurar, borrar ni regenerar registros.

## Verificación y reversión

Antes de una instalación autorizada, registrar en una misma sesión de solo lectura:

```sql
SELECT count(*) AS sessions,
       md5(string_agg(id::text || '|' || starts_at::text || '|' || ends_at::text || '|' ||
                      capacity::text || '|' || status, ',' ORDER BY id)) AS fingerprint
FROM public.activity_sessions;
```

Después de aplicar la migración, el conteo y la huella deben ser idénticos. Además, ejecutar `regression_official_workshop_schedule.sql` únicamente en una base local/descartable; la suite crea sus fixtures dentro de `BEGIN`/`ROLLBACK`.

Si la instalación de las funciones necesitara revertirse, no hay datos que deshacer. Preparar una migración hacia delante que restaure las definiciones anteriores de `publish_workshop_submission_internal` y `workshop_admin_edit_internal`; no ejecutar cambios manuales sobre `activity_sessions`.

No ejecutar esta migración ni sus fixtures en Supabase oficial sin autorización explícita.
