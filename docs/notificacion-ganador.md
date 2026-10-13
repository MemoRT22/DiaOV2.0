# Notificación de ganador y comprobación visual

**Flujo:** el servidor selecciona → el alumno recibe un aviso → su Bitácora (`/pasaporte`) muestra premio y folio → el operador compara el folio en su panel → confirma con el botón existente → la Bitácora dice «Premio entregado».

## Backend (migración `20261013160000_raffle_winner_folio_and_student_prizes.sql`, sin aplicar a producción)
- `raffle_winners.folio`: «GAN-000123», único, asignado por la base con un DEFAULT de secuencia (no se modificó `draw_winner`) e inmutable (trigger). Es una referencia de cotejo visual, no una credencial.
- `my_raffle_prizes()`: resultados **vigentes** (`seleccionado` / `confirmado`) de la persona autenticada, por `participant_id`, de su edición y su conjunto real/DEMO. `no_presentado` e `invalidado` no se devuelven. Sin datos de otras personas.
- `raffle_winner_folios(uuid[])`: lo mismo para Sorteo/Coordinación, con el alcance de `raffle_winners_read`.
- No cambian `draw_winner`, `confirm_winner`, `mark_no_show`, `invalidate_winner`, `my_raffle_status`, elegibilidad, sellos, categorías ni inventario.

## Alumno
- `RafflePrizeProvider` (en `StudentLayout`) consulta `my_raffle_prizes()` al abrir, cada ~20 s con variación mientras la pantalla está visible, al volver a la pestaña y al recuperar la conexión; con fallos espacia las consultas y conserva lo último que supo. **No depende de Realtime.**
- `WinnerNotice`: aviso en cualquier sección cuando hay un resultado `seleccionado` no cerrado. Cerrar lo recuerda solo en el dispositivo (`localStorage`, con respaldo en memoria): no cambia nada en Supabase y el premio sigue en la Bitácora.
- `PrizeCard` dentro de la sección «Sorteo» existente: pendiente de entrega / ¡Premio entregado!

## Operador
La consola muestra «Ganador seleccionado», el premio y `Folio: GAN-…` (también en el historial). La pantalla pública del proyector no muestra el folio. «Confirmar ganador» no cambia.
