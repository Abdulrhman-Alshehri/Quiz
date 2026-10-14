// Public client configuration, read at build time from .env.production / .env.local.
const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '',
).trim();

export const config = {
  supabaseUrl: url,
  supabaseKey: key,
  isConfigured: /^https:\/\/[^/]+\.[^/]+/.test(url) && key.length > 20 && !url.includes('YOUR-PROJECT-REF'),
};
