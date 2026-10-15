# Arquitectura observada en `origin/main`

Esta suite se diseñó contra el código y las migraciones en `7f0781b` (merge de PR #46), no contra una API supuesta.

## Recorrido real

1. La página institucional en HubSpot contiene un `iframe` cuya fuente es la SPA React/Vite servida por Netlify.
2. El navegador descarga `index.html` y recursos con hash desde Netlify. La regla SPA permite rutas profundas.
3. `student-access` identifica el correo; el acceso normal usa Supabase Auth con email/contraseña.
4. La sesión JWT llama PostgREST/RPC con RLS y funciones de PostgreSQL. El frontend no recibe `service_role`.
5. La disponibilidad usa un canal privado Supabase Realtime `availability:<edition_id>` y eventos broadcast `availability` / `session_changed`.

## Contratos cubiertos

| Área | Contrato real |
|---|---|
| Arranque | `editions`, `participant_profiles`, `staff_members`, `theme_versions` |
| Talleres / ruta | `my_reservation_board`, `my_workshop_detail`, `my_recommended_activities` |
| Bitácora / sellos | `my_progress`, `my_raffle_status`, `my_raffle_prizes` |
| Reservaciones | `reserve_session`, `change_reservation`, `cancel_reservation` |
| Asistencia | `check_in(p_credential)`; credencial por actividad, reserva vigente/expirada e idempotencia por actividad. La implementación vigente no bloquea por horario. |
| Encuesta | `my_exit_survey`, `exit_survey_mark_invited`, `submit_exit_survey(jsonb)` |
| Tiempo real | WebSocket Phoenix, canal privado y JWT del participante |

Las reservaciones serializan en PostgreSQL y las comprobaciones definitivas se hacen tanto desde la vista de cada alumno como con
`tools/verify-integrity.sql` sobre el estado guardado. La prueba de contención opcional `tools/contention-check.sql` abre conexiones
PostgreSQL reales y usa la misma RPC bajo identidad `authenticated`.

## Límites del modelo

- k6 no ejecuta el DOM del iframe ni renderiza React. `01-static.js` mide la respuesta institucional, valida la referencia al iframe y
  mide por separado HTML y assets de Netlify. Para Core Web Vitals se necesita además una prueba de navegador sintética.
- Una máquina generadora puede convertirse en el cuello de botella a 2,000 WebSockets. Se debe observar su CPU, memoria, sockets y red;
  si supera 70–80 %, distribuir la prueba entre runners y conservar el mismo plan de cohortes.
- Los límites de Auth por IP son deliberadamente visibles: una red de campus suele compartir NAT. Una prueba distribuida responde una
  pregunta distinta y debe reportarse como tal.
