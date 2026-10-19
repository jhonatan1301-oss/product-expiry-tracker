export const APP_PIN = process.env.NEXT_PUBLIC_APP_PIN || '6985';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? require('@supabase/supabase-js').createClient(supabaseUrl, supabaseAnonKey)
    : null;
