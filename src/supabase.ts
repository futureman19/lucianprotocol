import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Entity } from './types';

export type LuxSupabaseClient = SupabaseClient<Database>;

interface BrowserSupabaseCache {
  anonKey: string;
  client: LuxSupabaseClient;
  url: string;
}

declare global {
  interface Window {
    __luxSupabaseBrowserClient__?: BrowserSupabaseCache;
  }
}

const OPTIONAL_ENTITY_SCHEMA_KEYS = [
  'z',
  'memory',
  'ttl_ticks',
  'target_height',
  'current_height',
  'edit_count',
  'last_edit_tick',
  'ivy_coverage',
  'building_archetype',
  'importance_tier',
  'activity_level',
  'occupancy',
  'condition',
  'upgrade_level',
  'power_state',
  'network_load',
  'traffic_load',
  'construction_phase',
  'demolition_phase',
  'weather_wetness',
  'weather_snow_cover',
  'weather_fog_factor',
  'landmark_role',
  'occupancy_width',
  'occupancy_depth',
  'tether_to',
  'tether_from',
  'tether_broken',
  'last_commit_sha',
  'last_commit_message',
  'last_commit_author',
  'last_commit_date',
  'git_diff',
  'lmm_rule',
  'cargo',
  'birth_tick',
  'state_register',
  'lmmRule',
  'birthTick',
  'stateRegister',
] as const;

const LEGACY_ENTITY_SCHEMA_KEYS = [
  'lmmRule',
  'birthTick',
  'stateRegister',
] as const;

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function stripOptionalEntitySchemaFields(entity: Entity): Entity {
  const safeEntity = { ...entity } as Record<string, unknown>;

  for (const key of OPTIONAL_ENTITY_SCHEMA_KEYS) {
    delete safeEntity[key];
  }

  return safeEntity as Entity;
}

function normalizeEntityForSupabase(entity: Entity): Entity {
  const normalized = { ...entity } as Record<string, unknown>;

  for (const key of LEGACY_ENTITY_SCHEMA_KEYS) {
    delete normalized[key];
  }

  normalized.cargo = typeof normalized.cargo === 'number' ? normalized.cargo : 0;
  normalized.birth_tick = typeof normalized.birth_tick === 'number' ? normalized.birth_tick : 0;
  normalized.state_register = typeof normalized.state_register === 'number' ? normalized.state_register : 0;

  const isLmmEntity = typeof normalized.lmm_rule === 'string' && normalized.lmm_rule.length > 0;
  if (!isLmmEntity) {
    delete normalized.lmm_rule;
  }

  return normalized as Entity;
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
  const cache = typeof window !== 'undefined' ? window.__luxSupabaseBrowserClient__ : undefined;
  if (cache && cache.url === url && cache.anonKey === anonKey) {
    return cache.client;
  }

  const client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  if (typeof window !== 'undefined') {
    window.__luxSupabaseBrowserClient__ = { anonKey, client, url };
  }

  return client;
}

export async function upsertEntitiesWithSchemaFallback(
  supabase: LuxSupabaseClient,
  entities: Entity[],
): Promise<{ usedFallback: boolean }> {
  const normalizedEntities = entities.map(normalizeEntityForSupabase);
  const { error } = await supabase.from('entities').upsert(normalizedEntities, { onConflict: 'id' });

  if (!error) {
    return { usedFallback: false };
  }

  const err = error as unknown as Record<string, unknown>;
  if (err.code !== 'PGRST204') {
    throw error;
  }

  const safeEntities = normalizedEntities.map(stripOptionalEntitySchemaFields);
  const { error: retryError } = await supabase
    .from('entities')
    .upsert(safeEntities, { onConflict: 'id' });

  if (retryError) {
    throw retryError;
  }

  return { usedFallback: true };
}

