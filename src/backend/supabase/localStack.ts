import { execFileSync } from 'node:child_process';

/** The local Supabase stack (`supabase start`), for the integration tests. */
export interface LocalStack {
  url: string;
  anonKey: string;
  serviceKey: string;
  /** The mail catcher (Mailpit) that receives Auth's emails. */
  mailUrl: string;
}

function status(): Record<string, string> {
  const out = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
  return Object.fromEntries(
    out
      .split('\n')
      .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

/**
 * Finds the running local stack, or null (the tests then skip). `supabase status` sometimes prints
 * nothing when two test files ask at the same moment, so it is asked up to three times.
 */
export async function localStack(): Promise<LocalStack | null> {
  if (process.env.SKIP_SUPABASE_TESTS) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const env = status();
      if (env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY) {
        const health = await fetch(`${env.API_URL}/auth/v1/health`, { headers: { apikey: env.ANON_KEY } });
        if (!health.ok) return null;
        return { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY, mailUrl: env.MAILPIT_URL || env.INBUCKET_URL || '' };
      }
    } catch {
      /* not running, or a clash with another caller: try again */
    }
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
  }
  return null;
}
