-- Fase EXPAND (compatible): los conflictos de importación ahora pueden referirse a los campos estructurales
-- nuevos (grado, periodo) y a la segunda carrera inicial. 'birth_date' se conserva hasta la migración de contrato.
ALTER TABLE public.participant_import_conflicts DROP CONSTRAINT IF EXISTS participant_import_conflicts_field_check;
ALTER TABLE public.participant_import_conflicts ADD CONSTRAINT participant_import_conflicts_field_check
  CHECK (field IN ('full_name', 'birth_date', 'phone', 'high_school', 'high_school_grade', 'entry_period',
                   'initial_career_id', 'initial_career_id_2'));
