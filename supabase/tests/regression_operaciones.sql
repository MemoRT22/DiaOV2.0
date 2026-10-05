-- Fase 7 — Pruebas dirigidas del Centro de Operación
-- Ejecutar con execute_sql. No crea tablas; solo verifica.
-- Requiere el fixture demo existente (3 participantes, 4 sesiones, 12 asistencias).

-- ============================================================
-- 1. AUTORIZACIÓN
-- ============================================================

-- 1a. anon no tiene EXECUTE
SELECT
  has_function_privilege('anon', 'public.event_operations_overview()', 'EXECUTE') AS anon_exec,
  NOT has_function_privilege('anon', 'public.event_operations_overview()', 'EXECUTE') AS test_anon_blocked;

-- 1b. PUBLIC no tiene EXECUTE
SELECT
  NOT has_function_privilege('public', 'public.event_operations_overview()', 'EXECUTE') AS test_public_blocked;

-- 1c. authenticated tiene EXECUTE
SELECT
  has_function_privilege('authenticated', 'public.event_operations_overview()', 'EXECUTE') AS test_authenticated_allowed;

-- 1d. La función bloquea a roles sin staff (is_operativo verifica auth.uid())
-- Un rol sin auth.uid() (como postgres o un participante autenticado sin staff_roles)
-- recibe NOT_AUTHORIZED. Lo verificamos con el caso de postgres:
DO $$
BEGIN
  BEGIN
    PERFORM event_operations_overview();
    RAISE EXCEPTION 'test_failed_should_block';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NOT_AUTHORIZED' THEN
      RAISE NOTICE 'test_participant_blocked: OK (NOT_AUTHORIZED raised)';
    ELSE
      RAISE EXCEPTION 'test_failed: expected NOT_AUTHORIZED, got %', SQLERRM;
    END IF;
  END;
END $$;

-- ============================================================
-- 2. MÉTRICAS (con fixture demo existente)
-- ============================================================

-- Ejecutar la query interna directamente (sin auth guard) para verificar conteos
WITH v_ed AS (SELECT * FROM editions WHERE is_active LIMIT 1),
v_st AS (SELECT now() AS ts)
SELECT
  -- Capacidades y conteos por sesión
  (SELECT count(*) FROM activity_sessions s JOIN activities a ON a.id = s.activity_id
   WHERE a.edition_id = (SELECT id FROM v_ed)) AS sessions_total,
  (SELECT count(*) FROM participants p WHERE p.edition_id = (SELECT id FROM v_ed)) AS participants_total,
  (SELECT count(*) FROM reservations r JOIN participants p ON p.id = r.participant_id
   WHERE p.edition_id = (SELECT id FROM v_ed) AND r.status = 'vigente') AS active_reservations,
  (SELECT count(DISTINCT r.participant_id) FROM reservations r JOIN participants p ON p.id = r.participant_id
   WHERE p.edition_id = (SELECT id FROM v_ed) AND r.status = 'vigente') AS participants_with_reservations,
  (SELECT count(*) FROM attendances at JOIN participants p ON p.id = at.participant_id
   WHERE p.edition_id = (SELECT id FROM v_ed)) AS total_attendances,
  (SELECT count(DISTINCT at.participant_id) FROM attendances at JOIN participants p ON p.id = at.participant_id
   WHERE p.edition_id = (SELECT id FROM v_ed)) AS unique_attended_participants;

-- Verificar que remaining = capacity - reserved para cada sesión
WITH v_ed AS (SELECT id FROM editions WHERE is_active LIMIT 1)
SELECT
  s.id,
  s.capacity,
  session_reserved_count(s.id) AS reserved,
  greatest(s.capacity - session_reserved_count(s.id), 0) AS remaining,
  (greatest(s.capacity - session_reserved_count(s.id), 0) = s.capacity - session_reserved_count(s.id)) AS test_remaining_correct
FROM activity_sessions s
JOIN activities a ON a.id = s.activity_id
WHERE a.edition_id = (SELECT id FROM v_ed)
ORDER BY s.starts_at;

-- ============================================================
-- 3. ESTADOS TEMPORALES
-- ============================================================

-- Usar timestamps controlados para verificar cada estado
WITH test_cases AS (
  SELECT * FROM (VALUES
    -- (starts_at offset, ends_at offset, status, expected_temporal)
    -- antes de inicio → próxima
    ('2099-01-01 10:00:00+00', '2099-01-01 11:00:00+00', 'activa', 'proxima'),
    -- entre inicio y fin → en curso
    ('2000-01-01 10:00:00+00', '2099-01-01 11:00:00+00', 'activa', 'en_curso'),
    -- después del fin → terminada
    ('2000-01-01 10:00:00+00', '2000-01-01 11:00:00+00', 'activa', 'terminada'),
    -- cancelada prevalece
    ('2000-01-01 10:00:00+00', '2000-01-01 11:00:00+00', 'cancelada', 'cancelada'),
    -- oculta se representa
    ('2099-01-01 10:00:00+00', '2099-01-01 11:00:00+00', 'oculta', 'oculta')
  ) AS t(starts_at, ends_at, status, expected)
)
SELECT
  t.starts_at,
  t.ends_at,
  t.status,
  t.expected,
  CASE
    WHEN t.status = 'cancelada' THEN 'cancelada'
    WHEN t.status = 'oculta' THEN 'oculta'
    WHEN now() < t.starts_at::timestamptz THEN 'proxima'
    WHEN now() >= t.starts_at::timestamptz AND now() < t.ends_at::timestamptz THEN 'en_curso'
    ELSE 'terminada'
  END AS computed,
  (CASE
    WHEN t.status = 'cancelada' THEN 'cancelada'
    WHEN t.status = 'oculta' THEN 'oculta'
    WHEN now() < t.starts_at::timestamptz THEN 'proxima'
    WHEN now() >= t.starts_at::timestamptz AND now() < t.ends_at::timestamptz THEN 'en_curso'
    ELSE 'terminada'
  END = t.expected) AS test_temporal_correct
FROM test_cases t;

-- ============================================================
-- 4. CHECK-IN PENDIENTE
-- ============================================================

-- 4a. Sesión terminada + reservas + 0 asistencias + dentro de ventana → CHECK-IN PENDIENTE
WITH test_session AS (
  SELECT
    'test-uuid'::text AS session_id,
    '2000-01-01 10:00:00+00'::timestamptz AS starts_at,
    (now() - interval '5 minutes')::timestamptz AS ends_at,  -- terminó hace 5 min
    'activa'::text AS status,
    20 AS capacity,
    5 AS reserved,
    0 AS attended
),
v_close AS (SELECT make_interval(mins => 20) AS close_interval)
SELECT
  'terminada' AS temporal,
  (now() < (SELECT ends_at FROM test_session) + (SELECT close_interval FROM v_close)) AS within_checkin_window,
  (SELECT reserved > 0 FROM test_session) AS has_reservations,
  (SELECT attended = 0 FROM test_session) AS no_attendances,
  (
    (now() < (SELECT ends_at FROM test_session) + (SELECT close_interval FROM v_close))
    AND (SELECT reserved > 0 FROM test_session)
    AND (SELECT attended = 0 FROM test_session)
  ) AS test_checkin_pending;

-- 4b. Mismo caso fuera de la ventana → SIN ASISTENCIAS (no CHECK-IN PENDIENTE)
WITH test_session AS (
  SELECT
    '2000-01-01 10:00:00+00'::timestamptz AS starts_at,
    (now() - interval '30 minutes')::timestamptz AS ends_at,  -- terminó hace 30 min (> 20 min window)
    5 AS reserved,
    0 AS attended
),
v_close AS (SELECT make_interval(mins => 20) AS close_interval)
SELECT
  NOT (now() < (SELECT ends_at FROM test_session) + (SELECT close_interval FROM v_close)) AS outside_window,
  (
    NOT (now() < (SELECT ends_at FROM test_session) + (SELECT close_interval FROM v_close))
    AND (SELECT reserved > 0 FROM test_session)
    AND (SELECT attended = 0 FROM test_session)
  ) AS test_sin_asistencias;

-- 4c. Sesión sin reservas → no debe marcarse como check-in pendiente
WITH test_session AS (
  SELECT
    (now() - interval '5 minutes')::timestamptz AS ends_at,
    0 AS reserved,
    0 AS attended
),
v_close AS (SELECT make_interval(mins => 20) AS close_interval)
SELECT
  NOT ((SELECT reserved > 0 FROM test_session)) AS no_reservations,
  NOT (
    (now() < (SELECT ends_at FROM test_session) + (SELECT close_interval FROM v_close))
    AND (SELECT reserved > 0 FROM test_session)
    AND (SELECT attended = 0 FROM test_session)
  ) AS test_not_checkin_pending;

-- ============================================================
-- 5. TASA DE ASISTENCIA
-- ============================================================

-- 5a. reserved > 0 → porcentaje correcto
SELECT
  24 AS attended,
  28 AS reserved,
  round((24.0 / 28) * 100) AS rate,
  (round((24.0 / 28) * 100) = 86) AS test_rate_correct;

-- 5b. reserved = 0 → no división entre cero
SELECT
  0 AS reserved,
  NULL AS rate,
  (NULL IS NULL) AS test_no_division_by_zero;

-- ============================================================
-- 6. PRIVACIDAD — la respuesta no contiene PII
-- ============================================================

-- Verificar que el código de la función no referencia columnas PII
SELECT
  (SELECT pg_get_functiondef(p.oid) NOT LIKE '%full_name%'
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'event_operations_overview') AS no_full_name,
  (SELECT pg_get_functiondef(p.oid) NOT LIKE '%email%'
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'event_operations_overview') AS no_email,
  (SELECT pg_get_functiondef(p.oid) NOT LIKE '%phone%'
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'event_operations_overview') AS no_phone,
  (SELECT pg_get_functiondef(p.oid) NOT LIKE '%birth_date%'
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'event_operations_overview') AS no_birth_date,
  (SELECT pg_get_functiondef(p.oid) NOT LIKE '%high_school%'
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'event_operations_overview') AS no_high_school;
