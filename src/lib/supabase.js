import { createClient } from '@supabase/supabase-js';
import { config } from './config';

// The app never signs users in with Supabase Auth. Participants hold a random
// seat token and presenters hold a short-lived admin token; both are checked by
// database functions. So no auth session is stored by the client library.
export const supabase = config.isConfigured
  ? createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;
