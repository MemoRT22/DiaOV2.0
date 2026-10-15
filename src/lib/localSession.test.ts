import { GoTrueClient } from '@supabase/auth-js';
import { expect, test, vi } from 'vitest';
import { authStorageKey, clearLocalSession } from './localSession';

const KEY = authStorageKey('https://abc.supabase.co');
const stored = () => JSON.stringify({ access_token: 'a.b.c', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'u1', aud: 'authenticated', app_metadata: { kind: 'participant' }, user_metadata: {}, created_at: '2026-01-01' } });
const client = () => new GoTrueClient({ url: 'https://abc.supabase.co/auth/v1', storageKey: KEY, storage: localStorage, autoRefreshToken: false, persistSession: true, headers: {}, fetch: async () => { throw new TypeError('Failed to fetch'); } });

test('the storage key is the one supabase-js uses for the project (and only that one)', () => {
  expect(KEY).toBe('sb-abc-auth-token');
  expect(authStorageKey('http://localhost:54321')).toBe('sb-localhost-auth-token');
});

test('real client: with the server unreachable, signOut keeps the session; after the local clean-up a reloaded client is anonymous', async () => {
  localStorage.clear();
  localStorage.setItem(KEY, stored());
  localStorage.setItem('sb-other-auth-token', stored());
  const before = client();
  expect((await before.getSession()).data.session?.user.id).toBe('u1');
  expect((await before.signOut()).error).not.toBeNull(); // the failure this PR is about: session still there
  expect((await client().getSession()).data.session).not.toBeNull();
  expect(clearLocalSession(KEY)).toBe(true);
  expect((await client().getSession()).data.session).toBeNull(); // «reload»: nothing comes back
  expect(localStorage.getItem('sb-other-auth-token')).not.toBeNull();
});

test('it reports failure whenever the removal cannot be proven', () => {
  const stubborn = { getItem: vi.fn(() => 'still here'), removeItem: vi.fn() };
  expect(clearLocalSession(KEY, stubborn)).toBe(false);
  expect(clearLocalSession(KEY, { getItem: () => null, removeItem: () => { throw new Error('denied'); } })).toBe(false);
});
