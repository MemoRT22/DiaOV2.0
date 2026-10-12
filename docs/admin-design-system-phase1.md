# Sistema de diseño del administrador · fase 1

## Base e integración

La rama `codex/admin-design-system-phase1` parte de `e020110`, punta del PR #35 (`feat/admin-crud-and-university-life-filter`). Al iniciar el trabajo, `origin/main` apuntaba a `c6a8f74`; el PR #35 estaba abierto, era fusionable y contenía el CRUD de participantes que usa esta interfaz. El PR de diseño debe tener **la rama del PR #35 como base**. Después de integrar #35, se puede cambiar su base a `main` y revisar el diff restante. No hace falta fusionar ni desplegar esta fase para revisarla.

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

`npm run build` terminó correctamente y `npm test` pasó 627 pruebas en 60 archivos. La compilación conserva el aviso existente de tamaño del paquete de `exceljs`. La inspección visual usa el navegador integrado con respuestas locales ficticias, a 1440 × 900 y 390 × 844. Se revisan listados abundantes, estado vacío, cambio entre datos reales y DEMO, modal abierto, validación errónea y proyección. Las capturas están en `visual-evidence/`. No se conectó a Supabase ni se modificaron datos.

Las cuatro capturas del diseño anterior mencionadas en la solicitud no estaban entre los archivos adjuntos disponibles al iniciar esta fase; la comparación directa con ellas queda pendiente de recibirlas.
