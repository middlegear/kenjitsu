import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isDatabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey);


export const supabase: SupabaseClient | null = isDatabaseEnabled ? createClient(supabaseUrl!, supabaseAnonKey!) : null;
