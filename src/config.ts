/**
 * Runtime configuration. Everything a deployment can change comes from Vite env vars
 * (see `.env.example`), plus one URL override: `?mode=demo` forces the sample-data demo.
 */
export type DataMode = 'demo' | 'live';

const env = import.meta.env;
const search = typeof window === 'undefined' ? '' : window.location.search;

const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);

function pickMode(): DataMode {
  const forced = new URLSearchParams(search).get('mode');
  const wanted = forced === 'demo' || forced === 'live' ? forced : (env.VITE_DATA_MODE ?? (hasSupabase ? 'live' : 'demo'));
  if (wanted === 'live' && !hasSupabase) {
    console.warn('Live mode needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Falling back to demo mode.');
    return 'demo';
  }
  return wanted === 'live' ? 'live' : 'demo';
}

export const config = {
  mode: pickMode(),
  supabaseUrl,
  supabaseAnonKey,
  /** Which district this deployment serves in live mode (a `districts.id`). */
  districtId: env.VITE_DISTRICT_ID ?? '',
  /** Base URL printed on QR posters and used for short links (`<publicUrl>/q/Q-12`). */
  publicUrl: (env.VITE_PUBLIC_URL || (typeof window === 'undefined' ? '' : window.location.origin)).replace(/\/$/, ''),
  /**
   * Whether following a problem really sends a text or email. Nothing sends them yet
   * (docs/BACKEND.md, wave 2), so this is off unless a deployment says otherwise. While it is
   * off, resident screens must not ask for a phone or email or promise a message: a follow is
   * kept on the device and shows on the You page.
   */
  notifications: env.VITE_NOTIFICATIONS === 'on',
  /**
   * Raster tiles, shown in grayscale by CSS. The default (Stadia Maps "Alidade Smooth") needs no key on
   * localhost only; deployments must set their own provider. See docs/MAP_TILES.md.
   */
  mapTiles: {
    url: env.VITE_MAP_TILE_URL || 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
    attribution:
      env.VITE_MAP_ATTRIBUTION ||
      '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

export const isDemo = config.mode === 'demo';

/**
 * Optional resident accounts: add an email, proved with a 6-digit code, to keep your pins, +1s and
 * follows beyond this browser. Always on in the demo (it shows the code instead of sending it).
 * Live deployments turn them on with VITE_RESIDENT_ACCOUNTS=on once the Supabase project sends
 * email through a real provider and has the code templates (docs/BACKEND.md, "Resident accounts").
 */
export const residentAccounts = isDemo || env.VITE_RESIDENT_ACCOUNTS === 'on';
