# Descarga masiva de QR de talleres (Coordinación)

Ruta: **Operación → Check-in → «Descargar QR de talleres»** (`/coordinacion/checkin/qr-talleres`, solo Coordinación).

## Qué hace
- Reutiliza el QR y el código manual **vigentes** de cada actividad (uno por taller, válido para todos sus horarios). No crea, rota ni regenera nada.
- Funciona con la edición en `preparacion`: los talleres reales publicados son oficiales. Por defecto solo `is_demo = false`; los DEMO se activan expresamente y salen marcados.
- Formatos: ZIP por tallerista (una página por taller), ZIP por división (un taller de varias divisiones va en cada una con el mismo QR) y concentrado general (un PDF, un QR por taller). También PDF de un solo taller.
- Lista de control opcional (CSV, sin tokens ni códigos manuales) y lista de destinatarios deduplicada por correo.

## Origen de los datos
- Metadatos: RPC de solo lectura `activity_export_metadata()` (migración `20261013120000_activity_export_metadata.sql`, **sin aplicar** a Supabase). Solo Coordinación; no devuelve tokens, solo si hay credencial y cuándo se emitió.
- Credenciales: `activity_credential_display` existente (audita cada consulta). Ese RPC sigue permitiendo al Staff operativo; esta pantalla solo la abre Coordinación.

## Seguridad
Los tokens viven solo en memoria durante la exportación (no en URL, almacenamiento, consola ni telemetría); los PDF no se suben a ningún servidor. Si una credencial no se obtiene o cambia durante la descarga, no se entrega un archivo incompleto: se informa y se puede reintentar, o descargar sin esos talleres tras confirmarlo (ZIP con `FALTANTES.txt`). Regenerar una credencial después invalida los PDF anteriores de ese taller (comportamiento existente). No se envían correos.

## Pruebas
`npx vitest run` (incluye rasterizado de PDF y lectura del QR con jsQR), `supabase/tests/regression_activity_export_metadata.sql` en base local descartable.
