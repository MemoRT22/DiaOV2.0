/*
# Fase 8A — Fix: sync_initial_interests maneja NULLs en array, RLS policy fix

## 1. sync_initial_interests
- Filtra NULLs del array antes de procesar, para que ARRAY[v_c1, NULL] funcione como si fuera ARRAY[v_c1].
- Pero mantiene el alignment de raws: si career_ids[2] es NULL, su raw correspondiente se ignora.

## 2. RLS policy on initial_interests
- La policy actual usa EXISTS subquery que puede no funcionar correctamente con set_config.
- Se simplifica para usar auth.uid() directamente en el join.
*/

CREATE OR REPLACE FUNCTION sync_initial_interests(
  p_participant_id uuid,
  p_career_ids uuid[],
  p_career_raws text[] DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_clean_ids uuid[];
  v_n int;
  v_c1 uuid; v_c2 uuid; v_r1 text; v_r2 text;
  v_is_demo boolean;
BEGIN
  -- Remove NULLs from career_ids
  v_clean_ids := ARRAY(SELECT x FROM unnest(p_career_ids) x WHERE x IS NOT NULL);
  v_n := coalesce(array_length(v_clean_ids, 1), 0);

  IF v_n > 2 THEN RAISE EXCEPTION 'TOO_MANY_INITIAL_INTERESTS'; END IF;
  IF v_n > 0 AND (SELECT count(DISTINCT x) FROM unnest(v_clean_ids) x) <> v_n THEN
    RAISE EXCEPTION 'DUPLICATE_INITIAL_INTEREST';
  END IF;

  SELECT is_demo INTO v_is_demo FROM participants WHERE id = p_participant_id;
  IF v_is_demo IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  IF v_n > 0 THEN
    IF (SELECT count(*) FROM careers WHERE id = ANY(v_clean_ids) AND is_active) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
    IF EXISTS (
      SELECT 1 FROM careers c
      WHERE c.id = ANY(v_clean_ids) AND NOT v_is_demo AND c.is_demo
    ) THEN RAISE EXCEPTION 'CAREER_ENVIRONMENT_MISMATCH'; END IF;
  END IF;

  -- Extract values (aligned with original positions, now using cleaned array)
  v_c1 := CASE WHEN v_n >= 1 THEN v_clean_ids[1] ELSE NULL END;
  v_c2 := CASE WHEN v_n >= 2 THEN v_clean_ids[2] ELSE NULL END;
  v_r1 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 1 THEN nullif(p_career_raws[1], '') ELSE NULL END;
  v_r2 := CASE WHEN p_career_raws IS NOT NULL AND array_length(p_career_raws, 1) >= 2 THEN nullif(p_career_raws[2], '') ELSE NULL END;

  DELETE FROM initial_interests WHERE participant_id = p_participant_id;

  IF v_c1 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 1, v_c1, v_r1);
  END IF;
  IF v_c2 IS NOT NULL THEN
    INSERT INTO initial_interests (participant_id, preference, career_id, career_raw)
    VALUES (p_participant_id, 2, v_c2, v_r2);
  END IF;

  UPDATE participants SET
    initial_career_id = v_c1,
    initial_career_raw = v_r1,
    updated_at = now()
  WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_initial_interests(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated;

-- Fix RLS policy: use direct join instead of EXISTS subquery
DROP POLICY IF EXISTS "Participant reads own initial interests" ON initial_interests;
CREATE POLICY "Participant reads own initial interests"
  ON initial_interests FOR SELECT TO authenticated
  USING (
    participant_id IN (
      SELECT id FROM participants WHERE auth_user_id = auth.uid()
    )
  );
