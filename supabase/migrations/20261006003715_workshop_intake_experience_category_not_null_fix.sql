/*
# Corrección: categoría de experiencia nula en Vida Universitaria

El CHECK `workshop_submissions_experience_category_check` evaluaba `experience_category IN (...)`, que con un
valor NULL da NULL y el CHECK lo deja pasar. Se exige explícitamente `IS NOT NULL` para `vida_universitaria`.
*/
ALTER TABLE workshop_submissions DROP CONSTRAINT IF EXISTS workshop_submissions_experience_category_check;
ALTER TABLE workshop_submissions ADD CONSTRAINT workshop_submissions_experience_category_check CHECK (
  (activity_type = 'academica' AND experience_category IS NULL)
  OR (activity_type = 'vida_universitaria' AND experience_category IS NOT NULL
      AND experience_category IN ('liderazgo', 'deportiva', 'artistica_cultural', 'vida_universitaria', 'otra')));
