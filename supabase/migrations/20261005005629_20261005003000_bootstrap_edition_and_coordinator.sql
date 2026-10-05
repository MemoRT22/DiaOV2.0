/*
# Bootstrap operacional: edición Día OV 2026, categorías de sorteo y función de primer Coordinador

1. Edición activa
- Crea la edición "Día OV 2026" (code = 'DIAOV2026') de forma idempotente.
- Si ya existe pero está inactiva, la activa (respetando la constraint de una única edición activa).
- Modo inicial: 'preparacion'. No activa 'operacion_real'.
- Fecha: 2026-10-15, inicio 08:30, timezone America/Cancun, sede Universidad Anáhuac Cancún.
- Aviso de privacidad: versión 'v1', sin texto legal definitivo (pendiente).

2. Categorías de sorteo
- Inicializa las 6 categorías (3 reales + 3 demo) para la edición activa.
- Real: Baja (academic>=3, leadership>=0), Media (academic>=3, leadership>=1), Mayor (academic>=4, leadership>=1).
- Demo: mismas reglas.
- Idempotente con ON CONFLICT (edition_id, name, is_demo) DO NOTHING.

3. Función bootstrap_first_coordinator
- Crea el primer usuario de Coordinación a partir de un UUID de auth.users.
- SIN permisos para PUBLIC, anon ni authenticated: se ejecuta exclusivamente desde SQL Editor.
- Valida: UUID existe en auth.users, tiene email, no existe coordinador activo, no existe staff_member incompatible.
- Segunda llamada: ALREADY_BOOTSTRAPPED.
- No hardcodea UUID, correo ni contraseña.

4. Rangos
- NO se siembran rank_levels. Coordinación los configurará desde la interfaz.
- El sistema mantiene fallback a nivel 1 mientras no haya reglas.

5. Documentación del procedimiento de bootstrap
  Pasos para crear el primer Coordinador:
  1. En Supabase Dashboard → Authentication → Users → Add user.
     Crear usuario con correo y contraseña elegidos (nunca en Git).
  2. Copiar el UUID del usuario creado.
  3. En Supabase Dashboard → SQL Editor, ejecutar:
     SELECT bootstrap_first_coordinator('<uuid>', 'Nombre Completo');
  4. A partir de ese momento, el panel de administración funciona.
     El resto del personal se crea desde la aplicación vía staff-accounts.
*/

-- 1. Edición activa
INSERT INTO editions (code, name, event_date, start_time, timezone, venue, is_active, mode, privacy_notice_version, privacy_notice_summary)
VALUES ('DIAOV2026', 'Día OV 2026', '2026-10-15', '08:30', 'America/Cancun', 'Universidad Anáhuac Cancún', true, 'preparacion', 'v1', '')
ON CONFLICT (code) DO UPDATE SET is_active = true, mode = 'preparacion';

-- 2. Categorías de sorteo (idempotentes)
DO $$
DECLARE v_ed uuid := active_edition_id();
BEGIN
  IF v_ed IS NULL THEN RAISE EXCEPTION 'NO_ACTIVE_EDITION'; END IF;
  -- Reales
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config)
  VALUES
    (v_ed, 'Baja', 10, 3, 0, true, false, '{}'::jsonb),
    (v_ed, 'Media', 20, 3, 1, true, false, '{}'::jsonb),
    (v_ed, 'Mayor', 30, 4, 1, true, false, '{}'::jsonb)
  ON CONFLICT (edition_id, name, is_demo) DO NOTHING;
  -- Demo
  INSERT INTO raffle_categories (edition_id, name, sort_order, required_academic, required_leadership, is_active, is_demo, visual_config)
  VALUES
    (v_ed, 'Baja', 10, 3, 0, true, true, '{}'::jsonb),
    (v_ed, 'Media', 20, 3, 1, true, true, '{}'::jsonb),
    (v_ed, 'Mayor', 30, 4, 1, true, true, '{}'::jsonb)
  ON CONFLICT (edition_id, name, is_demo) DO NOTHING;
END $$;

-- 3. Función bootstrap_first_coordinator
CREATE OR REPLACE FUNCTION public.bootstrap_first_coordinator(p_user_uuid uuid, p_full_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_exists boolean;
  v_staff_exists boolean;
  v_coord_exists boolean;
BEGIN
  -- El usuario debe existir en auth.users y tener email
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_uuid;
  IF v_email IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION 'USER_HAS_NO_EMAIL'; END IF;

  -- No debe existir ningún coordinador activo
  SELECT EXISTS (
    SELECT 1 FROM staff_members sm
    JOIN staff_roles sr ON sr.user_id = sm.user_id
    WHERE sm.is_active AND sr.role = 'coordinacion'
  ) INTO v_coord_exists;
  IF v_coord_exists THEN RAISE EXCEPTION 'ALREADY_BOOTSTRAPPED'; END IF;

  -- No debe existir un staff_member incompatible para ese usuario
  SELECT EXISTS (
    SELECT 1 FROM staff_members WHERE user_id = p_user_uuid
  ) INTO v_staff_exists;
  IF v_staff_exists THEN RAISE EXCEPTION 'USER_ALREADY_STAFF'; END IF;

  -- Insertar staff_member
  INSERT INTO staff_members (user_id, role, full_name, email, is_active, is_demo)
  VALUES (p_user_uuid, 'coordinacion', p_full_name, lower(v_email), true, false);

  -- Insertar staff_role
  INSERT INTO staff_roles (user_id, role, granted_by)
  VALUES (p_user_uuid, 'coordinacion', p_user_uuid);

  -- Auditar
  PERFORM write_audit('bootstrap.first_coordinator', jsonb_build_object(
    'user_id', p_user_uuid, 'full_name', p_full_name, 'email', lower(v_email)
  ));

  RETURN jsonb_build_object('user_id', p_user_uuid, 'full_name', p_full_name, 'email', lower(v_email), 'role', 'coordinacion');
END;
$$;

-- Sin permisos para ningún rol: exclusivamente administrativo (SQL Editor)
REVOKE ALL ON FUNCTION public.bootstrap_first_coordinator(uuid, text) FROM PUBLIC, anon, authenticated;