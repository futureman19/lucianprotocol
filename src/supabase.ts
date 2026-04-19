import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './types';

export type LuxSupabaseClient = SupabaseClient<Database>;

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export function createServiceSupabaseClient(): LuxSupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!isPresent(url) || !isPresent(serviceKey)) {
    return null;
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

export function createBrowserSupabaseClient(
  url: string,
  anonKey: string,
): LuxSupabaseClient {
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

