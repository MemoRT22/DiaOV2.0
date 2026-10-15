# Cierre de sesión resistente a fallos del servidor

## Problema
`supabase.auth.signOut()` avisa primero al servidor. Si falla (sin red, saturación, tiempo agotado) y no es 401/403/404, devuelve `{ error }` y **conserva la sesión local**: el botón «Cerrar sesión» no hacía nada ni avisaba (supabase-js 2.65, `GoTrueClient._signOut`).

## Comportamiento
| Caso | Resultado |
|---|---|
| El servidor responde bien | Igual que antes: supabase-js cierra y emite `SIGNED_OUT`. No se toca nada más ni se reinicia |
| El servidor falla o vence el tiempo | Se detiene el refresco automático, se eliminan **solo** `sb-<ref del proyecto>-auth-token` y su `-code-verifier`, se **comprueba leyendo** que ya no existen y entonces se reinicia en `/` |
| No se puede borrar o comprobar (almacenamiento bloqueado o la clave sigue) | **No** se reinicia ni se simula éxito: se muestra «No pudimos cerrar tu sesión en este dispositivo…» junto al botón (Bitácora, panel del personal y pantalla de cuenta no activa) |

La clave se calcula con el mismo criterio de supabase-js a partir de `VITE_SUPABASE_URL` (`authStorageKey`), por lo que no afecta a sesiones de otros proyectos Supabase del mismo origen ni a otras claves. Las reglas de autenticación y el alcance del cierre remoto exitoso no cambian.

## Pruebas
- `localSession.test.ts`: con un **cliente real** (`GoTrueClient`) y el servidor inalcanzable, `signOut` conserva la sesión (el fallo original); tras la limpieza, un cliente nuevo («recarga») ya no tiene sesión; otra sesión de otro proyecto sigue intacta; el resultado es `false` si la eliminación no se puede probar.
- `auth.test.tsx`: cierre normal; recuperación por fallo de red y por tiempo agotado (solo se borran las claves de este proyecto, un reinicio); alumno y personal vuelven a anónimos tras «recargar»; sin éxito falso cuando falla el borrado o la clave permanece. El reinicio se observa con la costura `navigation.restart` (jsdom no permite redefinir `window.location`). Verificado por mutación: si la comprobación se omite, fallan 2 pruebas.
- Suite completa: 111 archivos, 1,394 pruebas correctas. `tsc -b` y `vite build` correctos.

## Límites
- Con el servidor inalcanzable el token sigue vigente en el servidor hasta expirar; se cierra la sesión de este dispositivo.
- Otra pestaña abierta del mismo navegador conserva su sesión en memoria hasta recargar.
- No se probó en un navegador real; la recarga se comprobó con un cliente real y almacenamiento de prueba.
