# Reporte de rendimiento — Día OV 2026

## Identificación

- Fecha, hora y zona: 
- Commit / rama: 
- Entorno aislado: 
- Perfil y escala: 
- Generador (CPU, RAM, red, versión k6): 
- Dataset (usuarios, talleres, sesiones y cupos): 
- Autorizaciones de terceros aplicables: 

## Resultado ejecutivo

- Veredicto: APROBADO / CONDICIONAL / NO APROBADO
- Máxima concurrencia estable: 
- Tasa de llegada estable: 
- Primer umbral incumplido: 
- Riesgo para 2,000 asistentes: 

## Resultados por componente

| Componente | Carga | Error | p95 | p99 | Resultado |
|---|---:|---:|---:|---:|---|
| HubSpot institucional | | | | | |
| Netlify HTML | | | | | |
| Netlify assets | | | | | |
| Supabase Auth | | | | | |
| Lecturas PostgREST/RPC | | | | | |
| Reservaciones | | | | | |
| Check-in | | | | | |
| Encuesta | | | | | |
| Realtime join / mensajes / recuperación | | | | | |

## Integridad funcional

- Sobrecupos: 0 / 
- Duplicados de reservación: 0 / 
- Conflictos aceptados: 0 / 
- Personas sobre el máximo: 0 / 
- Doble asistencia o sellos: 0 / 
- Encuestas duplicadas: 0 / 
- Evidencia: salida adjunta de `tools/verify-integrity.sql`.

## Cuellos de botella

Para cada hallazgo: intervalo UTC, síntoma k6, métrica correlacionada del proveedor, causa probable, evidencia y confianza.

## Recomendaciones

| Prioridad | Recomendación | Responsable | Criterio de verificación |
|---|---|---|---|
| P0 | | | |
| P1 | | | |
| P2 | | | |

## Anexos

- Comando exacto (sin secretos):
- Summary JSON de k6:
- Logs y paneles:
- Cambios respecto a la corrida anterior:
