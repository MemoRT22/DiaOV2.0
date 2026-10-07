/**
 * The event happens in Cancún (UTC−5, no daylight saving). Times shown to staff must not depend on the device's time zone:
 * a 10:00 session is 10:00 for everyone, wherever the browser is configured.
 */
export const EVENT_TIME_ZONE = 'America/Cancun';

const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: EVENT_TIME_ZONE });
const time = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: EVENT_TIME_ZONE });

/** «15 oct 2026, 10:00 a.m.» in event time. */
export const formatEventDateTime = (value: string) => dateTime.format(new Date(value));
/** «10:30 a.m.» in event time. */
export const formatEventTime = (value: string) => time.format(new Date(value));
