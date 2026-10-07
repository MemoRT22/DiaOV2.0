import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from './fetchWithTimeout';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, { global: { fetch: fetchWithTimeout } });

export const functionsUrl = `${url}/functions/v1`;
export const supabaseAnonKey = anonKey;
