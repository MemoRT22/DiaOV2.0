/*
# Permiso de servidor para leer la edición activa

1. Seguridad
- La función de servidor `staff-accounts` usa `active_edition_id()` para registrar la auditoría.
  Se concede EXECUTE solo al rol de servidor (service_role). El navegador no gana acceso nuevo.
*/
GRANT EXECUTE ON FUNCTION active_edition_id() TO service_role;
