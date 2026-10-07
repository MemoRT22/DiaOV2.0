import { afterEach, expect, test, vi } from 'vitest';
import { workshopAdminApi } from './workshopAdminApi';

vi.mock('./supabase', () => ({
  functionsUrl: 'https://example.test/functions/v1',
  supabaseAnonKey: 'public-key',
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}));

afterEach(() => vi.unstubAllGlobals());

test('new approval sends approve_publish to the Edge function', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    submission_id: '11111111-1111-4111-8111-111111111111',
    status: 'published', activity_id: 'activity-1', session_count: 4,
    career_count: 1, division_count: 1, credential_created: true,
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await workshopAdminApi.approve('11111111-1111-4111-8111-111111111111');
  expect(result.status).toBe('published');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://example.test/functions/v1/workshop-admin');
  expect(JSON.parse(options.body as string)).toEqual({
    action: 'approve_publish', submission_id: '11111111-1111-4111-8111-111111111111',
  });
});
