/*
# Roles múltiples para el personal

1. Nuevas tablas
- `staff_roles`: roles asignados a cada cuenta del personal. Una persona puede tener varios
  (`coordinacion`, `staff`, `sorteo`). Clave (user_id, role).

2. Cambios
- `staff_members.email` (text): correo de la cuenta, para el directorio que ve Coordinación.
- `staff_members.role` admite `sorteo` y queda como rol principal informativo; la autorización usa `staff_roles`.
- Se copian los roles actuales a `staff_roles` (la cuenta de Coordinación existente conserva su acceso).

3. Funciones
- `has_staff_role(role)`: la cuenta que llama está activa y tiene ese rol.
- `is_coordinacion()`: ahora usa `staff_roles`.
- `is_operativo()`: tiene `staff` o `coordinacion` (gestión de participantes).
- `require_operativo()`: interno, lanza NOT_AUTHORIZED.

4. Seguridad
- RLS en `staff_roles`: cada quien lee sus roles; Coordinación lee todos. Sin escrituras desde el navegador
  (las cuentas se administran solo con la función de servidor `staff-accounts`).
*/

CREATE TABLE IF NOT EXISTS staff_roles (
  user_id uuid NOT NULL REFERENCES staff_members(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('coordinacion', 'staff', 'sorteo')),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'email') THEN
    ALTER TABLE staff_members ADD COLUMN email text;
  END IF;
END $$;

ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_role_check CHECK (role IN ('coordinacion', 'staff', 'sorteo'));

UPDATE staff_members s SET email = lower(u.email) FROM auth.users u WHERE u.id = s.user_id AND s.email IS NULL;

INSERT INTO staff_roles (user_id, role)
SELECT user_id, role FROM staff_members
ON CONFLICT DO NOTHING;

ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON staff_roles FROM authenticated;

CREATE OR REPLACE FUNCTION has_staff_role(p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_roles r JOIN staff_members m ON m.user_id = r.user_id
    WHERE r.user_id = auth.uid() AND r.role = p_role AND m.is_active
  );
$$;

CREATE OR REPLACE FUNCTION is_coordinacion()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_staff_role('coordinacion');
$$;

CREATE OR REPLACE FUNCTION is_operativo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_staff_role('coordinacion') OR has_staff_role('staff');
$$;

CREATE OR REPLACE FUNCTION require_operativo()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_operativo() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION has_staff_role(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION is_operativo() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION require_operativo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION is_coordinacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION has_staff_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION is_operativo() TO authenticated;
GRANT EXECUTE ON FUNCTION is_coordinacion() TO authenticated;

DROP POLICY IF EXISTS "Staff read own roles" ON staff_roles;
CREATE POLICY "Staff read own roles" ON staff_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Coordinacion reads all roles" ON staff_roles;
CREATE POLICY "Coordinacion reads all roles" ON staff_roles FOR SELECT TO authenticated
USING (is_coordinacion());
