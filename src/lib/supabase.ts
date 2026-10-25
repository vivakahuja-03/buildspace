import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined, key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/** null when the env vars are empty: the app then runs in local demo mode. Only the public anon key is ever used in the browser. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const isSupabaseConfigured = supabase !== null;
