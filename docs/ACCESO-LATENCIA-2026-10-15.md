# Acceso de alumnos: latencia de `student-access` (incidente 2026-10-15)

## Qué pasó
Con ~500 alumnos entrando a la vez, `student-access` tardó decenas de segundos y devolvió 503/504. La causa demostrada fue una
cadena de llamadas HTTP en serie a Auth/PostgREST por cada `identify`, sin plazo, mientras el navegador esperaba 30 s × 3 intentos
y el servidor seguía trabajando para peticiones ya abandonadas. El SQL de identificación siempre fue de milisegundos.

## Cómo quedó (PR #53 + PR #54)
| Pieza | Comportamiento |
|---|---|
| `identify` | **Solo** el RPC `participant_access_state_internal`. Ninguna llamada a Auth, ni en segundo plano (PR #53, Supabase v8). |
| Plazos del servidor | Lectura 9 s; escritura 20 s; cada llamada a PostgREST 8 s y a Auth 15 s. Vencido el plazo: `503 + Retry-After`. |
| Escrituras (`setup_password`, `register`) | Al vencer el plazo **no se inicia ningún paso nuevo** (ni buscar, crear, cambiar o borrar cuentas, ni deshacer un registro). Solo puede completarse el vínculo participante↔cuenta (idempotente). El resultado queda *incierto* y el reintento lo recupera con la prueba de posesión de la contraseña. |
| `catalog` | En memoria 60 s por instancia; si la base falla se sirve la última lista buena de ≤ 10 min. El registro valida de nuevo carrera y escuela en la base. |
| Navegador | `identify`/`catalog` 12 s, escrituras 25 s, entrar con contraseña 15 s. Un reintento automático, solo tras un fallo rápido (< 3 s) y si el servidor pide esperar ≤ 5 s. Tiempo agotado: aviso con espera de 4–8 s y «Volver a intentar»; el correo y los campos se conservan. |

## Corregir el correo de un participante ya configurado (Staff)
`identify` ya **no** alinea el correo en Auth. Si Staff corrige el correo de un participante que ya tiene contraseña, la cuenta de Auth
conserva el correo anterior y el alumno no podría entrar con el nuevo. Ruta administrativa segura, fuera del inicio de sesión:

1. Staff (Coordinación) corrige el correo en el panel del participante.
2. En ese mismo participante usa **Restablecer contraseña** (`participant-admin`, acción `reset_password`): actualiza la cuenta de
   Auth con el correo **actual** del participante y una contraseña nueva que se entrega al alumno en persona.

Si nadie hace el paso 2, el síntoma es «correo o contraseña incorrectos» solo para ese alumno. En producción hoy 0 de 249 participantes
vinculados tienen el correo desalineado. Prueba: `supabase/functions/participant-admin/handler.test.ts`.

## Riesgos que permanecen
- La recuperación de un registro interrumpido (`findUserByEmail`) lista hasta 5 000 cuentas de Auth; conviene una función SQL de
  búsqueda por correo (requiere migración, fuera del alcance del hotfix).
- Una escritura con resultado incierto exige que la persona reintente con la **misma** contraseña; con otra, `ACCOUNT_RECOVERY_REQUIRED`
  y verificación en persona (comportamiento ya existente, ahora algo más probable bajo degradación).
- El catálogo en memoria puede tardar hasta 60 s en reflejar un cambio de Staff (por instancia).
- La instancia es de tamaño Micro (inferido por `max_connections` y `shared_buffers`; sin métrica de CPU): subir el cómputo durante el
  evento sigue siendo la mitigación más efectiva.
