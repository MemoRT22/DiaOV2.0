# Sorteo final · rediseño funcional y visual

Segunda iteración del módulo Sorteo dentro del PR #36. No toca backend, migraciones ni Edge Functions; no cambia sellos, categorías ni elegibilidad.

## Estructura

Un solo módulo (`src/admin/raffle/`) con tres secciones separadas, enlazables con `?seccion=`:

| Sección | Para qué | Quién |
| --- | --- | --- |
| **Preparación** | Categorías con sus premios, resumen y elegibles | Coordinación |
| **Ejecutar sorteo** | Elegir categoría y premio, sortear, revelar, decidir, proyectar | Coordinación y rol Sorteo |
| **Historial** | Resultados, estados e invalidaciones; nada se sortea ni se configura aquí | Coordinación y rol Sorteo (solo Coordinación invalida) |

`/coordinacion/sorteo-admin` y `/coordinacion/sorteo` abren el mismo módulo; el rol Sorteo no ve Preparación, ni el cambio de entorno, ni «Invalidar».

## Decisiones de UX

- **REAL / DEMO** es un contexto del módulo, no un filtro por pantalla: una barra de entorno (borde verde «Datos reales», ámbar «Datos de prueba» con aviso de ensayo) y un interruptor único. Cada entorno muestra solo sus categorías, así que ya no hay nombres repetidos. Empieza en el entorno del modo de la edición. En el escenario de ejecución, DEMO muestra la etiqueta «Ensayo · datos de prueba», también en la proyección.
- **Preparación por categoría.** Cada categoría es una tarjeta con sus requisitos, sus elegibles y sus premios (stock disponible/total, «Agotado», «Inactivo»); «Agregar premio» está dentro de la tarjeta, así que se entiende qué premio pertenece a cuál. Aviso cuando una categoría activa no tiene premios.
- **Ejecutar en dos pasos** (1 Categoría, 2 Premio) y un escenario oscuro que muestra categoría, premio, cuántos compiten y unidades disponibles. Si algo impide sortear (categoría inactiva o sin premios, premio agotado o inactivo, sin elegibles) el botón se desactiva y el escenario explica por qué.
- **Animación.** Órbitas con la «multitud» del sorteo (más puntos cuanto mayor el pool), remolino de ~4 s mientras el servidor sortea, y el nombre se resuelve letra por letra con un destello. No se muestran nombres de otros participantes: la interfaz no los recibe y no se inventan. Con `prefers-reduced-motion` se omite el movimiento. El botón de confirmar se habilita cuando el nombre ya está completo.
- **Decisión.** «Confirmar ganador» o «No se presentó» (pide confirmación en línea; libera el premio y ofrece «Sortear de nuevo»). Tras confirmar, «Siguiente ronda» avanza al mismo premio, al siguiente con unidades, o a la siguiente categoría con algo que sortear. Coordinación puede «Invalidar y volver a sortear» un premio recién confirmado.
- **Recuperación.** Un ganador pendiente (recarga, otro operador) se detecta al entrar y reaparece listo para confirmar; un premio que muestra 0 disponibles por tener un pendiente sigue siendo seleccionable.
- **Modo proyección.** Capa a pantalla completa (también pide pantalla completa al navegador): solo categoría, premio, pool y ganador, texto escalado al tamaño de la pantalla, controles en un dock discreto al pie. `H` oculta los controles (vuelven al pasar el cursor o con el teclado), `Esc` sale. El estado de la ronda se conserva al entrar y salir.

## Limitaciones del backend detectadas

1. **No existe un RPC que liste a los participantes elegibles ni su desglose de sellos.** `raffle_operator_view` solo devuelve `pool_count` por categoría y, para Coordinación, combinaciones agregadas sin categoría; `attendances` y `participants` no son legibles para el personal por RLS. La vista de elegibles muestra por tanto totales por categoría, requisitos y qué les falta a los que no alcanzan ninguna (con las reglas ya reflejadas en `raffleRules`), y lo dice en pantalla. Contrato propuesto, sin implementar: `raffle_eligible_participants(p_category_id uuid)` → `[{ participant_id, display_name, academic_stamps, university_life_stamps, category_id, evidence: [{ activity_name, activity_type, credits, attended_at }] }]`, con las mismas guardas de entorno que `raffle_prizes_read`.
2. **Un ganador pendiente solo puede descartarse como «no se presentó».** `invalidate_winner` exige estado `confirmado` y rol Coordinación; no hay un descarte con motivo para `seleccionado`. «Invalidar / volver a sortear» existe solo después de confirmar.
3. **Nombres para la animación.** Al no existir la lista de elegibles, la animación no puede recorrer nombres reales; usa el efecto de letras que se resuelven sobre el nombre que devuelve `draw_winner`.
4. `pool_count` de la vista no excluye ganadores pendientes de otros premios ni el último «no se presentó» del premio, que `draw_winner` sí excluye; el «Elegido entre N» tras sortear usa `pool_size` del propio sorteo.

## Validación

`npm run typecheck`, `npm run build` y `npm test` (ver el PR). Navegador real (Chrome) contra la app local y un Supabase ficticio en memoria: escritorio 1440 × 900, proyección 1920 × 1080 y móvil 390 × 844; sin desbordamiento horizontal ni errores de consola. Capturas en `visual-evidence/sorteo-*.jpg`.
