import { afterEach, expect, test } from 'vitest';
import { formatEventDateTime, formatEventTime } from './eventTime';

const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

// 10:00 in Cancún (UTC−5, no DST) is 15:00 UTC.
const TEN_IN_CANCUN = '2026-10-15T15:00:00Z';
const ELEVEN_IN_CANCUN = '2026-10-15T16:00:00Z';

test.each(['America/Mexico_City', 'America/New_York', 'Europe/Madrid', 'Asia/Tokyo', 'UTC'])('10:00 Cancún is shown as 10:00 when the device is in %s', (tz) => {
  process.env.TZ = tz;
  expect(formatEventTime(TEN_IN_CANCUN)).toMatch(/^10:00/);
  expect(formatEventDateTime(TEN_IN_CANCUN)).toMatch(/15 oct.*10:00/);
  expect(formatEventTime(ELEVEN_IN_CANCUN)).toMatch(/^11:00/);
});

test('the date follows Cancún too, not the device (late evening vs next day elsewhere)', () => {
  process.env.TZ = 'Asia/Tokyo'; // 23:30 Cancún on the 15th is already the 16th in Tokyo
  expect(formatEventDateTime('2026-10-16T04:30:00Z')).toMatch(/15 oct/);
});
