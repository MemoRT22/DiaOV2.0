# Encuesta de salida del Día OV 2026 (requisito del sorteo)

La encuesta es la última interacción del alumno y un **requisito obligatorio** para entrar a cualquiera de las tres categorías del sorteo.
Un alumno participa solo si (1) cumple los **sellos** de una categoría —reglas sin cambios— **y** (2) completó la encuesta. La comprobación
vive en PostgreSQL; React solo la refleja.

Migración: `supabase/migrations/20261014140000_exit_survey_raffle_requirement.sql` (**no aplicada en producción**; ver «Aplicación»).

## Qué se creó

| Pieza | Descripción |
|---|---|
| `editions.exit_survey_opens_at` | Hora de apertura (nullable). Sin valor: **el día del evento a las 13:00, zona horaria de la edición (Cancún)**. |
| `exit_survey_responses` | Una fila por participante y edición (`UNIQUE`), `is_demo`, `survey_version`, cinco respuestas obligatorias con `CHECK`, comentario opcional (≤ 500) y `completed_at` del servidor. RLS activo sin políticas: solo se accede por RPC. Inmutable (trigger). `ON DELETE CASCADE` con el participante, así que la limpieza de preparación la borra. |
| `exit_survey_invitations` | Memoria **por alumno, en el servidor**, de que ya se le mostró el popup (una sola vez aunque cambie de dispositivo). Nunca bloquea nada. |
| `my_exit_survey()` | Estado de la persona: hora del servidor, abierta/cerrada, contestada, invitada, categoría por sellos, elegible. |
| `submit_exit_survey(p)` | Guarda **la encuesta de la persona autenticada** (sin `participant_id` del navegador), valida hora, versión, claves, opciones y cantidades; idempotente (reenvío, doble clic o dos dispositivos no duplican ni sobrescriben; `FOR UPDATE` sobre la fila del participante + `UNIQUE`). |
| `exit_survey_mark_invited()` | Anota la invitación (solo si está abierta). |
| `set_exit_survey_opens_at(ts)` / `exit_survey_admin()` | Solo Coordinación: ajustar la hora (auditado; `NULL` = restablecer; se rechaza fuera de [evento − 7 d, evento + 30 d]) y resultados **agregados** sin identidades, ensayo y oficial por separado. |

### Preguntas (versión `exit-2026-v1`)
P1 claridad previa (4 opciones) · P2 estrellas 1–5 · P3 claridad posterior (4 opciones) · P4 hasta 3 áreas de la encuesta original (Salud, Deporte, Negocios,
Derecho y Relaciones Internacionales, Liderazgo, Arquitectura y Diseño, Ingenierías, Comunicación y áreas creativas) o «Todavía no tengo un área definida»
(exclusiva) · P5 recomendación 0–10 + comentario opcional «¿Qué mejorarías?». No se piden datos personales y **no se modifican las carreras de interés**.

## Integración con el sorteo
- `participant_stamp_category(pid)`: la categoría **por sellos** (lógica de siempre). Se sigue mostrando al alumno aunque no haya contestado.
- `participant_raffle_category(pid)`: ahora = la de sellos **solo con encuesta completada**, si no `NULL`. Lo heredan `draw_winner`, `raffle_pool_count`, el panel del operador y la cadencia de `my_raffle_prizes`.
- `raffle_eligible_pool(categoría, premio, demo)`: **el único conjunto sorteable**. Lo usan `draw_winner`, `raffle_pool_count` y `raffle_operator_view`; el número mostrado es el conjunto real del que se sortea. (Corrección: antes el conteo incluía a quien tenía un resultado «seleccionado» pendiente y el sorteo no.)
- Defensa en profundidad: `draw_winner` re-verifica la encuesta del elegido y un trigger `BEFORE INSERT` en `raffle_winners` rechaza `SURVEY_REQUIRED` para cualquier resultado nuevo sin encuesta. No toca filas históricas (ganadores de ensayo incluidos).
- `my_raffle_status()` añade `survey_completed` y `raffle_eligible`. El operador ve `survey_pending_count` por categoría (con los sellos, sin encuesta).
- Solo participa en la categoría más alta y gana como máximo un premio (sin cambios).

## Experiencia del alumno
- **Popup** («Una última misión», mismo lenguaje visual del aviso de ganador, accesible: foco atrapado, Escape, fondo `inert`): sale cuando el **servidor** dice que está abierta y la persona no ha contestado; «Responder encuesta» / «Ahora no». Una vez por alumno. No interrumpe una actividad crítica: espera si está en `/escanear`, si hay un diálogo modal abierto (confirmar reservación, aviso de ganador) y unos segundos después.
- **No depende de un temporizador del navegador:** el temporizador solo despierta una consulta al servidor a la hora (reloj corregido con la diferencia con el servidor + hasta 30 s de variación para repartir la carga); además se consulta al abrir, al volver a la pestaña/foco, al recuperar conexión y al registrar un sello. Tras un fallo reintenta con espera creciente.
- **Bitácora (`/pasaporte`)**: sección «Encuesta de salida» (antes de la hora: cuándo abre; pendiente: «Completa tu encuesta para participar en el sorteo»; completada: «¡Gracias por compartir tu experiencia!»). La tarjeta del sorteo dice «Ya tienes los sellos necesarios. Solo falta completar tu encuesta para participar».
- **`/encuesta`**: una pregunta por paso, progreso, transición ligera, borrador en `sessionStorage`, envío único, reintento seguro tras perder la conexión. Confirmación del servidor: «¡Misión completada!…» + «Ya cumples los requisitos para participar en el sorteo» o «Tu encuesta ya está lista. Sigue completando misiones…».
- **Coordinación**: Sorteo final → pestaña «Encuesta de salida»: ajustar la hora (hora de Cancún) y ver resultados agregados.

## Compatibilidad y datos de prueba
No borra ni modifica participantes, asistencias, reservaciones, horarios, cupos ni ganadores existentes; las reglas de categorías no cambian. Las respuestas del ensayo llevan `is_demo = true`, nunca se mezclan con las oficiales (ni en el sorteo ni en los resultados) y desaparecen con la limpieza de preparación (cascada). Las cuentas DEMO pueden probar la encuesta antes de la hora **solo mientras la edición está en `preparacion`**; una cuenta real nunca se salta la hora.

## Aplicación (la hace el responsable; no se ejecutó en producción)
1. Aplicar la migración (no destructiva, idempotente) **antes** de desplegar el front: el front tolera un servidor sin la migración (la encuesta no aparece), pero sin ella tampoco se exige la encuesta.
2. Revisar la hora en Sorteo final → Encuesta de salida (por omisión: jueves 15 de octubre, 13:00 Cancún).
3. Si había ganadores o selecciones de ensayo, siguen vigentes; para el sorteo oficial quien no contestó no entra.

## Pruebas
`supabase/tests/regression_exit_survey.sql` (`EXIT_SURVEY_OK`), `supabase/tests/concurrency_exit_survey.sql` (envíos simultáneos con `dblink`), más las suites del sorteo actualizadas. Front: `src/lib/exitSurvey.test.ts`, `src/student/ExitSurveyFlow.test.tsx`, `src/admin/raffle/ExitSurveyAdmin.test.tsx`.
