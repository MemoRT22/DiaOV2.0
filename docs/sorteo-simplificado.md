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
- No se ha ejecutado contra el Supabase del proyecto.

## Ensayo u oficial
La edición manda: `preparacion` → **Ensayo del evento**, `operacion_real` → **Sorteo oficial**. Es una insignia en el encabezado y, en ensayo, una marca en el escenario y en la pantalla pública. No se muestra ningún interruptor de datos ni categorías duplicadas.

El servidor tiene dos conjuntos de registros (`is_demo`). Para elegir uno (`pickDataSet`, una vez por visita, sin mezclar jamás premios, participantes ni ganadores):
- Oficial: los reales.
- Ensayo, rol Sorteo: el conjunto de prueba, que es el único que el servidor le permite.
- Ensayo, Coordinación: el conjunto que tiene a los participantes del ensayo (el de prueba o, si los participantes del ensayo están marcados como reales, ese); si hay en ambos o en ninguno, el de prueba si existe. Se explica en «Detalles técnicos», plegado en Premios.

## Orden sugerido
Se sugiere ir de los premios menores al mayor (Sistema Solar → Galaxia → Universo); cualquier premio se puede elegir en cualquier momento. «Siguiente ronda» continúa con el mismo premio hasta agotarlo y luego pasa al siguiente con unidades.

## Limitaciones
1. **Si los participantes del ensayo están marcados como reales y los de prueba no existen, el rol Sorteo no puede ensayar**: el servidor solo le permite el conjunto de prueba en `preparacion`. Coordinación sí puede. No se cambió ningún permiso.
2. **Tras «Reiniciar preparación»** el servidor borra los premios y categorías de prueba (los reales se conservan, sin ganadores). El catálogo se vuelve a preparar con el mismo botón; si se usan las categorías de prueba y ya no existen, la pantalla lo dice (no se recrean aquí).
3. Siguen vigentes las limitaciones de [`sorteo-redesign.md`](sorteo-redesign.md): sin lista de elegibles por persona, un ganador pendiente solo se descarta como «no se presentó», `pool_count` no descuenta exclusiones propias del sorteo.
