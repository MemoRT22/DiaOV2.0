# Día OV 2026 — Check-in operativo sin restricción horaria

**Decisión del 13 de octubre de 2026.** El facilitador muestra el QR o código manual al terminar su taller, independientemente del horario nominal.

## Regla vigente

- Se permite registrar asistencia antes o después del horario programado cuando el alumno tiene una reservación válida (`vigente` o `expirada`).
- Se exige participante autenticado con aviso aceptado, credencial válida, misma edición y tipo DEMO/real, sesión no cancelada y una sola asistencia por actividad.
- Los sellos conservan la duración **programada** (60 minutos = 2; otras duraciones = 1); terminar en 40 minutos no cambia los sellos.
- Los campos `checkin_open_before_minutes` y `checkin_close_after_minutes` se conservan por compatibilidad, pero **no limitan `check_in()`**.
- El facilitador controla cuándo revelar los QR. Una persona con reserva y QR válido podrá acreditar asistencia en cualquier momento; no existe un control técnico de finalización efectiva.

## Aplicación

Migración **ya aplicada y verificada** en Supabase: versión `20261013164022`. No volver a ejecutar este SQL; incorporar el archivo con el PR y evitar un `db push` global mientras se reconcilia el historial antiguo.

## Verificación real, reversible

En Supabase, una reservación futura con QR válido fue aceptada y otorgó dos sellos; después el código manual devolvió la misma asistencia sin duplicarla. El QR de otra actividad sin reserva respondió `NO_RESERVATION`. Todas las escrituras realizadas durante esta prueba se revirtieron con `ROLLBACK`.

La suite `regression_qa_priority.sql` ahora contempla horarios anteriores y posteriores sin bloqueo; `regression_student_flexibility.sql` comprueba el mismo comportamiento. Las regresiones completas **aún no se han ejecutado nuevamente**; ejecutar solo contra base local/descartable.
