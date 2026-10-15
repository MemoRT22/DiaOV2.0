import { afterEach, expect, test, vi } from 'vitest';
import { friendlyError } from './errors';

afterEach(() => vi.restoreAllMocks());

test('the diagnostic log carries the kind of failure but never the raw error (request bodies, emails, free text)', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const cause = Object.assign(new Error('boom ana@example.com'), { name: 'TypeError', code: 'PGRST301', status: 401, body: '{"p_credential":"SECRET"}' });
  friendlyError(cause);
  const printed = JSON.stringify(log.mock.calls);
  expect(printed).toContain('PGRST301');
  expect(printed).not.toMatch(/SECRET|ana@example\.com|boom/);
});
test('a code-like message is logged so an unmapped business error can be found', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  friendlyError({ message: 'SOMETHING_NEW' });
  expect(JSON.stringify(log.mock.calls)).toContain('SOMETHING_NEW');
});
