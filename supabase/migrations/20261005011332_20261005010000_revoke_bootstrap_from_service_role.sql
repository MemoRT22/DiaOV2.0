/*
# Corrección: revocar EXECUTE de bootstrap_first_coordinator a service_role

La función bootstrap_first_coordinator estaba revocada para PUBLIC, anon y authenticated,
pero service_role conservaba EXECUTE. Esta migración revoca explícitamente EXECUTE
para service_role también, dejando la función ejecutable únicamente por roles
administrativos de base de datos (superuser/postgres) desde SQL Editor.

La función se conserva como mecanismo documentado de bootstrap/recovery administrativo.
*/

REVOKE ALL ON FUNCTION public.bootstrap_first_coordinator(uuid, text) FROM service_role;