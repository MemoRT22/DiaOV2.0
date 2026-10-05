/*
# Intereses finales (post-evento)

La tabla `post_event_interests`, su RLS y `save_post_event_interests` ya existían (fase 1). Esta migración los
alinea con la especificación y los mantiene independientes de `initial_interests`.

## Tabla `post_event_interests`
- Añade `created_at` (el reemplazo conserva el `created_at` de una carrera que se mantiene).
- Índice por `career_id`.
- Permisos: antes `authenticated` conservaba TRUNCATE / REFERENCES / TRIGGER (TRUNCATE ignora RLS). Se revoca todo
  a anon/authenticated y se deja solo SELECT (limitado por RLS a las filas propias).
- Ya cuenta con: PK (participant_id, preference), CHECK preference 1..3 (máximo 3 filas),
  UNIQUE (participant_id, career_id), FKs a participants (CASCADE) y careers (RESTRICT).

## Estado explícito (`post_event_interests_state`, interna)
- prompt: asistencias >= editions.interests_prompt_min_attendances  O  now() >= interests_prompt_at.
- open: interests_close_at IS NULL  O  now() < interests_close_at.
- completed: existe al menos una fila.
- can_edit: prompt AND open.

## RPCs
- `save_post_event_interests(uuid[])`: identidad por `require_participant`; 0 a 3 carreras; sin duplicados ni NULL;
  carreras activas y del mismo entorno demo/real; rechaza si la ventana cerró (INTERESTS_CLOSED) o aún no se habilita
  (INTERESTS_NOT_AVAILABLE); reemplazo atómico (el orden del arreglo es la preferencia); idempotente (misma selección
  = sin escrituras). Ya NO exige que la división de la carrera tenga talleres: la pregunta es sobre carreras.
- `my_post_event_interests()`: selección propia ordenada + estado explícito. Se puede consultar con la ventana cerrada.
- `my_progress()`: añade post_event_interests_prompt / _open / _completed. `interests_prompt` e `interests_open`
  se conservan como alias por compatibilidad.

No toca initial_interests, participants.initial_career_id, recomendaciones, reservaciones, asistencias ni créditos.
*/

-- ========== 1. Tabla ==========
ALTER TABLE post_event_interests ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS post_event_interests_career_idx ON post_event_interests (career_id);

REVOKE ALL ON post_event_interests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON post_event_interests TO authenticated;

-- ========== 2. Estado explícito (interna) ==========
CREATE OR REPLACE FUNCTION post_event_interests_state(p_pid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ed editions%ROWTYPE; v_att int; v_prompt boolean; v_open boolean; v_completed boolean;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = p_pid;
  IF v_ed.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  v_att := my_attended_workshop_count(p_pid);
  v_prompt := v_att >= v_ed.interests_prompt_min_attendances
    OR (v_ed.interests_prompt_at IS NOT NULL AND now() >= v_ed.interests_prompt_at);
  v_open := v_ed.interests_close_at IS NULL OR now() < v_ed.interests_close_at;
  v_completed := EXISTS (SELECT 1 FROM post_event_interests WHERE participant_id = p_pid);
  RETURN jsonb_build_object(
    'post_event_interests_prompt', v_prompt,
    'post_event_interests_open', v_open,
    'post_event_interests_completed', v_completed,
    'post_event_interests_can_edit', v_prompt AND v_open
  );
END;
$$;
REVOKE ALL ON FUNCTION post_event_interests_state(uuid) FROM PUBLIC, anon, authenticated;

-- ========== 3. save_post_event_interests ==========
CREATE OR REPLACE FUNCTION save_post_event_interests(p_career_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(true);
  v_state jsonb; v_is_demo boolean; v_n int; v_current uuid[]; v_old jsonb;
BEGIN
  IF p_career_ids IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_n := coalesce(array_length(p_career_ids, 1), 0);

  -- serialize concurrent saves of the same participant
  SELECT is_demo INTO v_is_demo FROM participants WHERE id = v_pid FOR NO KEY UPDATE;

  v_state := post_event_interests_state(v_pid);
  IF NOT (v_state->>'post_event_interests_open')::boolean THEN RAISE EXCEPTION 'INTERESTS_CLOSED'; END IF;
  IF NOT (v_state->>'post_event_interests_prompt')::boolean THEN RAISE EXCEPTION 'INTERESTS_NOT_AVAILABLE'; END IF;

  IF v_n > 3 THEN RAISE EXCEPTION 'TOO_MANY_INTERESTS'; END IF;
  IF v_n > 0 THEN
    IF EXISTS (SELECT 1 FROM unnest(p_career_ids) x WHERE x IS NULL) THEN RAISE EXCEPTION 'INVALID_CAREER'; END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(p_career_ids) x) <> v_n THEN RAISE EXCEPTION 'DUPLICATE_INTEREST'; END IF;
    -- existing, active catalog careers of the participant's environment (demo/real)
    IF (SELECT count(*) FROM careers c
        WHERE c.id = ANY (p_career_ids) AND c.is_active AND c.is_demo = v_is_demo) <> v_n THEN
      RAISE EXCEPTION 'INVALID_CAREER';
    END IF;
  END IF;

  SELECT coalesce(array_agg(career_id ORDER BY preference), ARRAY[]::uuid[]) INTO v_current
  FROM post_event_interests WHERE participant_id = v_pid;
  IF v_current = p_career_ids OR (v_n = 0 AND cardinality(v_current) = 0) THEN RETURN; END IF; -- idempotent

  SELECT coalesce(jsonb_object_agg(career_id::text, created_at), '{}'::jsonb) INTO v_old
  FROM post_event_interests WHERE participant_id = v_pid;

  DELETE FROM post_event_interests WHERE participant_id = v_pid;
  INSERT INTO post_event_interests (participant_id, preference, career_id, created_at, updated_at)
  SELECT v_pid, t.ord::smallint, t.cid, coalesce((v_old->>t.cid::text)::timestamptz, now()), now()
  FROM unnest(p_career_ids) WITH ORDINALITY AS t(cid, ord);

  PERFORM write_audit('interests.saved', jsonb_build_object('count', v_n));
END;
$$;
REVOKE ALL ON FUNCTION save_post_event_interests(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_post_event_interests(uuid[]) TO authenticated;

-- ========== 4. my_post_event_interests ==========
CREATE OR REPLACE FUNCTION my_post_event_interests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := require_participant(false);
BEGIN
  RETURN post_event_interests_state(v_pid) || jsonb_build_object(
    'max_interests', 3,
    'career_ids', coalesce((SELECT jsonb_agg(career_id ORDER BY preference)
                            FROM post_event_interests WHERE participant_id = v_pid), '[]'::jsonb),
    'items', coalesce((SELECT jsonb_agg(jsonb_build_object('career_id', career_id, 'preference', preference)
                                        ORDER BY preference)
                       FROM post_event_interests WHERE participant_id = v_pid), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION my_post_event_interests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_post_event_interests() TO authenticated;

-- ========== 5. my_progress: estado explícito ==========
CREATE OR REPLACE FUNCTION my_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid := require_participant(false);
  v_ed editions%ROWTYPE; v_stamps int; v_attended int; v_reserved int;
  v_divs uuid[]; v_level int; v_next rank_levels%ROWTYPE; v_consent boolean; v_pei jsonb;
BEGIN
  SELECT e.* INTO v_ed FROM editions e JOIN participants p ON p.edition_id = e.id WHERE p.id = v_pid;
  v_stamps := my_stamp_count(v_pid);
  v_attended := my_attended_workshop_count(v_pid);
  SELECT coalesce(array_agg(DISTINCT a2.division_id), '{}') INTO v_divs
  FROM attendances at
  JOIN activity_sessions s ON s.id = at.session_id
  JOIN activities a2 ON a2.id = at.activity_id
  WHERE at.participant_id = v_pid;
  v_reserved := active_reservation_count(v_pid);
  SELECT coalesce(max(level), 1) INTO v_level FROM rank_levels
  WHERE edition_id = v_ed.id AND required_attendances <= v_stamps
    AND required_divisions <= coalesce(array_length(v_divs, 1), 0);
  SELECT * INTO v_next FROM rank_levels WHERE edition_id = v_ed.id AND level = v_level + 1;
  SELECT platform_consent_at IS NOT NULL AND platform_consent_version = v_ed.privacy_notice_version
  INTO v_consent FROM participant_profiles WHERE participant_id = v_pid;
  v_pei := post_event_interests_state(v_pid);
  RETURN jsonb_build_object(
    'level', v_level,
    'stamps', v_stamps,
    'attended_workshops', v_attended,
    'reserved_workshops', v_reserved,
    'division_ids', to_jsonb(v_divs),
    'next', CASE WHEN v_next.level IS NULL THEN NULL ELSE jsonb_build_object('level', v_next.level,
      'required_attendances', v_next.required_attendances, 'required_divisions', v_next.required_divisions) END,
    'consent_accepted', coalesce(v_consent, false),
    'post_event_interests_prompt', v_pei->'post_event_interests_prompt',
    'post_event_interests_open', v_pei->'post_event_interests_open',
    'post_event_interests_completed', v_pei->'post_event_interests_completed',
    -- deprecated aliases (kept for compatibility); use the post_event_* keys
    'interests_prompt', v_pei->'post_event_interests_prompt',
    'interests_open', v_pei->'post_event_interests_open'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION my_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_progress() TO authenticated;
