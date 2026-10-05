CREATE OR REPLACE FUNCTION normalize_forms_extra(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  e record; v_out jsonb := '{}'::jsonb; v_label text; v_base_key text; v_key text;
  v_n int; v_count int := 0; v_val text; v_pos int;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' THEN RETURN '{}'::jsonb; END IF;
  FOR e IN SELECT x.value AS j, x.ord FROM jsonb_array_elements(p) WITH ORDINALITY AS x(value, ord)
           ORDER BY CASE WHEN (x.value->>'col') ~ '^\d{1,4}$' THEN (x.value->>'col')::int ELSE 10000 + x.ord::int END
  LOOP
    EXIT WHEN v_count >= 60;
    CONTINUE WHEN jsonb_typeof(e.j) <> 'object';
    v_count := v_count + 1;
    v_pos := CASE WHEN (e.j->>'col') ~ '^\d{1,4}$' THEN (e.j->>'col')::int ELSE 10000 + e.ord::int END;
    v_label := btrim(regexp_replace(regexp_replace(coalesce(e.j->>'header', ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
    IF v_label = '' THEN v_label := 'Columna sin título ' || v_pos; END IF;
    IF length(v_label) > 80 THEN
      v_label := coalesce(nullif(regexp_replace(left(v_label, 80), '\s+\S*$', ''), ''), left(v_label, 80)) || '…';
    END IF;
    v_base_key := fold_text(v_label);
    v_key := v_base_key; v_n := 1;
    WHILE v_out ? v_key LOOP
      v_n := v_n + 1;
      v_key := v_base_key || ' (' || v_n || ')';
    END LOOP;
    IF v_n > 1 THEN v_label := (v_out->v_base_key->>'label') || ' (' || v_n || ')'; END IF;
    v_val := left(btrim(regexp_replace(coalesce(e.j->>'value', ''), '[\x01-\x09\x0b-\x1f\x7f]', '', 'g')), 1000);
    v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('label', v_label, 'value', v_val, 'pos', v_pos));
  END LOOP;
  RETURN (SELECT coalesce(jsonb_object_agg(k, val), '{}'::jsonb) FROM jsonb_each(v_out) AS t(k, val) WHERE val->>'value' <> '');
END;
$$;

REVOKE EXECUTE ON FUNCTION normalize_forms_extra(jsonb) FROM PUBLIC, anon, authenticated;