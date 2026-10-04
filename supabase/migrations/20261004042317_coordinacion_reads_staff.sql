/*
# Coordinación can read the staff directory

1. Security
- New SELECT policy on `staff_members` so Coordinación can see every staff member
  (used to show who performed each audited action).
- No write access is added; staff accounts are still managed only by the server.
*/

DROP POLICY IF EXISTS "Coordinacion reads all staff" ON staff_members;
CREATE POLICY "Coordinacion reads all staff"
ON staff_members FOR SELECT
TO authenticated
USING (is_coordinacion());
