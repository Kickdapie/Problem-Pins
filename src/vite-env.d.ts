/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'demo' | 'live';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DISTRICT_ID?: string;
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_NOTIFICATIONS?: 'on' | 'off';
  readonly VITE_RESIDENT_ACCOUNTS?: 'on' | 'off';
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
