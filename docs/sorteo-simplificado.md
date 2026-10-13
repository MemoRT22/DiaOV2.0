# Sorteo final · experiencia simplificada

Sustituye la estructura Preparación / Ejecutar / Historial de [`sorteo-redesign.md`](sorteo-redesign.md). El motor (selección en el servidor, idempotencia, recuperación, doble clic, pantalla pública) **no cambia**; lo que cambia es qué decisiones ve Coordinación. No hay migraciones, Edge Functions ni cambios en Supabase.

## Tres lugares

| | Para qué | Quién |
| --- | --- | --- |
| **Sorteo en vivo** (abre aquí) | Premios por sortear, participantes elegibles, siguiente premio y el botón de sortear. Elegir premio → Sortear → revelar → Confirmar → Siguiente premio. Acceso a la pantalla pública. | Coordinación y rol Sorteo |
| **Premios** | Los 16 premios oficiales por categoría, con lo entregado y lo que falta; una sola acción para prepararlos si faltan. | Solo Coordinación |
| **Ganadores** | Quién ganó, qué premio, su categoría, si ya se entregó y cuándo. Invalidar, con motivo. | Todos; invalidar solo Coordinación |

Los enlaces anteriores (`?seccion=ejecutar`, `preparacion`, `historial`) siguen funcionando.

## Lo que se quitó de la experiencia cotidiana
Crear o editar categorías y requisitos, crear o editar premios, orden de clasificación, premios activos/inactivos, el interruptor REAL/DEMO y las categorías duplicadas. Las reglas de elegibilidad se muestran en lenguaje sencillo («Quién participa») y no se editan.

## Catálogo oficial (`src/lib/raffleCatalog.ts`)

| Categoría | Premio | Cantidad |
| --- | --- | ---: |
| Universo | MacBook Neo de 13 pulgadas, 256 GB | 1 |
| Universo | iPad Air de 64 GB | 2 |
| Galaxia | Apple Watch S3 GPS | 1 |
| Galaxia | Nintendo Switch OLED | 2 |
| Sistema Solar | Tarjeta de regalo Amazon de $1,200 MXN | 10 |

16 unidades en 3 categorías (3, 3 y 10). Las diez tarjetas son **un** premio con cantidad diez, no diez premios. Las especificaciones están literales.

**Qué es fijo y qué no.** La *definición* es fija. Las existencias y las entregas son del servidor (`raffle_prizes_read`, `raffle_winners_read`): nada se resta en React. «Entregadas» cuenta los resultados confirmados; un ganador por confirmar se muestra aparte y no consume una entrega hasta confirmarse.

**Preparar el catálogo.** Solo ocurre cuando Coordinación pulsa «Preparar premios oficiales» (o «Completar…») y confirma el plan; nunca al abrir la pantalla.
- Lee primero el servidor y reconoce lo ya registrado por categoría + nombre (sin importar acentos, mayúsculas ni espacios), así que repetirlo no duplica nada y la segunda vez no escribe nada.
- Usa únicamente `save_raffle_prize`, de uno en uno y en orden. Si falla a mitad, lo hecho se queda y volver a intentar continúa sin duplicar.
- Crea lo que falta y corrige cantidad o estado de lo ya registrado; no corrige hacia abajo una cantidad menor que lo ya comprometido (lo informa).
- No borra nada, no toca ganadores ni selecciones pendientes. Los premios anteriores que no son del catálogo se listan («Premios anteriores…»), no se ofrecen en el sorteo y no se modifican.
- Si falta una categoría en los registros usados, lo dice y no hace nada: las categorías y sus requisitos no se crean desde esta pantalla.
- **Dos ventanas.** Solo una ventana del mismo navegador puede preparar a la vez (Web Locks; en navegadores sin ellos, un candado en `localStorage` con caducidad, que reduce pero no elimina la carrera). La segunda no escribe nada y lo dice. Además vuelve a leer la categoría justo antes de crear cada premio. **Entre computadoras o navegadores distintos no hay garantía**: `save_raffle_prize` sin `id` siempre inserta y no existe una restricción única (categoría, nombre) ni un upsert, así que dos preparaciones simultáneas desde equipos distintos podrían duplicar un premio. Garantizarlo exige un cambio del servidor (ver Limitaciones).
- No se ha ejecutado contra el Supabase del proyecto.

## Ensayo u oficial
La edición manda: `preparacion` → **Ensayo del evento** («Las selecciones se guardan como pruebas y deberán limpiarse antes del evento»: el servidor sí registra resultados, consume inventario y genera historial; lo temporal es que se limpiarán), `operacion_real` → **Sorteo oficial**. Es una insignia en el encabezado y, en ensayo, una marca en el escenario y en la pantalla pública. No hay interruptor de datos ni categorías duplicadas.

El servidor tiene dos conjuntos de registros (`is_demo`). **El frontend no escoge uno según cuántos participantes tenga** (`resolveDataSet` no recibe conteos); se deriva en cada render del modo y de una elección explícita, así que un cambio de modo no puede dejar atrás el conjunto anterior:

| Contexto | Conjunto |
| --- | --- |
| Sorteo oficial (cualquier rol) | Siempre el oficial (`is_demo = false`), sin importar conteos ni la elección del ensayo |
| Ensayo, rol Sorteo | El de prueba: es el único que el servidor le permite |
| Ensayo, Coordinación | El que Coordinación elija en un paso guiado; mientras no elija, no hay sorteo |

El paso guiado («¿Con qué registros se hará el ensayo?») aparece una vez, solo para Coordinación y solo en ensayo. Ofrece «Participantes cargados hasta ahora» (los registros temporales que el sistema aún marca como oficiales) y «Participantes de prueba del sistema», con lo que tiene cada uno para decidir con información, sin preseleccionar. Un conjunto sin las categorías oficiales no se puede elegir. La elección se guarda en este navegador (el servidor no guarda nada de esto), por edición; se puede cambiar desde «Cambiar» en Sorteo en vivo o en Premios → Detalles técnicos, pero no mientras haya una ronda en curso o un ganador por confirmar. Nunca cambia sola: ni entre rondas ni porque un conjunto se quede sin elegibles. Al pasar a operación oficial se usa el oficial al instante; al volver a ensayo se pregunta de nuevo.

## Lecturas del servidor (inventario)
La información visible es siempre **una** lectura completa. Si una actualización falla (una categoría o todas, o la vista de participantes), no se publica nada a medias: se conserva la última lectura completa, aparece el aviso «No se pudo actualizar…» con «Reintentar», y solo se detienen los **sorteos nuevos**; confirmar, marcar ausencia o invalidar un resultado ya en curso siguen funcionando. Una primera lectura fallida se muestra como tal («No significa que no existan»), nunca como catálogo vacío ni como «Preparar premios oficiales».

## Entregados, pendientes y desconocidos
`raffle_prizes_read.delivered` suma resultados `seleccionado` y `confirmado`. Entregado = `confirmado`; por confirmar = `seleccionado`; por sortear = `available` del servidor. Si los resultados no se pudieron leer, las entregas se marcan «sin verificar» y solo se muestra lo comprometido que el servidor sí informó: no se inventa una cantidad confirmada ni un pendiente se muestra como entregado.

## Orden sugerido
Se sugiere ir de los premios menores al mayor (Sistema Solar → Galaxia → Universo); cualquier premio se puede elegir en cualquier momento. «Siguiente ronda» continúa con el mismo premio hasta agotarlo y luego pasa al siguiente con unidades.

## Limitaciones
1. **Preparación simultánea desde equipos distintos.** Falta una restricción única `(edition_id, category_id, lower(name))` en `raffle_prizes` o un RPC de alta idempotente; el frontend solo puede excluir ventanas del mismo navegador.
2. **El rol Sorteo solo puede ensayar con los registros de prueba** (el servidor no le permite los oficiales en `preparacion`). Si los participantes provisionales están marcados como oficiales y no existen de prueba, solo Coordinación puede ensayar. No se cambió ningún permiso.
3. **La elección del ensayo es del navegador**, no del servidor: otra computadora de Coordinación vuelve a preguntar. Un campo en la edición lo resolvería de forma compartida.
4. **Después de la limpieza.** «Reiniciar preparación» borra los ganadores, los participantes (todos) y los premios y categorías de prueba; las categorías y premios oficiales (no `is_demo`) se conservan sin ganadores. El módulo reconoce si faltan categorías: el paso del ensayo no deja elegir un conjunto sin ellas y Premios nombra las que faltan sin ofrecer preparar nada. Si se quiere volver a ensayar con registros de prueba después de la limpieza, **restablecer sus tres categorías es un paso técnico en el servidor** (con los requisitos oficiales); esta pantalla no las crea. Con los registros oficiales no hace falta ningún paso: el catálogo se vuelve a preparar con el mismo botón si falta algo.
5. Siguen vigentes las de [`sorteo-redesign.md`](sorteo-redesign.md): sin lista de elegibles por persona, un ganador pendiente solo se descarta como «no se presentó», y `pool_count` no descuenta exclusiones propias del sorteo.
