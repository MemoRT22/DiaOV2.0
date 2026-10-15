-- Día OV 2026: apertura general de intereses posteriores.
-- Reutiliza la configuración existente: se habilita con dos asistencias O a esta hora.
-- America/Cancun es UTC-5 todo el año; 12:30 local = 17:30Z.
-- No modifica intereses iniciales/posteriores, asistencias ni respuestas existentes.
DO $$
DECLARE v_updated integer;
BEGIN
  UPDATE public.editions
  SET interests_prompt_min_attendances = 2,
      interests_prompt_at = '2026-10-15 12:30:00 America/Cancun'::timestamptz
  WHERE code = 'DIAOV2026';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one DIAOV2026 edition, updated %', v_updated;
  END IF;
END $$;
