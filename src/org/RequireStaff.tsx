import { useEffect, type ReactNode } from 'react';
import { useStore } from '../store';
import { loginPath } from './auth';

/**
 * Guards the organization dashboard: signed-out visitors go to `#/org/login?next=<this page>`
 * (replacing the history entry, so Back doesn't bounce them into the guard again).
 */
export default function RequireStaff({ children }: { path: string; children: ReactNode }) {
  const { staff } = useStore();
  // Read the page during render. A repeated effect (StrictMode) or a re-render after the reload that
  // follows sign-out can run once the hash already points at the login route: don't redirect again then.
  const here = window.location.hash.slice(1) || '/org';
  useEffect(() => {
    if (!staff && !here.startsWith('/org/login')) window.location.replace(`#${loginPath(here)}`);
  }, [staff, here]);
  if (!staff) return null;
  return <>{children}</>;
}
