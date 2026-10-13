# Notificación de ganador y comprobación visual

**Flujo:** el servidor selecciona → el alumno recibe un aviso → su Bitácora (`/pasaporte`) muestra premio y folio → el operador compara el folio en su panel → confirma con el botón existente → la Bitácora dice «Premio entregado».

## Backend (migración `20261013170000_raffle_winner_folio_and_student_prizes.sql`)
- `raffle_winners.folio`: «GAN-000123», único, asignado por la base con un DEFAULT de secuencia (no se modificó `draw_winner`) e inmutable (trigger). Es una referencia de cotejo visual, no una credencial.
- `my_raffle_prizes()` → `{ prizes, poll_seconds }`: resultados **vigentes** (`seleccionado` / `confirmado`) de la persona autenticada, por `participant_id`, de su edición y su conjunto real/DEMO (`no_presentado` e `invalidado` no se devuelven), y la cadencia con que conviene volver a preguntar.
- `raffle_winner_folios(uuid[])`: folios para Sorteo/Coordinación (máx. 1,000 ids por llamada; el cliente pide en lotes de 500).
- No cambian `draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner`, `my_raffle_status`, elegibilidad, sellos, categorías ni inventario.

## Carga sobre el servidor (hasta ~2,000 alumnos)
La cadencia la dicta el servidor (`poll_seconds`) y **nunca es «ninguna»**: siempre queda un latido de recuperación, para que una pantalla abierta no se quede indefinidamente sin enterarse de que la persona ya participa, de que empezó el sorteo o de que ganó.

| Situación de la persona | `poll_seconds` |
|---|---|
| Resultado pendiente de entrega (para ver pronto la confirmación) | 15 |
| Sorteo en curso (hubo un ganador en la última hora) y está en una categoría | 20 |
| Sorteo en curso y no está en ninguna categoría | 120 |
| Sin sorteo en curso, en una categoría (puede ganar) | 180 |
| Sin sorteo en curso, con asistencias pero sin categoría todavía | 300 |
| Sin sorteo en curso y sin asistencias | 600 (latido de recuperación) |

Además la plataforma consulta siempre: al abrirse, **al registrar una asistencia (en esa pestaña, y en otra del mismo navegador por el aviso entre pestañas)**, al abrir la Bitácora, al volver a la pestaña/desbloquear el teléfono y al recuperar la conexión (mínimo 10 s entre consultas por eventos). El temporizador siempre está armado: con la pestaña oculta se vuelve a armar sin consultar, y con fallos se espacian los reintentos (×2 hasta 10 min). Cada respuesta reprograma el temporizador con la cadencia nueva.

**Paso de «sin asistencias» a «con asistencias» con la app abierta:** el check-in de la propia pestaña vuelve a consultar al instante (la cadencia pasa de 600 a 180 s); si la asistencia se registró por un camino que la pantalla no ve, se entera en el siguiente latido (≤ 690 s).

**Latencias máximas conocidas del aviso** (cuando no hay ningún evento que despierte la app; con el teléfono en la mano, al abrirla o desbloquearla es inmediato):
- Primer ganador del sorteo, persona en reposo y en una categoría: ≤ 207 s (180 s + 15 %).
- Persona en reposo pero que aún no figura en una categoría, o sin asistencias: ≤ 345 s / ≤ 690 s (se entera de que ya participa y de que hay sorteo en su siguiente latido).
- Cuando empieza el sorteo (primer ganador) los demás siguen en su latido de reposo hasta su siguiente consulta (≤ 207 s en categoría); ahí pasan a ~20 s. Por eso los **primeros** ganadores pueden tardar hasta ~3.5 min en aparecerle a quien no toca su teléfono; una vez «en vivo» cada aviso llega en ≤ 23 s (≤ 17 s si ya tenía un resultado pendiente).

**Carga:** peor caso en reposo, 2,000 alumnos todos en una categoría: 2,000 / 180 s ≈ 11 consultas/s (antes ≈ 100/s); sin asistencias ≈ 3 consultas/s (2,000 / 600 s). Solo con el sorteo en curso, y solo para quien está en una categoría, ≈ 1 consulta cada 20 s.

## Verificado: Supabase manda
Nada del resultado se guarda en el dispositivo (solo los ids de avisos ya cerrados, para no repetirlos). Un premio **pendiente** solo se presenta como reclamable si la última consulta salió bien y es reciente (≈ 2.5 × la cadencia, mínimo 1 min; y al volver a la pantalla tras > 30 s se marca por verificar hasta que el servidor responda). Si la consulta falla, se cuelga o está vencida: la tarjeta pasa a «Premio sin verificar» (sin «Presenta esta pantalla…»), el aviso se retira sin darse por visto, y «Verificar ahora» reintenta. Si al reconectar el servidor dice `confirmado`, `no_presentado` o `invalidado`, eso es lo que se ve.

## Aviso (accesibilidad)
Diálogo modal en un portal: el foco entra al botón principal, Tab/Shift+Tab giran dentro, el resto de la aplicación queda `inert` y `aria-hidden` mientras está abierto, Escape lo cierra y, al cerrarse, el foco regresa a donde estaba la persona.

## Operador
La consola muestra «Ganador seleccionado», el premio y `Folio: GAN-…` (también en el historial). La pantalla pública del proyector no muestra el folio. «Confirmar ganador» no cambia.

# Aplicar SOLO la migración de folios (sin `db push` global)

**Orden de versiones.** La migración de PR #41 (`20261013164022_checkin_operational_no_time_window`) ya está aplicada en Supabase aunque su PR siga abierto, así que el archivo aún no está en `main`. Esta migración se versionó `20261013170000`, **posterior** a esa, para no quedar «insertada antes» de la última aplicada. No depende de #41 ni de ninguna otra migración pendiente (usa tablas y funciones de migraciones anteriores ya aplicadas).

**No ejecutar `supabase db push` mientras #41 no se fusione**: el directorio local (main) no tiene `20261013164022`, y la CLI se negaría o intentaría reconciliar historiales. Aplicar únicamente este archivo:

1. **Revisión previa (solo lectura)**
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version desc limit 5;  -- debe estar 20261013164022 y NO 20261013170000
   select column_name from information_schema.columns where table_name='raffle_winners' and column_name='folio';  -- 0 filas
   select to_regprocedure('public.my_raffle_prizes()'), to_regprocedure('public.raffle_winner_folios(uuid[])');  -- ambos null
   select count(*) from raffle_winners;  -- los resultados existentes reciben su folio al agregar la columna
   ```
   Si la última versión remota fuera mayor que `20261013170000`, renombrar el archivo a una versión posterior antes de aplicarlo.
2. **Aplicar solo este archivo**, fuera de un sorteo en curso (agregar la columna con DEFAULT reescribe la tabla, que es pequeña, con un bloqueo breve), en una sola transacción y sin tocar nada más. Es idempotente (`IF NOT EXISTS` / `CREATE OR REPLACE`), se probó dos veces seguidas y sobre resultados ya existentes:
   - Editor SQL de Supabase o `apply_migration` con el contenido del archivo (queda registrado con la versión del momento de aplicarlo; después se renombra el archivo a esa versión, como se hizo con las migraciones de QA), **o**
   - `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261013170000_raffle_winner_folio_and_student_prizes.sql` y luego `supabase migration repair 20261013170000 --status applied --linked` (registra únicamente esa versión).
3. **Validación posterior:** `select count(*), count(distinct folio) from raffle_winners;` (iguales); `select folio from raffle_winners order by folio limit 3;`; `select has_function_privilege('anon','public.my_raffle_prizes()','EXECUTE');` (false). La regresión `supabase/tests/regression_raffle_winner_folio.sql` se corre solo en una base local descartable.
4. **Después** de validar, desplegar la aplicación. El front tolera la ausencia de la función (sin aviso, Bitácora como antes, «Folio: no disponible» sin bloquear la confirmación), pero conviene migración primero y despliegue después.
5. **Reversa** (solo si hiciera falta; los folios generados se pierden): `drop function my_raffle_prizes(); drop function raffle_winner_folios(uuid[]); drop trigger raffle_winners_folio_immutable on raffle_winners; drop function raffle_winners_folio_immutable(); alter table raffle_winners drop column folio; drop sequence raffle_winner_folio_seq;`
6. Cuando #41 se fusione, su archivo ya coincide con la versión aplicada y `supabase migration list` quedará alineado.
