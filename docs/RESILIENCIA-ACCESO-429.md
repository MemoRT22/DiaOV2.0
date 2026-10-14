# Resiliencia del acceso ante límites (429) y caídas temporales

Alcance: **solo autenticación y recuperación de acceso** (identificar correo, crear contraseña, autorregistro, inicio de sesión de alumnos y de Staff). No toca reservaciones, talleres, sellos, asistencia, sorteo, roles, horarios ni catálogos. Sin migraciones SQL.

## Qué pasa ahora ante un 429 (o 503, o falta de red)
| Origen | Antes | Ahora |
|---|---|---|
| `signInWithPassword` limitado (429) | «Correo o contraseña incorrectos» | Error `RATE_LIMITED`; **nunca** `INVALID_CREDENTIALS`/`INVALID_STAFF_CREDENTIALS`. Solo una respuesta definitiva de credenciales (400 `invalid_credentials`) dice «incorrectos». |
| 5xx, `AuthRetryableFetchError`, respuesta que no es JSON de Auth, tiempo agotado | «Correo o contraseña incorrectos» | `TEMPORARILY_UNAVAILABLE` / `NETWORK` / `TIMEOUT` |
| Edge Function `student-access` con límite de Auth/base | `500 SERVER_ERROR` y, en el registro, **se descartaba** el participante | `429`/`503` con `Retry-After` (con variación aleatoria) y `{ error, retry_after }`; el registro **se conserva** |
| Gateway 429/502/503/504/546 sin cuerpo | `SERVER_ERROR` | Se reconoce por el estado HTTP |

La pantalla muestra «**Estamos recibiendo muchas solicitudes** — Hay varios alumnos entrando a la plataforma al mismo tiempo. Tu información se conserva. Intenta nuevamente en unos momentos.» con «Volver a intentar». Si el servidor dio `Retry-After` se respeta (máx. 120 s) con una cuenta atrás; si no, una espera corta con variación aleatoria (8–15 s; 5–10 s para 503; 0 s para falta de red). El botón nunca queda bloqueado más allá de ese tiempo. Se conservan los campos, el correo identificado, el consentimiento y el paso.

## Reintentos
- **Automáticos y acotados** (2 reintentos, espera exponencial ×2 con ±30 % de azar, nunca menos que `Retry-After`; si el servidor pide más de 20 s no se espera en segundo plano y se avisa a la persona): `identify`, `catalog` e **inicio de sesión** (no cambia datos).
- **Nunca automáticos:** `setup_password` y `register` (el resultado puede ser incierto). Los reintenta la persona con «Volver a intentar».
- Todo se cancela si la persona abandona el formulario (`AbortSignal`); un solo envío a la vez por formulario (clics repetidos se ignoran).

## Recuperación de registros a medias
1. **Cuenta creada, login limitado:** el paso «Crear contraseña»/«Registrarme» guarda que la cuenta ya existe, bloquea los campos y «Volver a intentar» repite **solo la entrada**.
2. **Se perdió la respuesta (red/tiempo agotado):** al reintentar, si el servidor responde «ya configurada» (prerregistro) o «correo ya registrado» (autorregistro) **y** hubo un fallo incierto antes, se intenta entrar con la contraseña escrita. Si entra, era la cuenta de esa persona; si no coincide, se pasa a «Iniciar sesión» con el mismo correo y se explica. No se cambia nada ajeno.
3. **Servidor – Auth creó la cuenta pero no se vinculó** (429/5xx/tiempo agotado): ya **no se borra** la cuenta ni se descarta el participante (el vínculo pudo haberse guardado). El reintento recibe «correo ya existe» y **adopta** la cuenta huérfana (`adoptInterruptedIdentity`).
4. **Servidor – reintento de `register`:** si el correo ya existe como `self_service` sin contraseña (lo que dejó el intento interrumpido), se continúa con ese participante (sus datos y consentimiento ya guardados), sin duplicar. Un prerregistro u otra cuenta ya configurada siguen siendo «correo ya registrado».
5. Solo un fallo **definitivo** de un registro recién creado en esa misma solicitud se compensa (borrar la cuenta recién creada y descartar el autorregistro, como antes).

### Garantías de seguridad de la recuperación
Una cuenta de Auth solo se reutiliza si **todas** se cumplen: `app_metadata.kind = participant`; mismo correo; **ningún otro participante** la usa; y el participante aún no tiene contraseña configurada (la misma precondición de `setup_password`). Nunca se modifica Staff ni una cuenta con otro dueño. Un fallo temporal al consultar Auth no se interpreta como «no existe» (no se crea una identidad duplicada). Los registros solo contienen códigos (nunca correo ni contraseña).

## Despliegue
Requiere **redesplegar la Edge Function `student-access`** (`handler.ts` e `index.ts`) y el front. No hay migración. Pruebas de la función: `node --test supabase/functions/student-access/handler.test.ts`. La búsqueda por correo de la recuperación usa `auth.admin.listUsers` (hasta 5 páginas de 1,000) y solo se ejecuta cuando un correo ya existe en Auth al crear una cuenta.

## Notas operativas (6,000 solicitudes / 5 min por IP)
Con muchos dispositivos tras una misma IP, el inicio de sesión (1 solicitud por alumno, más reintentos acotados) es lo que consume ese límite; la Edge Function usa su propia IP y el límite de la API de administración. Los reintentos automáticos están acotados a 2 por operación para no agravar la saturación.
