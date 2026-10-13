# Evidencia visual · administrador

Capturas del navegador integrado con respuestas locales ficticias; no contienen datos de Supabase. Anchuras verificadas: escritorio 1440 × 900 y móvil 390 × 844. En los tres módulos, `document.documentElement.scrollWidth` coincidió con la anchura móvil de 390 px.

| Experiencia | Escritorio | Móvil | Estados adicionales |
| --- | --- | --- | --- |
| Participantes | [Listado abundante](participants-desktop.jpg) | [Listado compacto](participants-mobile.jpg) | [Sin resultados](participants-empty-mobile.jpg) |
| Sorteo final · En vivo | [Inicio con inventario parcial](sorteo-en-vivo-desktop.jpg), [premio elegido](sorteo-seleccion-premio-desktop.jpg), [ganador](sorteo-ganador-desktop.jpg), [confirmado](sorteo-confirmado-desktop.jpg), [ensayo del evento](sorteo-ensayo-desktop.jpg), [10 tarjetas Amazon: avance](sorteo-inventario-parcial-desktop.jpg) y [premio completo](sorteo-premio-agotado-desktop.jpg), [rol Sorteo](sorteo-rol-sorteo-desktop.jpg) | [En vivo](sorteo-en-vivo-movil.jpg), [sin premios preparados](sorteo-en-vivo-sin-premios-movil.jpg) | [ganador recuperado tras perder la respuesta](sorteo-recuperado-desktop.jpg) |
| Sorteo final · Premios (Coordinación) | [Premios oficiales con entregas](sorteo-premios-desktop.jpg), [catálogo pendiente](sorteo-premios-pendiente-desktop.jpg), [parcial](sorteo-premios-parcial-desktop.jpg), [plan de preparación](sorteo-premios-preparar-pending-desktop.jpg), [listo con premios anteriores](sorteo-premios-listos-extras-desktop.jpg) | [Premios](sorteo-premios-movil.jpg), [pendiente](sorteo-premios-pendiente-movil.jpg) | — |
| Sorteo final · Pantalla pública (1920 × 1080) | [Ganador en ensayo](sorteo-publico-ganador-1920.jpg) | — | — |
| Sorteo final · Ensayo y fallos de lectura | [Elegir los registros del ensayo](sorteo-ensayo-registros-desktop.jpg), [ensayo en vivo](sorteo-ensayo-en-vivo-desktop.jpg), [sorteo oficial](sorteo-oficial-desktop.jpg), [error al actualizar](sorteo-error-actualizacion-desktop.jpg), [primera lectura fallida](sorteo-primera-lectura-fallida-desktop.jpg), [ganador pendiente recuperado](sorteo-pendiente-recuperado-desktop.jpg), [dos ventanas preparando](sorteo-dos-ventanas-ocupada-desktop.jpg), [tras la limpieza: sin categorías de prueba](sorteo-ensayo-sin-categorias-prueba-desktop.jpg), [Premios sin categorías](sorteo-premios-sin-categorias-desktop.jpg) | [Elegir registros](sorteo-ensayo-registros-movil.jpg) | — |
| Sorteo final · Ganadores | [Ganadores](sorteo-ganadores-desktop.jpg) | [Ganadores](sorteo-ganadores-movil.jpg) | — |
| Check-in | [Operación](checkin-desktop.jpg), [credencial](credential-desktop.jpg) | [Operación](checkin-mobile.jpg), [credencial](credential-mobile.jpg) | [Proyección](credential-projection-desktop.jpg) |

Las capturas del Sorteo (prefijo `sorteo-`; simplificación de la experiencia) se tomaron con Chrome sobre la app local y un servidor Supabase ficticio en memoria: los dos conjuntos de registros (reales y de prueba) con categorías homónimas, el catálogo oficial completo, parcial o sin registrar, premios anteriores ajenos al catálogo, entregas parciales y un resultado invalidado. Ver [`docs/sorteo-simplificado.md`](../docs/sorteo-simplificado.md). Anchuras: 1440 × 900, 1920 × 1080 y 390 × 844; sin desbordamiento horizontal.

Los datos ficticios de Participantes y Check-in incluyen 32 participantes, categorías reales y DEMO con nombres repetidos, tres premios y seis talleres con varios horarios. Se comprobó la selección de taller, el paso a credencial, el regreso, la separación de categorías y premios por entorno, un listado largo, dos estados vacíos y un formulario con error de validación.

## Portal del alumno · rangos y Lions Sport Center

Capturas móviles (390 × 844, ×2) con un Supabase ficticio local: [Bitácora con 0 sellos](bitacora-rangos-0-sellos-movil.jpg), [2 sellos](bitacora-rangos-2-sellos-movil.jpg), [4 sellos (rango máximo)](bitacora-rangos-4-sellos-movil.jpg), [6 sellos (sigue en el máximo)](bitacora-rangos-6-sellos-movil.jpg) y [mapa con una misión en el Lions Sport Center (D3)](mapa-lions-sport-center-movil.jpg).
