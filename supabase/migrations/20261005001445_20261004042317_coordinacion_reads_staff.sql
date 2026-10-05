DROP POLICY IF EXISTS "Coordinacion reads all staff" ON staff_members;
CREATE POLICY "Coordinacion reads all staff"
ON staff_members FOR SELECT
TO authenticated
USING (is_coordinacion());