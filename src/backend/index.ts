import { config } from '../config';
import type { Backend } from './types';

export type { Backend, NewIssueDraft, Snapshot } from './types';

/** Picks the backend for this deployment. Supabase is loaded only in live mode. */
export async function createBackend(): Promise<Backend> {
  if (config.mode === 'live') {
    const { createSupabaseBackend } = await import('./supabase');
    return createSupabaseBackend(config);
  }
  const { DemoBackend } = await import('./demo');
  return new DemoBackend();
}
