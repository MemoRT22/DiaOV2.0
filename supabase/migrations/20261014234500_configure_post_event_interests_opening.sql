-- Día OV 2026: apertura general de intereses posteriores.
-- Reutiliza la configuración existente: se habilita con dos asistencias O a esta hora.
-- America/Cancun es UTC-5 todo el año; 12:30 local = 17:30Z.
-- No modifica intereses iniciales/posteriores, asistencias ni respuestas existentes.
UPDATE public.editions
SET interests_prompt_min_attendances = 2,
    interests_prompt_at = '2026-10-15 12:30:00 America/Cancun'::timestamptz
WHERE code = 'DIAOV2026';
