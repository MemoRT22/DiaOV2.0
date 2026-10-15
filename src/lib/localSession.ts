/**
 * Local end of a session when the server cannot be asked to end it. Only the keys that supabase-js itself uses for THIS project are
 * touched (`sb-<project ref>-auth-token` and its PKCE verifier): other Supabase projects served from the same origin keep theirs.
 */
export const authStorageKey = (supabaseUrl: string): string => `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

/** `true` only when, after removing them, reading the storage back proves the session is gone; any doubt is `false`. */
export function clearLocalSession(storageKey: string, storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage): boolean {
  try {
    const keys = [storageKey, `${storageKey}-code-verifier`];
    for (const key of keys) storage.removeItem(key);
    return keys.every((key) => storage.getItem(key) === null);
  } catch {
    return false;
  }
}
