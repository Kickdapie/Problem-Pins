import { loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const DEFAULT_TILES = 'https://tiles.stadiamaps.com/';

function origin(url: string | undefined) {
  try {
    return url ? new URL(url.replace(/\{[^}]*\}/g, 'x')).origin : null;
  } catch {
    return null;
  }
}

/**
 * Startup hints for index.html, from this build's env: open the connections the app needs early,
 * and fetch the backend chunk (demo or Supabase) in parallel with the main bundle rather than after
 * it. Mirrors the mode choice in src/config.ts (`?mode=demo` on a live build still works; it only
 * wastes the Supabase preload).
 */
function startupHints(env: Record<string, string>): Plugin {
  const hasSupabase = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
  const live = (env.VITE_DATA_MODE || (hasSupabase ? 'live' : 'demo')) === 'live' && hasSupabase;
  const backend = live ? /src[\\/]backend[\\/]supabase[\\/]index\.ts$/ : /src[\\/]backend[\\/]demo\.ts$/;
  let base = '/';
  return {
    name: 'problem-pins-startup-hints',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const tags: HtmlTagDescriptor[] = [];
        const supabase = live ? origin(env.VITE_SUPABASE_URL) : null;
        // supabase-js uses CORS fetches, which need the `crossorigin` connection pool.
        if (supabase) tags.push({ tag: 'link', attrs: { rel: 'preconnect', href: supabase, crossorigin: '' }, injectTo: 'head-prepend' });
        // Map tiles are plain <img> requests. Only a DNS lookup: the scan page shows no map.
        const tiles = origin(env.VITE_MAP_TILE_URL || DEFAULT_TILES);
        if (tiles) tags.push({ tag: 'link', attrs: { rel: 'dns-prefetch', href: tiles }, injectTo: 'head' });
        const chunks = Object.values(ctx.bundle ?? {}).flatMap((c) => (c.type === 'chunk' ? [c] : []));
        const chunk = chunks.find((c) => c.facadeModuleId && backend.test(c.facadeModuleId));
        if (chunk) {
          for (const file of [chunk.fileName, ...chunk.imports]) {
            if (chunks.find((c) => c.fileName === file)?.isEntry) continue;
            tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `${base}${file}` }, injectTo: 'head' });
          }
        }
        return tags;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), startupHints(env)],
    test: {
      // Claude Code keeps per-module git worktrees under .claude/; their copies aren't this checkout's tests.
      exclude: [...configDefaults.exclude, '.claude/**'],
    },
  };
});
