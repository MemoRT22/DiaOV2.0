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
- **Consola y pantalla pública separadas.** La consola conserva todos los controles, errores y avisos. La pantalla pública es una ventana propia (`/coordinacion/sorteo-publico`, «Abrir pantalla pública») que solo dibuja el escenario: categoría, premio, participantes, animación, ganador, celebración e indicador DEMO. No tiene botones ni enlaces, no consulta al servidor y se pone en pantalla completa con doble clic o la tecla `F` (el cursor se oculta solo). El operador la arrastra al proyector y conduce todo desde la consola; la consola indica si la ventana está conectada y, si se cierra y se vuelve a abrir, recupera la ronda tal como está.
- **Cómo se sincronizan.** La consola envía un estado público por un `BroadcastChannel` del mismo origen (sin infraestructura nueva). Ese estado (`src/lib/rafflePublic.ts`) no tiene campos para errores, avisos ni controles, y la ventana descarta cualquier mensaje que no tenga exactamente esa forma. Mientras un resultado está sin confirmar, la pública sigue «sorteando»; si una ronda no se puede sortear, muestra el título. Al cambiar entre REAL y DEMO o salir de la consola vuelve al título conservando la marca de ensayo.
- **Una sola pantalla.** «Ensayar en esta pantalla» abre el mismo escenario público a pantalla completa sin nada que pulsar: Espacio o Enter hacen el siguiente paso (sortear → confirmar → siguiente ronda) y Esc sale. La ausencia se registra saliendo con Esc. Cualquier problema cierra el ensayo para que el operador lo vea. Es para ensayos; en el evento real conviene la ventana aparte.

## Fiabilidad ante fallos de conexión

- **Premios pendientes.** Al entrar se pregunta por cada premio y el resultado es uno de tres: hay un ganador pendiente (se muestra), no lo hay, o no se pudo preguntar. El tercero nunca se lee como el segundo: ese premio queda «Sin comprobar», no se puede sortear y la pantalla ofrece «Reintentar comprobación»; los premios comprobados siguen disponibles. Un premio con 0 unidades por tener un ganador pendiente sigue siendo recuperable.
- **Una sola operación por sorteo.** «Sortear» fija de inmediato un seguro síncrono (el doble clic no llega a una segunda solicitud), genera una clave de idempotencia para esa operación y la conserva hasta que haya resultado o un rechazo definitivo.
- **Respuesta incierta.** Solo `POOL_EMPTY`, `PRIZE_EXHAUSTED`, `PRIZE_INACTIVE`, `CATEGORY_INACTIVE`, `NOT_AUTHORIZED`, `NOT_FOUND` y `PENDING_SELECTION` son definitivas. Con cualquier otro fallo (red, timeout, 5xx) se consulta `raffle_pending_selection`: si hay ganador, se muestra ese; si no hay ninguno, se ofrece «Reintentar sorteo», que reutiliza la misma clave (el servidor devuelve el ganador ya registrado en lugar de crear otro); si tampoco se puede consultar, la consola queda bloqueada en «Resultado sin confirmar» con «Comprobar de nuevo». No se elige ni se inventa nada en el frontend.
- **`POOL_EMPTY`.** Se explica que el servidor no encontró participantes para esa ronda aunque el conteo de la categoría muestre candidatos, y el premio no vuelve a ofrecerse con las mismas cifras (hay «Actualizar datos»); otros premios no se ven afectados.
- **Tamaño del pool.** «Elegido entre N participantes» solo aparece si `draw_winner` informó N para ese sorteo; una selección recuperada o una respuesta repetida no muestran cifra (nunca cero ni el conteo agregado).
- **Cambio de ventana.** Supabase repite `SIGNED_IN` de la misma cuenta cuando otra ventana de la app carga o una pestaña recupera el foco, y `AuthProvider` lo trataba como un inicio de sesión nuevo (`ready=false`), desmontando todo el administrador y reiniciando la ronda. Ahora ignora un `SIGNED_IN` de la cuenta ya cargada (`src/lib/auth.tsx`, con prueba).

## Limitaciones del backend detectadas

1. **No existe un RPC que liste a los participantes elegibles ni su desglose de sellos.** `raffle_operator_view` solo devuelve `pool_count` por categoría y, para Coordinación, combinaciones agregadas sin categoría; `attendances` y `participants` no son legibles para el personal por RLS. La vista de elegibles muestra por tanto totales por categoría, requisitos y qué les falta a los que no alcanzan ninguna (con las reglas ya reflejadas en `raffleRules`), y lo dice en pantalla. Contrato propuesto, sin implementar: `raffle_eligible_participants(p_category_id uuid)` → `[{ participant_id, display_name, academic_stamps, university_life_stamps, category_id, evidence: [{ activity_name, activity_type, credits, attended_at }] }]`, con las mismas guardas de entorno que `raffle_prizes_read`.
2. **Un ganador pendiente solo puede descartarse como «no se presentó».** `invalidate_winner` exige estado `confirmado` y rol Coordinación; no hay un descarte con motivo para `seleccionado`. «Invalidar / volver a sortear» existe solo después de confirmar.
3. **Nombres para la animación.** Al no existir la lista de elegibles, la animación no puede recorrer nombres reales; usa el efecto de letras que se resuelven sobre el nombre que devuelve `draw_winner`.
4. `pool_count` de la vista no excluye ganadores pendientes de otros premios ni el último «no se presentó» del premio, que `draw_winner` sí excluye; el «Elegido entre N» tras sortear usa `pool_size` del propio sorteo.

## Validación

`npm run typecheck`, `npm run build` y `npm test` (resultados en el PR). Navegador real (Chrome, dos ventanas) contra la app local y un Supabase ficticio en memoria con fallos inyectados (503 antes y después de registrar el ganador, comprobación caída): consola 1440 × 900, pantalla pública 1920 × 1080 y móvil 390 × 844; doble clic, cierre y reapertura de la pública, ausencia, DEMO, timeout con ganador registrado y sin registrar. En cada fase la pública tuvo 0 botones, enlaces o campos y ningún texto administrativo. Capturas en `visual-evidence/sorteo-*.jpg`.
