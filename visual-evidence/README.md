# Evidencia visual · administrador

Capturas del navegador integrado con respuestas locales ficticias; no contienen datos de Supabase. Anchuras verificadas: escritorio 1440 × 900 y móvil 390 × 844. En los tres módulos, `document.documentElement.scrollWidth` coincidió con la anchura móvil de 390 px.

| Experiencia | Escritorio | Móvil | Estados adicionales |
| --- | --- | --- | --- |
| Participantes | [Listado abundante](participants-desktop.jpg) | [Listado compacto](participants-mobile.jpg) | [Sin resultados](participants-empty-mobile.jpg) |
| Sorteo final · Preparación | [Categorías, premios y elegibles](sorteo-preparacion-desktop.jpg) | [Preparación](sorteo-preparacion-movil.jpg) | [Entorno DEMO](sorteo-preparacion-demo-desktop.jpg), [validación en escritorio](sorteo-formulario-error-desktop.jpg), [validación en móvil](sorteo-formulario-error-movil.jpg), [sin categorías](sorteo-vacio-movil.jpg) |
| Sorteo final · Ejecutar | [Listo](sorteo-ejecutar-desktop.jpg), [sorteando](sorteo-ejecutar-sorteando-desktop.jpg), [ganador](sorteo-ejecutar-ganador-desktop.jpg), [«no se presentó»](sorteo-ejecutar-no-presento-desktop.jpg), [confirmado](sorteo-ejecutar-confirmado-desktop.jpg), [rol Sorteo](sorteo-rol-sorteo-desktop.jpg) | [Consola](sorteo-ejecutar-movil.jpg), [ganador](sorteo-ejecutar-ganador-movil.jpg) | [Premio agotado](sorteo-ejecutar-agotado-desktop.jpg), [categoría sin premios](sorteo-ejecutar-sin-premios-desktop.jpg), [sin categorías](sorteo-ejecutar-vacio-movil.jpg) |
| Sorteo final · Proyección (1920 × 1080) | [Listo](sorteo-proyeccion-listo-1920.jpg), [sorteando](sorteo-proyeccion-sorteando-1920.jpg), [ganador](sorteo-proyeccion-ganador-1920.jpg), [controles ocultos](sorteo-proyeccion-controles-ocultos-1920.jpg), [confirmado](sorteo-proyeccion-confirmado-1920.jpg) | — | [Ensayo con nombre largo](sorteo-proyeccion-demo-nombre-largo-1920.jpg) |
| Sorteo final · Historial | [Historial](sorteo-historial-desktop.jpg) | [Historial](sorteo-historial-movil.jpg) | — |
| Check-in | [Operación](checkin-desktop.jpg), [credencial](credential-desktop.jpg) | [Operación](checkin-mobile.jpg), [credencial](credential-mobile.jpg) | [Proyección](credential-projection-desktop.jpg) |

Las capturas del Sorteo (prefijo `sorteo-`) se tomaron con Chrome sobre la app local y un servidor Supabase ficticio en memoria: 3 categorías reales y 2 de prueba con nombres repetidos, 6 premios (uno agotado, una categoría sin premios), 6 resultados en todos los estados y un nombre de 60 letras. Ver [`docs/sorteo-redesign.md`](../docs/sorteo-redesign.md). Anchuras: 1440 × 900, 1920 × 1080 y 390 × 844; en ninguna hubo desbordamiento horizontal ni errores de consola.

Los datos ficticios de Participantes y Check-in incluyen 32 participantes, categorías reales y DEMO con nombres repetidos, tres premios y seis talleres con varios horarios. Se comprobó la selección de taller, el paso a credencial, el regreso, la separación de categorías y premios por entorno, un listado largo, dos estados vacíos y un formulario con error de validación.
