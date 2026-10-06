-- Helper de keywords: sin EXECUTE para PUBLIC/anon/authenticated (el CHECK lo evalua el propietario al insertar)
REVOKE ALL ON FUNCTION workshop_keywords_valid(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION workshop_keywords_valid(text[]) TO service_role;
