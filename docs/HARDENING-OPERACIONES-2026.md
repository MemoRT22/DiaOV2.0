# Hardening preventivo de operaciones críticas — Día OV 2026

Base: `main` en `11156e0` (PR #56 incluido). Rama: `codex/critical-operations-hardening`. Auditoría: 15 de octubre de 2026.

## Diagnóstico previo

El incidente histórico ocurrió en **Micro**, antes del escalamiento a Large. Esta entrega no mide la capacidad de Large ni extrapola una prueba de 2,000 usuarios.

Se inspeccionó `main` y se hicieron consultas remotas exclusivamente de metadatos: código desplegado, definiciones SQL, índices y permisos. No se consultaron datos personales ni se realizaron escrituras de prueba.

| Área | Riesgo confirmado | Garantías ya presentes, preservadas |
| --- | --- | --- |
| Escáner | Plazo genérico de 45 s, pérdida del contexto HTTP, sin recuperación del intento ni bloqueo común QR/manual. | PostgreSQL bloquea al participante y aplica idempotencia por actividad e índices únicos por sesión y actividad. |
| Después del sello | Lecturas inmediatas de progreso, tablero, categoría y premios; respuestas que podían actualizar un escaneo obsoleto. | El éxito ya era independiente de las lecturas de progreso/ruta/categoría. Premios ya tenía proveedor compartido y exclusión de lecturas en vuelo. |
| Participantes | Sin plazos explícitos; temporales degradados a 500; el fallo de vinculación podía borrar la cuenta creada. | Auditoría previa, recuperación por correo con verificación de tipo/propietario y distinción entre ausencia confirmada de Auth y consulta inconclusa. |
| Staff | Sin plazos; rollback ante cualquier error de INSERT; auditoría fallida podía ignorarse; log del objeto de error completo. | Verificación de Coordinación y restricciones de roles y último coordinador. |
| Talleres | Sin plazos; infraestructura confundida con 401/500. | Mutaciones importantes mediante RPC atómicas. |

Comparación del despliegue al iniciar: `student-access` v9, `participant-admin` v3, `staff-accounts` v3 y `workshop-admin` v6 coinciden con `main` en sus archivos principales. El `workshop-intake/validation.ts` incluido en el bundle de `workshop-admin` conserva una constante `FIXED_SCHEDULE` sin uso; es la única diferencia del archivo, sin cambio de validación efectiva. `student-access` se deja intacta.

Se comprobó `has_table_privilege`: `authenticated` **no** tiene SELECT sobre `reservations` ni `attendances`, aunque existan políticas RLS. No se añade una consulta directa que el contrato desplegado prohíbe ni se amplían permisos. `my_progress.reserved_workshops` usa `active_reservation_count`: si confirma cero, se omite el tablero; con ruta activa, progreso fallido o aún pendiente se conserva una lectura autorizada diferida. La cifra de 35,557 ejecuciones y 124 ms del tablero procede del encargo, no es una medición nueva.

## P0 — Escaneo y distribución de lecturas

`operationRequest` hace un solo intento autenticado, con plazo que cubre sesión, cabeceras y cuerpo. `checkIn` usa **12 s** sin cambiar el plazo genérico, importaciones ni exportaciones. Conserva RPC, argumento y JWT. 429 conserva `RATE_LIMITED`; 5xx (incluidos 502/503/504/521), 408, desconexión, timeout o éxito ilegible son temporales/resultados inciertos; los rechazos de negocio mantienen su mensaje. Se valida la forma de la respuesta antes de celebrar.

La pantalla explica que la asistencia **podría haberse registrado** y ofrece reconfirmar el mismo QR/código. La credencial vive sólo en memoria y se descarta al confirmar, reiniciar o salir; no entra en URL, almacenamiento ni logs. `Retry-After` se interpreta como segundos o fecha HTTP, con el tope de cordura existente de una hora; sin indicación se esperan 3–6 s. Al terminar la espera se habilita el botón, sin reenvío automático. QR, manual y reconfirmación comparten bloqueo síncrono en vuelo.

Una respuesta idempotente no muestra sellos adicionales. Recuperar una respuesta perdida sincroniza las otras pestañas y proveedores, porque el primer commit pudo ocurrir sin notificación del navegador.

| Lectura secundaria | Inicio tras el éxito | Máximo por escaneo |
| --- | --- | --- |
| Progreso | 300–1,200 ms | 1 |
| Categoría del sorteo | 500–1,500 ms | 1 |
| Tablero | 1,000–3,000 ms | 0 si progreso ya confirma cero reservas activas; en otro caso 1 |
| Premios / estado de encuesta | Cada proveedor programa 500–2,000 ms | Avisos coalescidos; nunca dos lecturas simultáneas por proveedor |

El sello se confirma inmediatamente con los totales del servidor. Al salir o iniciar otro escaneo se cancelan temporizadores y se descartan respuestas obsoletas; las lecturas ya enviadas no se reintentan. Los proveedores sobreviven a la navegación. Una lectura empezada antes del sello termina antes de consultar el estado nuevo. Se conservan `poll_seconds`, backoff, expiración de verificación y reclamo atómico de la encuesta; no se toca su envío de respuestas ni se añade polling.

## P1 — Recuperación administrativa

Auth tiene 15 s por operación y PostgREST 8 s, incluyendo el cuerpo. `participant-admin` limita el recorrido a 50 s y el navegador espera 55 s. Tras vencer el plazo no empiezan nuevos pasos; una escritura ya enviada puede terminar y queda como resultado incierto.

Nunca se borra una identidad como compensación del restablecimiento. El siguiente intento auditado usa el vínculo existente o recupera la cuenta por correo, verificando tipo y propietario. Auth inconcluso no se interpreta como inexistencia. 429/503 se propagan con `Retry-After` expuesto por CORS. La auditoría sigue siendo previa y falla cerrado.

Solicitudes concurrentes del mismo participante en una instancia reciben 409 `OPERATION_IN_PROGRESS`; el bloqueo permanece hasta que termine una dependencia tardía. La unicidad de correo de Auth y de `auth_user_id` en PostgreSQL se conserva. Una marca explícita de Staff tampoco puede ser sobrepasada por un correo sintético heredado.

El panel evita doble envío, respeta la espera y explica que la contraseña pudo cambiar. No presenta una contraseña generada sin confirmación. `friendlyError` deja de registrar objetos privados de error.

## P2 — Correcciones pequeñas y límites

Staff y talleres reutilizan transporte con plazo y clasificación temporal, sin cambiar sus RPC ni reglas. Sus clientes tienen plazo y no reenvían escrituras automáticamente. Staff omite el rollback de Auth ante INSERT incierto y comprueba la auditoría. Se extrajo su handler del punto de entrada Deno para probar esas decisiones con dependencias simuladas.

Quedan fuera por requerir cambios más amplios:

- **Serialización distribuida de contraseñas:** el bloqueo local no cubre distintas instancias Edge ni autorregistro concurrente. No duplica cuentas por correo, pero dos restablecimientos legítimos entre instancias pueden terminar con la última contraseña aplicada. Requiere coordinación persistente; no se improvisó una tabla/lease/migración.
- **Staff en varias etapas:** identidad, miembro, roles y auditoría no son una transacción. Una interrupción puede dejar un alta parcial que requiere inspección antes de repetir. Recuperación automática y serialización distribuida del último coordinador quedan pendientes.
- Timeout no equivale a rollback. Reconfirmar check-in es idempotente; restablecer contraseña es una acción nueva auditada. No se declara idempotente un alta administrativa arbitraria.
- Se conserva el límite existente de búsqueda de cuentas: cinco páginas de 1,000 usuarios.

## Pruebas y evidencia

- Vitest: **109 archivos, 1,376 pruebas correctas**, incluidos 26 casos nuevos de transporte, recuperación, concurrencia de pantalla, salida, lecturas secundarias y coalescencia. Pasan Bitácora, Mi ruta, encuesta, sorteo, navegación/mapa y hojas con zoom.
- Edge Functions con Node: **143 pruebas correctas**, incluidos 11 casos nuevos; suites de transporte, acceso, participantes, Staff, talleres e intake. La integración externa de intake se comprobó adicionalmente: sus 11 casos quedaron omitidos al no existir `WORKSHOP_INTAKE_URL`.
- `npm run typecheck` y `npm run build`: correctos. Se conserva el aviso existente de tamaño de ExcelJS.
- Tipos de handlers, pruebas y tres puntos de entrada administrativos: correctos usando un shim mínimo de `Deno.env`/`Deno.serve` sólo en `/private/tmp`. No se añadió dependencia ni configuración al repositorio.
- `git diff --check`: correcto. Lockfile, migraciones, estilos, mapa y navegación sin cambios.

Evidencia reproducible: `src/lib/checkin.test.ts` cubre QR/manual, timeout de petición/cuerpo, 429 con espera, infraestructura y guardado simulado con respuesta perdida. `src/student/ScannerResilience.test.tsx` cubre reconfirmación idempotente del mismo QR, doble envío QR/manual, salida durante petición, éxito independiente de fallos secundarios y cero/una lectura del tablero según progreso. `operationRequest.test.ts` y `PasswordAccess.test.tsx` cubren transporte administrativo y espera manual. `WinnerFlow.test.tsx` verifica coalescencia y cadencia preservada.

`participant-admin/handler.test.ts` cubre creación/restablecimiento, Auth temporal, vínculo confirmado con respuesta perdida, cuenta creada sin vincular, reintento, auditoría, propietario, roles y concurrencia local. El deadline deja la cuenta intacta y no inicia pasos tardíos. `staff-accounts/handler.test.ts` confirma que un INSERT incierto no borra Auth y una auditoría fallida no reporta éxito. `workshop-admin/handler.test.ts` conserva errores de negocio y 429/503 sin replay.

Las pruebas usan dependencias/servidores simulados. No son una prueba nueva de concurrencia real de PostgreSQL. Se verificaron las garantías desplegadas de `check_in` por lectura de definición e índices. No se ejecutaron fixtures SQL: Docker local no respondió al inventario y se canceló esa consulta. No se usó producción para suplirlo.

Antes de publicar, verificar en entorno descartable la regresión SQL y fixture de concurrencia de asistencia existentes y la combinación de frontend/Edge con Auth real. En dispositivos físicos: Safari iOS y Chrome Android, cámara, respuesta perdida, bloqueo/desbloqueo, `Retry-After` expuesto por gateway, reconfirmación y navegación inmediata. Estas pruebas locales no certifican capacidad para 2,000 alumnos.

## Publicación futura tras revisión

Lista exacta de funciones que requieren redespliegue: **`participant-admin`, `staff-accounts`, `workshop-admin`**, incluyendo `_shared/operations.ts` y el nuevo handler de Staff. También requiere publicar el frontend. No requieren redespliegue `student-access`, `workshop-intake` ni `preparation-reset`.

No hay migraciones, `supabase db push`, cambios de JWT, datos, credenciales reales ni operación del evento. Commit y título del PR llevan `[skip netlify]` para omitir despliegues Git y Deploy Preview sin cambiar ajustes del hosting.

Referencias contrastadas: [errores de Auth](https://supabase.com/docs/guides/auth/debugging/error-codes), [Auth Admin updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
