/*
# Restringir EXECUTE de export_vocational

export_vocational es SECURITY DEFINER y exporta datos personales.
- PUBLIC: sin EXECUTE
- anon: sin EXECUTE
- authenticated: EXECUTE (la autorización funcional sigue en require_coordinacion())
La lógica de la función no cambia.
*/

REVOKE EXECUTE ON FUNCTION public.export_vocational(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_vocational(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_vocational(text, boolean) TO authenticated;