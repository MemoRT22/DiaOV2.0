/*
# Fase 4: Asistencia con QR, código manual, sellos y Pasaporte

1. Tabla nueva: `session_credentials`
- Una fila por sesión. Contiene la credencial impredecible de check-in.
- `qr_token_hash`: hash del token largo del QR (validación por comparación).
- `manual_code_hash`: hash del código corto de 6 caracteres (validación por comparación).
- `qr_token_encrypted` y `manual_code_encrypted`: valores recuperables para mostrar el QR/código
  a operadores autorizados, cifrados con pgcrypto (pgp_sym_encrypt/pgp_sym_decrypt).
- `rotated_at`: última regeneración.
- Sin acceso directo desde Data API: RLS activado, sin políticas, sin permisos para anon/authenticated.

2. Cambios a `attendances`
- `activity_id`: taller al que pertenece la sesión.
- `credits_granted`: snapshot de los sellos otorgados (no cambia al editar la sesión después).
- `method`: 'qr' o 'codigo_manual'.
- `reservation_id`: reservación que respaldó el check-in (trazabilidad).
- `recorded_by` pasa a ser opcional (la asistencia la registra el propio aspirante vía RPC).
- Se conservan las 3 asistencias demo existentes: se les asigna activity_id y credits_granted.

3. Cambios a `editions`
- `checkin_open_before_minutes`: minutos antes del final para abrir el check-in (default 5).
- `checkin_close_after_minutes`: minutos después del final para cerrar (default 20).

4. Cambios a `rank_levels`
- `required_attendances` ahora representa sellos/créditos acumulados (no número de talleres).
- Los niveles existentes (0/1/2/3/4) ya coinciden con sellos para sesiones de 1 crédito.
- No se renombra la columna para no romper migraciones existentes; el significado cambia a sellos.

5. Funciones nuevas
- `generate_manual_code()`: código aleatorio de 6 caracteres sin letras confusas.
- `ensure_session_credential(p_session)`: crea credencial si no existe (trigger).
- `check_in(p_credential)`: única función de validación del aspirante (QR o código).
- `my_attendance_summary()`: progreso del aspirante para el Pasaporte.
- `session_checkin_overview()`: lista de sesiones con conteos para Coordinación/Staff.
- `session_credential_display(p_session)`: devuelve QR token + código para mostrar.
- `regenerate_session_credential(p_session, p_reason)`: regenera credencial (solo Coordinación).

6. Funciones modificadas
- `my_progress()`: ahora cuenta sellos (sum de credits_granted) y talleres asistidos por separado.
- `purge_demo_data()`: limpia también session_credentials de sesiones demo.

7. Seguridad
- `session_credentials`: RLS, sin políticas, sin permisos para anon/authenticated.
- `attendances`: se revoca SELECT directo a authenticated (defensa en profundidad como reservations).
- Todas las funciones nuevas siguen el patrón SECURITY DEFINER + search_path público.
- Las internas se revocan de PUBLIC/anon/authenticated.
- Las del aspirante se conceden a authenticated.
- Las de Coordinación/Staff validan rol internamente.
*/