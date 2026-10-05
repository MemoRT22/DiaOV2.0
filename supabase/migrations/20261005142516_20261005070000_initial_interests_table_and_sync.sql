/*
# Fase 8A — Intereses iniciales del prerregistro (hasta 2 carreras)

## Objetivo
Un participante prerregistrado puede haber seleccionado hasta 2 carreras de interés
antes del evento. Esas carreras se almacenan en una tabla normalizada `initial_interests`
con prioridad 1 y 2. Esta tabla es la fuente lógica única para las recomendaciones.

## 1. Nueva tabla: initial_interests
- `participant_id` (FK → participants ON DELETE CASCADE)
- `preference` (smallint, CHECK 1-2): prioridad 1 = primera carrera, 2 = segunda
- `career_id` (FK → careers ON DELETE RESTRICT): carrera oficial del catálogo
- `career_raw` (text, nullable): valor original recibido del Forms (para auditoría)
- `created_at`, `updated_at`
- PK compuesta (participant_id, preference)
- UNIQUE (participant_id, career_id) — sin duplicados

## 2. RLS
- Participante puede leer solo sus propias filas
- Sin políticas de escritura directa — todo via funciones SECURITY DEFINER

## 3. Función interna: sync_initial_interests
- Reemplaza atómicamente todas las filas de initial_interests de un participante
- Valida máximo 2, no duplicados, carreras activas
- Sincroniza participants.initial_career_id con preference 1 (compatibilidad temporal)

## 4. Migración de datos existentes
- Cada participante con initial_career_id se migra a initial_interests con preference=1
- initial_career_raw se copia a career_raw
- Idempotente: ON CONFLICT DO NOTHING

## 5. Seguridad
- RLS habilitado en initial_interests
- Sin grants directos a anon ni authenticated para escritura
- sync_initial_interests revocada de PUBLIC, anon, authenticated (función interna)
*/

-- ============================================================
-- 1. Crear tabla initial_interests
-- ============================================================
CREATE TABLE IF NOT EXISTS initial_interests (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  preference smallint NOT NULL CHECK (preference BETWEEN 1 AND 2),
  career_id uuid NOT NULL REFERENCES careers(id) ON DELETE RESTRICT,
  career_raw text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, preference),
  UNIQUE (participant_id, career_id)
);

ALTER TABLE initial_interests ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "Participant reads own initial interests" ON initial_interests;
CREATE POLICY "Participant reads own initial interests"
  ON initial_interests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM participants p
      WHERE p.id = initial_interests.participant_id
        AND p.auth_user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — all writes go through SECURITY DEFINER functions
REVOKE ALL ON initial_interests FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS initial_interests_career_idx ON initial_interests (career_id);

-- ============================================================
-- 2. Función interna: sync_initial_interests
-- ============================================================
CREATE OR REPLACE FUNCTION sync_initial_interests(
  p_participant_id uuid,
  p_career_ids uuid[],
  p_career_raws text[] DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n int := coalesce(array_length(p_career_ids, 1), 0);
  v_c1 uuid; v_c2 uuid; v_r1 text; v_r2 text;
  v_is_demo boolean;
BEGIN
  -- Validate max 2
  IF v_n > 2 THEN RAISE EXCEPTION 'TOO_MANY_INITIAL_INTERESTS'; END IF;

  -- Validate no duplicates
  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN
    RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
  END IF;

  -- Validate careers exist and are active
  IF v_n > 0 AND (SELECT count(*) FROM careers WHERE id = ANY(p_career_ids) AND is_active) <> v_n THEN
    RAISE EXCEPTION 'INVALID_CAREER';
  END IF;

  -- Get participant's is_demo for environment check
  SELECT is_demo INTO v_is_demo FROM participants WHERE id = p_participant_id;
  IF v_is_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  -- Validate careers match demo/real environment
  IF v_n > 0 AND EXISTS (
    SELECT 1 FROM careers WHERE id = ANY(p_career_ids) AND NOT is_active
  ) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;

  IF v_n > 0 AND EXISTS (
    SELECT 1 FROM careers c
    WHERE c.id = ANY(p_career_ids) AND NOT v_is_demo AND c.is_demo
  ) THEN RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH'; END IF;

  -- Extract individual values
  v_c1 := CASE WHEN v_n >= 1 THEN p_career_ids[1] ELSE NULL END;
  v_c2 := CASE WHEN v_n >= 2 THEN p_career_ids[2] ELSE NULL END;
  v_r1 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 1 THEN p_career_raws[1] ELSE NULL END;
  v_r2 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 2 THEN p_career_raws[2] ELSE NULL END;

  -- Atomic replace: delete all existing, insert new ones
  DELETE FROM initial_interests WHERE participant_id = p_participant_id;

  IF v_c1 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 1, v_c1, v_r1);
  END IF;

  IF v_c2 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 2, v_c2, v_r2);
  END IF;

  -- Sync participants.initial_career_id with preference 1 (compatibility)
  UPDATE participants SET
    initial_career_id = v_c1,
    initial_career_raw = v_r1,
    updated_at = now()
  WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_initial_interests(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Migrar datos existentes desde initial_career_id
-- ============================================================
INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
SELECT p.id, 1, p.initial_career_id, p.initial_career_raw
FROM participants p
WHERE p.initial_career_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM initial_interests ii
    WHERE ii.participant_id = p.id AND ii.preference = 1
  )
ON CONFLICT DO NOTHING;
