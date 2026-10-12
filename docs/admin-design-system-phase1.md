# Sistema de diseño del administrador · fase 1

## Base e integración

La rama `codex/admin-design-system-phase1` se creó inicialmente sobre el PR #35 (`feat/admin-crud-and-university-life-filter`) para conservar su CRUD de participantes. Tras fusionar #35 en `main` con `9c411fec`, la rama se rebasó sobre ese merge y el PR #36 cambió su base a `main`. El diff resultante contiene únicamente el sistema de diseño, las tres experiencias de esta fase, pruebas, documentación y evidencia visual. No incluye backend, migraciones ni Edge Functions. El PR continúa en borrador para revisión visual, sin fusión ni despliegue a producción.

## Decisiones del sistema

- **Tipografía y densidad.** Inter, títulos de 26–32 px, texto principal de 14 px y metadatos de 12–13 px. Los listados usan filas compactas y una sola superficie por bloque.
- **Color.** La paleta fija de `adminTheme.ts` es la fuente de los colores del administrador. Fondo y superficies neutros, texto carbón, naranja Anáhuac para la acción principal y selección; éxito, aviso y error conservan significado semántico. El portal del alumno mantiene su tema independiente.
- **Espacio y forma.** Ritmo basado en 8 px; controles de 40–42 px; radio de 8 px en controles y 11–14 px en paneles y diálogos. Bordes sutiles, elevación mínima y sin gradientes en estas tres experiencias.
- **Patrones.** `PageHeader` coloca título, contexto, descripción y acción principal en el mismo lugar. `SectionTabs` cambia secciones; `ScopeSwitch` cambia el entorno de datos; `SearchField` busca; `DataPanel` y `RowAction` ordenan listados; `EmptyState` y `SectionHeading` mantienen el mismo lenguaje de contenido. Todos están en `src/admin/design/Primitives.tsx` y sus reglas en `src/admin/design/system.css`.
- **Formularios y estados.** Se reutilizan `Button`, `Field`, `SelectField`, `Badge`, `Alert` y `Modal` de `src/components/ui.tsx`. Los formularios largos del administrador comparten pie de acciones visible al desplazarse. Los controles tienen estados hover, focus, disabled y loading; los errores aparecen cerca de la acción. Las pestañas admiten flechas, Inicio y Fin.
- **Librerías.** Se mantiene React, Tailwind y las primitivas existentes. Una librería adicional aportaría componentes predeterminados y una segunda capa de estilos sin resolver la divergencia actual; los patrones nuevos son pequeños, semánticos y compartidos.

## Experiencias de esta fase

### Participantes

La creación manual autorizada por el PR #35 queda como acción primaria. Buscar, importar y exportar se agrupan en la barra de trabajo. Nombre y correo identifican cada fila; teléfono y carrera ayudan a desambiguar. El origen es metadato y solo se destaca el estado que requiere más atención. El expediente es el destino de consulta y editar datos queda como acción discreta. En móvil las filas conservan la misma secuencia, sin convertirse en tarjetas independientes.

### Sorteo final

> Rediseñado después en una segunda iteración: ver [`sorteo-redesign.md`](sorteo-redesign.md). Lo que sigue describe la primera.

La navegación del área, las pestañas Categorías/Premios/Ganadores y el filtro de entorno tienen formas y posiciones distintas. Los datos reales y de prueba se ven por separado, incluso cuando sus categorías comparten nombre. Los premios se filtran por una categoría explícita y muestran disponibilidad frente a cantidad total. El aviso sobre sellos sin categoría permanece disponible como detalle desplegable solo en el entorno de la edición activa, que es el alcance de ese dato. Crear y editar respetan el entorno seleccionado; no se alteraron las reglas de elegibilidad ni de sorteo.

### Check-in

La vista operativa permite seleccionar un taller y consultar horarios, reservas y asistencias antes de abrir su credencial. La vista de presentación separa QR y código manual de las métricas administrativas. Imprimir es la acción principal; pantalla completa y regenerar están juntos. La regeneración conserva la confirmación con motivo y la lógica existente. La tarjeta impresa excluye la navegación y los controles.

## Inventario para consolidar en la siguiente fase

| Patrón actual | Estado / destino |
| --- | --- |
| `.admin-participant-table` y `.admin-participant-actions` | Retirados en esta fase; sustituidos por la tabla responsive de `system.css`. |
| `.admin-action-link` con variante `data-primary` | Sigue en Talleres, Catálogos, Personal y Operación. Sustituir por `RowAction`, `Button` o enlace secundario según la acción. |
| `.admin-filter-choice` | Sigue en Talleres. Consolidar con filtros semánticos y `ScopeSwitch` cuando se migre ese módulo. |
| `.admin-operation-tabs` y pestañas locales | Siguen en Centro de Operación y otros módulos. Migrar a `SectionTabs` o navegación de área según cambien contenido o ruta. |
| `.admin-hero`, `.admin-feature-card`, `.admin-stat`, `.admin-hero-orbit` | Siguen en Inicio, Configuración y Operación. Revisar su función y retirar el ornamento innecesario al migrarlos. |
| Encabezados y barras de acciones hechos por pantalla | Siguen en Talleres, Catálogos, Exportación, Personal y Configuración. Migrar a `PageHeader` y `SectionHeading`. |

Los siguientes módulos que deben adoptar este sistema son: Centro de Operación, Talleres (lista, expediente y edición), Catálogos académicos, Personal, Exportación, Configuración e Inicio. El portal del alumno queda fuera de esta fase.

## Validación

Tras rebasar sobre `main` y corregir el selector DEMO, `npm run typecheck` y `npm run build` terminaron correctamente; `npm test` pasó 628 pruebas en 60 archivos. La compilación conserva el aviso existente de tamaño del paquete de `exceljs`. La inspección visual inicial usó el navegador integrado con respuestas locales ficticias, a 1440 × 900 y 390 × 844. Se revisaron listados abundantes, estado vacío, cambio entre datos reales y DEMO, modal abierto, validación errónea y proyección. Las capturas están en `visual-evidence/`. No se conectó a Supabase ni se modificaron datos.

## Comparación con las cuatro capturas originales

El usuario aportó después las cuatro capturas del administrador anterior. Se revisaron contra las imágenes renderizadas de `visual-evidence/` a 1440 × 900 y 390 × 844. Las capturas originales se usan como referencia de evaluación; no se copian al repositorio porque la tabla de participantes muestra nombres, correos y teléfonos personales.

| Captura original | Problema visible | Resultado en esta fase | Evidencia nueva |
| --- | --- | --- | --- |
| Participantes | Importar y exportar dominaban la cabecera; el expediente y editar tenían botones de peso similar; origen, entorno y acceso acumulaban etiquetas en cada fila. | Crear es la acción principal. Buscar, importar y exportar forman la barra de trabajo. El nombre y correo abren la lectura de la fila; el origen es metadato y solo se destaca el estado prioritario. El expediente y editar tienen acciones discretas. | `participants-desktop.jpg`, `participants-mobile.jpg` |
| Sorteo / Categorías | Las pestañas tenían forma de píldora, el aviso de sellos ocupaba una tarjeta prominente y la acción de crear quedaba aislada sobre el listado. | Categorías, Premios y Ganadores usan la navegación de sección; el entorno REAL/DEMO tiene un control aparte. Crear queda en la cabecera y el aviso de sellos se consulta como detalle desplegable. | `sorteo-preparacion-desktop.jpg`, `sorteo-preparacion-movil.jpg` |
| Sorteo / Premios | La fila de filtros repetía nombres como Universo, Galaxia y Sistema Solar al mezclar categorías DEMO y REAL. El estado vacío no aclaraba el inventario de la selección. | Primero se elige el entorno y luego una categoría en un selector con una sola opción por nombre dentro de ese entorno. El encabezado indica los premios configurados y las unidades disponibles; el estado vacío pertenece a esa selección. | `sorteo-preparacion-demo-desktop.jpg`, `sorteo-vacio-movil.jpg` |
| Check-in / Credencial | Un QR grande, el código manual, las métricas y los horarios compartían la misma pantalla de operación. La tarjeta desplazaba la información operativa hacia abajo. | La operación muestra lista de talleres, horarios, reservas y asistencias. La credencial se abre aparte; imprimir, pantalla completa, volver y regenerar tienen controles claros. La proyección agranda el QR y el código sin métricas ni navegación. | `checkin-desktop.jpg`, `credential-desktop.jpg`, `credential-projection-desktop.jpg` |

En la revisión para integrar se detectó y corrigió que, tras crear la primera categoría DEMO, Premios podía conservar internamente la selección de una categoría REAL. Ahora la selección se reconcilia con el entorno visible y se cubre con una prueba de regresión. El flujo de la rama sigue sujeto a la revisión del PR y a las comprobaciones con datos y permisos reales del proyecto.
