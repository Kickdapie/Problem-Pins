/** Prefilled on the demo sign-in screen; the demo accepts any email. */
export const DEMO_STAFF_EMAIL = 'demo@example.org';

/** Where to go after signing in. Only dashboard paths are honoured, anything else goes to the overview. */
export function safeNext(next: string | null | undefined) {
  if (!next) return '/org';
  const path = next.startsWith('#') ? next.slice(1) : next;
  if (!/^\/org(\/|\?|$)/.test(path) || path.startsWith('/org/login')) return '/org';
  return path;
}

/** The login route for a signed-out visitor on `current` (a hash path such as `/org/issues?tab=hidden`). */
export function loginPath(current: string) {
  return `/org/login?next=${encodeURIComponent(safeNext(current))}`;
}
