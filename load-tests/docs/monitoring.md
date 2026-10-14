# Métricas que deben monitorearse

Todos los relojes y anotaciones del ensayo deben registrarse en UTC para correlacionar k6 con proveedores.

## Supabase

- Auth: solicitudes al token endpoint, éxitos, 4xx, 429, 5xx y latencia. Confirmar límites por IP/proyecto antes del ensayo.
- Database: CPU, memoria, conexiones activas/máximas, pooler, IOPS, latencia de disco, tamaño/espera de locks, deadlocks, transacciones,
  consultas lentas y p95/p99 de las RPC críticas.
- PostgREST/API: RPS, latencia y códigos 4xx/5xx, separados por RPC cuando el panel lo permita.
- Edge Functions: invocaciones, duración p95/p99, errores, cold starts y consumo de `student-access`.
- Realtime: conexiones concurrentes, canales, joins/rechazos, mensajes por segundo, lag, desconexiones, límites del tenant y uso de WAL.
- Logs: filtrar por la ventana de la corrida; no exportar JWT, emails ni payloads sensibles al reporte.

Consultas útiles durante el ensayo aislado (solo lectura): `pg_stat_activity`, `pg_stat_database`, `pg_locks` y, si está habilitado,
`pg_stat_statements`. Guardar instantáneas antes, durante el pico y después; no habilitar extensiones o cambiar configuración durante la
corrida de medición.

## Netlify y HubSpot

- Netlify: requests, ancho de banda, 4xx/5xx, tiempo de respuesta, hit ratio/edad de caché y errores de deploy/function si aplican.
- HubSpot / dominio institucional: disponibilidad, TTFB, tiempo total, 4xx/5xx y que el HTML conserve el iframe esperado.
- DNS/CDN/TLS: errores de resolución o handshake desde la ubicación del runner.

La carga a estos proveedores se limita a 5 VU salvo que `LOADTEST_THIRD_PARTY_AUTHORIZATION` contenga la referencia de autorización
escrita. La variable no sustituye la autorización: deja evidencia operativa de que fue verificada.

## Generador k6

- CPU, memoria, GC, ancho de banda, descriptores/sockets, `dropped_iterations` y `vus_max`.
- Sincronización horaria y pérdida/latencia de red del runner.
- Si hay saturación local, el resultado no demuestra saturación del sistema bajo prueba.

## Parada y evidencia

k6 aborta por fallas sostenidas de infraestructura, p99 extremo o cualquier violación de integridad. Tras una corrida con escrituras:

1. ejecutar `tools/verify-integrity.sql`;
2. guardar summary JSON, salida SQL y capturas/exportaciones de los paneles;
3. ejecutar `data/reset-run.sql` antes de repetir;
4. al terminar la campaña, ejecutar `data/cleanup.sql` y verificar que no queden cuentas/talleres `LT`.
