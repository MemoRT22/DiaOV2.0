# Cierre vocacional 2026: aplicación y verificación

La configuración de apertura vive en `editions.interests_prompt_min_attendances` e `interests_prompt_at`. La migración
`20261014234500_configure_post_event_interests_opening.sql` conserva la regla existente: **dos asistencias O jueves 15 de
octubre de 2026 a las 12:30, hora de Cancún**. Es una migración de configuración; no cambia estructura ni filas de
participantes, intereses o encuesta.

Netlify construye y publica el frontend, pero no aplica las migraciones de este repositorio. Los siguientes pasos los realiza
una persona responsable de Supabase **después de aprobar y fusionar el PR**, desde un checkout actualizado de `main`.

## 1. Revisión previa (solo lectura)

1. Confirmar el proyecto enlazado antes de continuar; nunca elegir el proyecto por inferencia.
2. Consultar en Supabase SQL Editor:

```sql
select code, interests_prompt_min_attendances, interests_prompt_at,
       interests_prompt_at at time zone 'America/Cancun' as opens_at_cancun
from public.editions
where code = 'DIAOV2026';

select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 10;
```

El primer resultado debe ser exactamente una fila. Antes de aplicar este cambio puede mostrar `interests_prompt_at = NULL`.

## 2. Revisar el lote y aplicar

Con una versión actual de Supabase CLI:

```sh
supabase --version
supabase link --project-ref <PROJECT_REF_CONFIRMADO>
supabase migration list --linked
supabase db push --linked --dry-run
```

El `dry-run` debe incluir `20261014234500_configure_post_event_interests_opening.sql`. Revisar cualquier otra migración
pendiente: `db push` aplica **todas** las pendientes en orden. Si aparece una migración no aprobada o el historial local/remoto
no coincide, detenerse y reconciliar el historial; no usar `migration repair` para ocultar una diferencia sin investigarla.

Cuando el lote sea el esperado, una sola persona ejecuta:

```sh
supabase db push --linked
supabase migration list --linked
```

No ejecutar `--include-seed` en producción. No es necesario volver a publicar Netlify para que la hora guardada surta efecto.

## 3. Verificación posterior (solo lectura)

```sql
select code, interests_prompt_min_attendances,
       interests_prompt_at,
       interests_prompt_at at time zone 'America/Cancun' as opens_at_cancun
from public.editions
where code = 'DIAOV2026';
```

Resultado esperado:

- `interests_prompt_min_attendances = 2`
- `interests_prompt_at = 2026-10-15 17:30:00+00`
- `opens_at_cancun = 2026-10-15 12:30:00`
- la versión `20261014234500` aparece como aplicada en `supabase migration list --linked`

La comprobación funcional se hace con cuentas de prueba: una con cero asistencias después de las 12:30 y otra con dos
asistencias antes de esa hora. No crear, borrar ni editar intereses de participantes reales para verificar la configuración.
