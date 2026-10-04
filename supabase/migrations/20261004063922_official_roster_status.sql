/*
# Padrón oficial: estado de preparación / oficial

1. Tablas modificadas
- `editions`
  - `roster_status` (text, 'preparacion' | 'oficial', default 'preparacion'): estado del padrón de participantes.
  - `roster_declared_at` (timestamptz): cuándo se declaró oficial por última vez.
- `participants`
  - `initial_career_raw` (text): texto original de carrera recibido en el CSV de Forms (trazabilidad).

2. Nuevas funciones (solo Coordinación, vía RPC)
- `declare_official_roster(p_phrase)`: declara el padrón oficial. Frase "DECLARAR PADRÓN OFICIAL". Auditoría `roster.declared_official`.
- `reopen_roster_import(p_phrase, p_reason)`: reapertura excepcional. Frase "REABRIR IMPORTACIÓN" y motivo (>= 10). Auditoría `roster.reopened`.

3. Seguridad
- `editions` sigue sin políticas de escritura: el estado solo cambia mediante estas funciones.
- Las funciones revocan PUBLIC/anon y se otorgan solo a authenticated; validan `require_coordinacion()`.

4. Documentación
- COMMENT en `require_participant` y `my_progress` sobre el uso intencional antes del Aviso.
*/

ALTER TABLE editions ADD COLUMN IF NOT EXISTS roster_status text NOT NULL DEFAULT 'preparacion';
ALTER TABLE editions ADD COLUMN IF NOT EXISTS roster_declared_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'editions_roster_status_check') THEN
    ALTER TABLE editions ADD CONSTRAINT editions_roster_status_check CHECK (roster_status IN ('preparacion', 'oficial'));
  END IF;
END $$;

ALTER TABLE participants ADD COLUMN IF NOT EXISTS initial_career_raw text;

CREATE OR REPLACE FUNCTION declare_official_roster(p_phrase text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_at timestamptz := now();
BEGIN
PERFORM require_coordinacion();
IF p_phrase IS DISTINCT FROM 'DECLARAR PADRÓN OFICIAL' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
IF (SELECT roster_status FROM editions WHERE id = v_ed) = 'oficial' THEN RAISE EXCEPTION 'ROSTER_ALREADY_OFFICIAL'; END IF;
UPDATE editions SET roster_status = 'oficial', roster_declared_at = v_at WHERE id = v_ed;
PERFORM write_audit('roster.declared_official', jsonb_build_object(
  'participants', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND NOT is_demo),
  'demo_participants', (SELECT count(*) FROM participants WHERE edition_id = v_ed AND is_demo)));
RETURN v_at;
END;
$$;

CREATE OR REPLACE FUNCTION reopen_roster_import(p_phrase text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ed uuid := active_edition_id(); v_prev timestamptz;
BEGIN
PERFORM require_coordinacion();
IF p_phrase IS DISTINCT FROM 'REABRIR IMPORTACIÓN' THEN RAISE EXCEPTION 'WRONG_PHRASE'; END IF;
IF length(btrim(coalesce(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
SELECT roster_declared_at INTO v_prev FROM editions WHERE id = v_ed AND roster_status = 'oficial';
IF NOT FOUND THEN RAISE EXCEPTION 'ROSTER_NOT_OFFICIAL'; END IF;
UPDATE editions SET roster_status = 'preparacion', roster_declared_at = NULL WHERE id = v_ed;
PERFORM write_audit('roster.reopened', jsonb_build_object('reason', left(btrim(p_reason), 500), 'declared_at', v_prev));
END;
$$;

REVOKE ALL ON FUNCTION declare_official_roster(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reopen_roster_import(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION declare_official_roster(text) TO authenticated;
GRANT EXECUTE ON FUNCTION reopen_roster_import(text, text) TO authenticated;

COMMENT ON FUNCTION require_participant(boolean) IS
'Guardia central del participante. p_require_notice=false solo para incorporación (my_progress, accept_platform_notice). Toda operación privada (intereses, reservaciones, cambios de ruta, check-in) DEBE usar require_participant(true).';
COMMENT ON FUNCTION my_progress() IS
'Intencionalmente legible antes de aceptar el Aviso de Privacidad de la plataforma: la bienvenida lo usa para mostrar el estado de aceptación. No expone datos de terceros.';
