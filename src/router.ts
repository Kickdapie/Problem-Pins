import { useEffect, useState } from 'react';

// Hash routing (`#/i/PP-2402`), so any static host works without rewrites.
// Printed QR codes use a short path instead (`/q/Q-12`), turned into `#/scan/Q-12?src=qr`
// here; the host must serve index.html for `/q/*` (see docs/ARCHITECTURE.md).
if (typeof window !== 'undefined') {
  const short = window.location.pathname.match(/^\/q\/([\w-]+)\/?$/);
  if (short) {
    window.history.replaceState(null, '', `/${window.location.search}#/scan/${short[1]}?src=qr`);
  }
}

function current() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  return { path, query: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => {
      setRoute(current());
      window.scrollTo(0, 0);
      document.getElementById('resident-scroll')?.scrollTo(0, 0);
      document.getElementById('org-scroll')?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}
