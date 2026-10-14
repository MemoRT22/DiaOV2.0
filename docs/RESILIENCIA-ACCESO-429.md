# Resiliencia del acceso ante límites (429) y caídas temporales

Alcance: **solo autenticación y recuperación de acceso** (identificar correo, crear contraseña, autorregistro, inicio de sesión de alumnos y de Staff). No toca reservaciones, talleres, sellos, asistencia, sorteo, roles, horarios ni catálogos. Sin migraciones SQL.

## Qué pasa ahora ante un 429 (o 503, o falta de red)
| Origen | Antes | Ahora |
|---|---|---|
| `signInWithPassword` limitado (429) | «Correo o contraseña incorrectos» | Error `RATE_LIMITED`; **nunca** `INVALID_CREDENTIALS`/`INVALID_STAFF_CREDENTIALS`. Solo una respuesta definitiva de credenciales (400 `invalid_credentials`) dice «incorrectos». |
| 5xx, `AuthRetryableFetchError`, respuesta que no es JSON de Auth, tiempo agotado | «Correo o contraseña incorrectos» | `TEMPORARILY_UNAVAILABLE` / `NETWORK` / `TIMEOUT` |
| Edge Function `student-access` con límite de Auth/base | `500 SERVER_ERROR` y, en el registro, **se descartaba** el participante | `429`/`503` con `Retry-After` (con variación aleatoria) y `{ error, retry_after }`; el registro **se conserva** |
| Gateway 429/502/503/504/546 sin cuerpo | `SERVER_ERROR` | Se reconoce por el estado HTTP |
| **HTTP 500** (`{ error: "SERVER_ERROR" }`, sin cuerpo, código desconocido) o un 200 con cuerpo ilegible | Error genérico, tratado como dato inválido | Infraestructura / **resultado incierto** → `TEMPORARILY_UNAVAILABLE`: se conservan los datos y la persona decide reintentar. Con 5xx solo `NO_ACTIVE_EDITION` es definitivo; con 4xx el código de negocio manda (`INVALID_PHONE`, `EMAIL_EXISTS`, `ACCOUNT_RECOVERY_REQUIRED`…). |

La pantalla muestra «**Estamos recibiendo muchas solicitudes** — Hay varios alumnos entrando a la plataforma al mismo tiempo. Tu información se conserva. Intenta nuevamente en unos momentos.» con «Volver a intentar». Si el servidor dio `Retry-After` se respeta **tal cual** (segundos o fecha HTTP; un 300 es 5 minutos, no 2) con una cuenta atrás calculada contra el reloj; el único tope es de cordura, **1 hora**, para que un valor corrupto no deje el botón bloqueado indefinidamente. Los reintentos *automáticos* no esperan ese plazo en segundo plano (ver abajo); si no dio nada, una espera corta con variación aleatoria (8–15 s; 5–10 s para 503; 0 s para falta de red). El botón nunca queda bloqueado más allá de ese tiempo. Se conservan los campos, el correo identificado, el consentimiento y el paso.

## Reintentos
- **Automáticos y acotados** (2 reintentos, espera exponencial ×2 con ±30 % de azar, nunca menos que `Retry-After`; si el servidor pide más de 20 s no se espera en segundo plano y se avisa a la persona): `identify`, `catalog` e **inicio de sesión** (no cambia datos).
- **Nunca automáticos:** `setup_password` y `register` (el resultado puede ser incierto). Los reintenta la persona con «Volver a intentar».
- Todo se cancela si la persona abandona el formulario (`AbortSignal`); un solo envío a la vez por formulario (clics repetidos se ignoran).

## Recuperación de registros a medias
1. **Cuenta creada, login limitado:** el paso «Crear contraseña»/«Registrarme» guarda que la cuenta ya existe, bloquea los campos y «Volver a intentar» repite **solo la entrada**.
2. **Se perdió la respuesta (red/tiempo agotado):** al reintentar, si el servidor responde «ya configurada» (prerregistro) o «correo ya registrado» (autorregistro) **y** hubo un fallo incierto antes, se intenta entrar con la contraseña escrita. Si entra, era la cuenta de esa persona; si no coincide, se pasa a «Iniciar sesión» con el mismo correo y se explica. No se cambia nada ajeno.
3. **Servidor – Auth creó la cuenta pero no se vinculó** (429/5xx/tiempo agotado): ya **no se borra** la cuenta ni se descarta el participante (el vínculo pudo haberse guardado). El reintento recibe «correo ya existe» y **reclama** la cuenta huérfana (`adoptInterruptedIdentity`) **solo si demuestra conocer su contraseña** (ver abajo); nunca se la reescribe.
4. **Servidor – reintento de `register`:** si el correo ya existe como `self_service` sin contraseña (lo que dejó el intento interrumpido), se continúa con ese participante (sus datos y consentimiento ya guardados), sin duplicar. Un prerregistro u otra cuenta ya configurada siguen siendo «correo ya registrado».
5. Solo un fallo **definitivo** de un registro recién creado en esa misma solicitud se compensa (borrar la cuenta recién creada y descartar el autorregistro, como antes).

### Garantías de seguridad de la recuperación
El correo y los metadatos de una cuenta **no prueban** que quien llama sea su dueño, y el servicio es público (datos de menores). Por eso:
- **Nunca se cambia la contraseña de una cuenta de Auth que ya existía** (ni con `updateUser`). La única excepción es la cuenta de *marcador* del prerregistro (`p.<uuid>@participantes.diaov.invalid`), cuya contraseña nadie conoce.
- Para reclamar una cuenta existente se exige una **prueba de posesión**: el servidor intenta un inicio de sesión desechable con la contraseña recibida (`verifyPassword`, con la clave pública; no modifica la cuenta y cierra solo esa sesión). Es exactamente lo que ocurre cuando **la misma persona reintenta** con lo que escribió la primera vez: la cuenta se **vincula** y ya. Si no coincide: `409 ACCOUNT_RECOVERY_REQUIRED` y **no se toca nada** (ni cuenta, ni vínculo, ni registro).
- Además se mantiene: `kind = participant`; mismo correo; **ningún otro participante** la usa (si no, `EMAIL_EXISTS` sin probar contraseñas: no hay oráculo sobre cuentas ajenas ni de Staff). Staff y Coordinación jamás se tocan.
- Aplica por igual a `setup_password` (prerregistro), a `register` reanudado (`self_service` con `password_configured_at` nulo) y a una cuenta ya vinculada cuyo correo no es de marcador. Si Staff corrigió el correo, se alinea **solo el correo**, y únicamente después de la prueba.
- Un fallo temporal al consultar Auth o al probar la contraseña no se interpreta como «no existe» ni como «incorrecta»: responde 429/503 y no cambia nada.
- **Concurrencia:** dos envíos simultáneos para el mismo correo crean **una** cuenta; el segundo, si trae otra contraseña, recibe `ACCOUNT_RECOVERY_REQUIRED` y no pisa la del primero; si es la misma contraseña (doble clic o dos dispositivos) converge a una sola cuenta vinculada.

### Ruta segura cuando no se puede recuperar automáticamente
Si el alumno no recuerda la contraseña de su primer intento (`ACCOUNT_RECOVERY_REQUIRED`), la pantalla le indica escribir la misma de entonces o **acudir al módulo de atención con identificación**. Ahí Staff/Coordinación (autenticados y con auditoría) usa «Restablecer contraseña» de `participant-admin`: si el correo ya tenía una cuenta huérfana de ese mismo participante (`kind = participant`, mismo correo, sin otro dueño), ahora la **reclama** (contraseña nueva + vínculo) en vez de fallar con `EMAIL_EXISTS`; Staff/Coordinación y cuentas de otro alumno siguen rechazadas. La auditoría se escribe antes y falla cerrado.

### Límite que este PR no resuelve
Ni el prerregistro ni el autorregistro verifican que quien teclea el correo sea su dueño (no hay código ni enlace por correo): quien conozca el correo de un participante **sin contraseña** puede ser el primero en fijarla. Es el modelo vigente (`identify → setup_password`), no algo nuevo; este PR garantiza que **no se pueda pisar una credencial ya existente**. Cerrarlo del todo requiere verificación por correo (OTP/enlace) como cambio aparte.

## Despliegue
Requiere **redesplegar las Edge Functions `student-access` y `participant-admin`** (`handler.ts` e `index.ts` de cada una) y el front. `student-access` usa `SUPABASE_ANON_KEY` (ya inyectada por Supabase en las funciones) para la prueba de posesión. No hay migración. Pruebas: `node --test supabase/functions/student-access/handler.test.ts supabase/functions/participant-admin/handler.test.ts`. La búsqueda por correo de la recuperación usa `auth.admin.listUsers` (hasta 5 páginas de 1,000) y solo se ejecuta cuando un correo ya existe en Auth al crear una cuenta.

## Notas operativas (6,000 solicitudes / 5 min por IP)
Con muchos dispositivos tras una misma IP, el inicio de sesión (1 solicitud por alumno, más reintentos acotados) es lo que consume ese límite; la Edge Function usa su propia IP y el límite de la API de administración. Los reintentos automáticos están acotados a 2 por operación para no agravar la saturación.
