-- Fase 8C test helper: temporarily disable session guard for test setup
-- This is only needed for the regression test to move session times after reservations
ALTER TABLE activity_sessions DISABLE TRIGGER activity_sessions_guard_reservations;