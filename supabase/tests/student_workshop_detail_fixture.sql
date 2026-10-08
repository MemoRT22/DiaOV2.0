-- Disposable PostgreSQL harness for my_workshop_detail. Feed this file, then the migration,
-- then student_workshop_detail_regression.sql into ONE psql session with ON_ERROR_STOP=1.
-- BEGIN/ROLLBACK ensure that no test schema or data persists.
BEGIN;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.editions (id uuid PRIMARY KEY, is_active boolean, privacy_notice_version text);
CREATE TABLE public.participants (id uuid PRIMARY KEY, edition_id uuid, auth_user_id uuid, is_demo boolean);
CREATE TABLE public.participant_profiles (participant_id uuid, platform_consent_at timestamptz, platform_consent_version text);
CREATE TABLE public.activities (
  id uuid PRIMARY KEY, edition_id uuid, is_demo boolean, division_id uuid,
  title text, description text, activity_type text, experience_category text
);
CREATE TABLE public.activity_sessions (id uuid PRIMARY KEY, activity_id uuid, status text);
CREATE TABLE public.divisions (id uuid PRIMARY KEY, name text, sort_order int, is_demo boolean);
CREATE TABLE public.activity_divisions (activity_id uuid, division_id uuid);
CREATE TABLE public.careers (id uuid PRIMARY KEY, name text, is_demo boolean);
CREATE TABLE public.activity_careers (activity_id uuid, career_id uuid);
CREATE TABLE public.workshop_submissions (
  id uuid PRIMARY KEY, published_activity_id uuid, edition_id uuid, is_demo boolean, status text,
  objective text, takeaway text, requirements text,
  facilitator_email text, admin_notes text, review_feedback text
);

CREATE FUNCTION public.active_edition_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.editions WHERE is_active LIMIT 1
$$;

-- Same authorization contract as the production guard, with only the columns needed here.
CREATE FUNCTION public.require_participant(p_require_notice boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pid uuid; v_ver text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT p.id, e.privacy_notice_version INTO v_pid, v_ver
  FROM public.participants p JOIN public.editions e ON e.id = p.edition_id
  WHERE p.auth_user_id = auth.uid() AND p.edition_id = public.active_edition_id();
  IF v_pid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  IF p_require_notice AND NOT EXISTS (
    SELECT 1 FROM public.participant_profiles pp WHERE pp.participant_id = v_pid
      AND pp.platform_consent_at IS NOT NULL AND pp.platform_consent_version IS NOT DISTINCT FROM v_ver
  ) THEN RAISE EXCEPTION 'PRIVACY_NOTICE_REQUIRED'; END IF;
  RETURN v_pid;
END;
$$;

INSERT INTO public.editions VALUES
  ('11111111-1111-4111-8111-111111111111', true, 'v1'),
  ('22222222-2222-4222-8222-222222222222', false, 'v1');
INSERT INTO public.participants VALUES
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', false),
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000002', true),
  ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000003', false);
INSERT INTO public.participant_profiles VALUES
  ('10000000-0000-4000-8000-000000000001', now(), 'v1'),
  ('10000000-0000-4000-8000-000000000002', now(), 'v1'),
  ('10000000-0000-4000-8000-000000000003', null, null);
INSERT INTO public.divisions VALUES
  ('30000000-0000-4000-8000-000000000001', 'Ingenierías', 1, false),
  ('30000000-0000-4000-8000-000000000002', 'Negocios', 2, false),
  ('30000000-0000-4000-8000-000000000003', 'Demo', 3, true);
INSERT INTO public.careers VALUES ('40000000-0000-4000-8000-000000000001', 'Mecatrónica', false);
INSERT INTO public.activities VALUES
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', false, null, 'Publicado', 'Pitch público', 'academica', null),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', true, '30000000-0000-4000-8000-000000000003', 'Demo', 'Pitch demo', 'academica', null),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', false, '30000000-0000-4000-8000-000000000002', 'Legacy', 'Pitch legacy', 'academica', null),
  ('a0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', false, null, 'Otra edición', 'Pitch', 'academica', null),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', false, null, 'Sin sesión visible', 'Pitch', 'academica', null),
  ('a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', false, null, 'Vida sin división', 'Pitch de Vida', 'vida_universitaria', 'deportiva');
INSERT INTO public.activity_sessions VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'activa'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'activa'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'activa'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 'activa'),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', 'oculta'),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', 'activa');
INSERT INTO public.activity_divisions VALUES
  ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002');
INSERT INTO public.activity_careers VALUES ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');
INSERT INTO public.workshop_submissions VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', false, 'published',
   'Diseñar un prototipo', 'Tu prototipo', 'Zapatos cerrados', 'secret@example.invalid', 'Nota interna', 'Revisión privada'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', false, 'published',
   'Moverte y convivir', 'Una experiencia breve', 'Ropa cómoda', 'life@example.invalid', 'Nota interna', 'Revisión privada');
