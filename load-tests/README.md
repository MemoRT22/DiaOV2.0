# Pruebas de carga del Día OV 2026

Suite reproducible de Grafana k6 para hasta 2,000 alumnos ficticios. Por defecto es de solo lectura y se niega a apuntar a un entorno
que no sea `local`, `staging` o `loadtest`. No se debe ejecutar contra producción, el dominio institucional, HubSpot o Netlify sin la
autorización explícita de sus responsables y proveedores.

## Requisitos

- Node.js 20+ para generar datos y reportes.
- Grafana k6 0.49+ en el runner.
- `psql` con acceso administrativo exclusivamente al proyecto Supabase aislado, para sembrar/limpiar cuentas ficticias.
- Un entorno construido con las migraciones de esta rama, sin personas reales y con la edición activa en `preparacion`.

No se usan datos personales, tokens de producción ni `service_role` en k6. La siembra escribe directamente en `auth` porque crea 2,000
identidades de ensayo sin disparar correos ni abusar del endpoint público de signup; por eso exige una conexión administrativa al
entorno aislado y contiene guardas SQL adicionales.

## Preparación

Desde `load-tests/`:

```bash
npm run check
npm run generate -- --users 2000 --seed 15102026 --bcrypt-cost 10
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_isolated=YES -q -At -f data/seed.sql -o data/manifest.json
```

`data/` contiene la contraseña de las cuentas ficticias y está ignorado por Git. No lo adjuntes al PR ni al reporte. Revisa que
`data/manifest.json` sea JSON válido y conserva `data/dataset.meta.json` como identificación local del dataset.

Configura el runner con variables equivalentes a `.env.example` (k6 no carga `.env` automáticamente):

```bash
export TARGET_ENV=loadtest
export SUPABASE_URL=https://PROJECT-ISOLATED.supabase.co
export SUPABASE_ANON_KEY='public-key-only'
export LOADTEST_ALLOW_HOSTS=PROJECT-ISOLATED.supabase.co
export PROFILE=smoke
```

Ejecuta siempre el preflight de solo lectura:

```bash
k6 run scenarios/00-preflight.js
```

## Seguridad de escritura

Reservaciones, asistencia y encuesta solo escriben si se define exactamente:

```bash
export LOADTEST_ALLOW_WRITES=yes-this-is-an-isolated-test-environment
```

Sin esa frase los escenarios degradan a lecturas seguras. La suite rechaza la referencia conocida de producción, cualquier clave cuyo
JWT indique `service_role`, hosts no incluidos en `LOADTEST_ALLOW_HOSTS` y entornos fuera de la lista segura. Se puede ampliar la lista
de referencias de producción con `PRODUCTION_SUPABASE_REFS=ref1,ref2`.

Para `01-static.js`, la carga a hosts de Netlify/HubSpot/institucionales queda topada en 5 VU hasta que
`LOADTEST_THIRD_PARTY_AUTHORIZATION` contenga el identificador de la autorización escrita. Usa URLs de staging/deploy preview, nunca el
sitio oficial. La suite no interpreta esa variable como permiso legal: el operador debe verificarlo antes.

## Escenarios

| Archivo | Propósito | Escritura |
|---|---|---|
| `00-preflight.js` | Guardas, Auth, edición y contratos básicos | No |
| `01-static.js` | HubSpot institucional, HTML Netlify y assets por separado | No |
| `02-auth.js` | Personas distintas, llegada gradual, ráfagas, 429 y bootstrap | No |
| `03-navigation.js` | Talleres, Mi ruta, Bitácora, sellos, sorteo y encuesta | No |
| `04-reservations.js` | Cupos, doble clic, conflictos, cambios y cancelaciones | Sí |
| `05-checkin.js` | `check_in`, repetición idempotente e inválidos | Sí |
| `06-survey.js` | Estado, invitación y envío idempotente de encuesta | Sí |
| `07-realtime.js` | Conexiones, broadcasts y recuperación | Opcional |
| `99-full-day.js` | Mezcla de 2,000 personas en cohortes disjuntas | Sí |

La ráfaga Auth se mide de manera independiente. `99-full-day.js` no agrega una segunda ola artificial: sus propios VU inician sesión al
entrar y la suma de navegación, reservaciones, check-in, encuesta y Realtime es exactamente el objetivo del perfil.

## Perfiles

`PROFILE=smoke|baseline|normal|stress|peak2000|spike|soak`. `SCALE=0.1` reduce todos los objetivos para una validación local y
`MAX_VUS` impone un tope de capacidad del runner. Los perfiles incluyen rampas y pausas humanas; `stress` y `spike` relajan el SLO de
latencia, pero nunca las guardas de integridad o el corte por falla grave.

Ejemplos:

```bash
PROFILE=baseline k6 run scenarios/03-navigation.js
PROFILE=normal k6 run scenarios/02-auth.js
PROFILE=stress RESERVATION_MODE=contention k6 run scenarios/04-reservations.js
PROFILE=peak2000 k6 run scenarios/99-full-day.js
```

Antes de repetir una corrida con escritura:

```bash
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_isolated=YES -f data/reset-run.sql
```

Después de cada corrida con escritura, la comprobación definitiva debe devolver cero violaciones:

```bash
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/verify-integrity.sql
```

La prueba SQL opcional de contención requiere `dblink` y privilegios elevados en la base aislada:

```bash
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_isolated=YES -v conns=80 -f tools/contention-check.sql
```

## Umbrales y parada

Se miden error de infraestructura, p95/p99 globales y por operación, éxito/latencia de Auth, TTFB/total de estáticos, join/lag/recuperación
Realtime y contadores de integridad. `abortOnFail` detiene la corrida ante sobrecupo, duplicado, conflicto aceptado, exceso de máximo,
error sostenido mayor a 15 % o p99 global mayor a 15 s. Los rechazos de negocio esperados (`SESSION_FULL`, `SCHEDULE_CONFLICT`, etc.)
no se contabilizan como falla de infraestructura.

## Resultados

Cada escenario escribe `results/<escenario>-<perfil>-<fecha>.json`. Genera un borrador de reporte:

```bash
npm run report -- results/99-full-day-peak2000-....json results/reporte.md
```

Completa `REPORT_TEMPLATE.md` con los paneles indicados en `docs/monitoring.md`. La arquitectura y los límites del modelo están en
`docs/architecture.md`.

## Limpieza

Al terminar la campaña:

```bash
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_isolated=YES -f data/cleanup.sql
```

La limpieza elimina únicamente cuentas `lt.*@loadtest.invalid`, talleres `LT %` y la división `lt-div`. Conserva la evidencia del
reporte fuera de `data/` antes de borrar el entorno.
