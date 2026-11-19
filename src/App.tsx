import { Component, lazy, Suspense, useDeferredValue, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { navigate, useRoute } from './router';
import { useStore } from './store';
import { Toast } from './components/ui';
import ResidentShell from './resident/ResidentShell';
// The QR scan landing ships in the entry chunk: it is the one screen that must appear without a
// second round trip. Everything it imports therefore lands in every route's download, so keep it lean.
import ScanLanding from './resident/ScanLanding';
import type { OrgSection } from './org/OrgShell';

/*
 * Every other screen is its own chunk, so a QR scan downloads the scan page and nothing else: no
 * staff app, no Leaflet, no `qrcode`. The route's chunk starts downloading before the store has loaded
 * (`preloadRoute`, called from main.tsx), and likely next screens are fetched once the page is up.
 * See "Code splitting" in docs/ARCHITECTURE.md for what may be imported from here.
 */

/** A screen's code didn't download: offline, or a deploy since this tab opened replaced it. */
class ChunkLoadError extends Error {}

/**
 * A lazy screen whose chunk can be fetched ahead of rendering. React reuses the same promise. A
 * failed download is forgotten, so a failed prefetch is tried again when the screen is opened.
 */
function screen<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let promise: Promise<{ default: T }> | undefined;
  const preload = () =>
    (promise ??= load().catch((error: unknown) => {
      promise = undefined;
      throw new ChunkLoadError(String(error));
    }));
  return Object.assign(lazy(preload), { preload });
}

// Resident screens.
const IssueDetail = screen(() => import('./resident/IssueDetail'));
const MapHome = screen(() => import('./resident/MapHome'));
const NewPin = screen(() => import('./resident/NewPin'));
const Updates = screen(() => import('./resident/Updates'));
const About = screen(() => import('./resident/About'));
const Account = screen(() => import('./resident/Account'));

// Staff screens. Nothing on a resident route imports these.
const RequireStaff = screen(() => import('./org/RequireStaff'));
const OrgShell = screen(() => import('./org/OrgShell'));
const Overview = screen(() => import('./org/Overview'));
const Issues = screen(() => import('./org/Issues'));
const OrgMap = screen(() => import('./org/OrgMap'));
const Reports = screen(() => import('./org/Reports'));
const Experiments = screen(() => import('./org/Experiments'));
const QrPosters = screen(() => import('./org/QrPosters'));
const Login = screen(() => import('./org/Login'));

const STAFF = [RequireStaff, OrgShell, Overview, Issues, OrgMap, Reports, Experiments, QrPosters];

type Screen = { preload: () => Promise<unknown> };

function segments(path: string) {
  return path.split('/').filter(Boolean);
}

/** The chunks a route renders. */
function screensFor(path: string): Screen[] {
  const seg = segments(path);
  if (seg[0] === 'org') {
    if (seg[1] === 'login') return [Login];
    const page = { issues: Issues, sent: Issues, map: OrgMap, reports: Reports, experiments: Experiments, qr: QrPosters }[seg[1] ?? ''];
    return [RequireStaff, OrgShell, page ?? Overview];
  }
  if (seg[0] === 'scan') return [];
  const page = { i: IssueDetail, new: NewPin, updates: Updates, about: About, account: Account }[seg[0] ?? ''];
  return [page ?? MapHome];
}

/**
 * Where people usually go next. Residents are often on mobile data, so Leaflet (MapHome, NewPin) is
 * fetched ahead only from the map, which already has it.
 */
function likelyNext(path: string): Screen[] {
  const seg = segments(path);
  if (seg[0] === 'org') return STAFF; // staff are on desktop connections: fetch the whole app
  if (seg[0] === 'scan') return [IssueDetail];
  if (seg[0] === undefined) return [IssueDetail, NewPin];
  return [];
}

/** Starts downloading a route's chunks. Called once at startup, before the store has loaded. */
export function preloadRoute(hash = window.location.hash) {
  const path = hash.replace(/^#/, '').split('?')[0] || '/';
  for (const s of screensFor(path)) s.preload().catch(() => {});
}

function whenIdle(run: () => void) {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1000);
  return () => clearTimeout(id);
}

// After the first screen has painted, a pending screen shows "Loading…" only if it takes a while.
let firstScreenShown = false;

/** Rendered beside a screen, so its effect runs only once the screen itself is on the page. */
function Prefetch({ path }: { path: string }) {
  useEffect(() => {
    firstScreenShown = true;
    // Not on Save-Data or a 2G-class connection (Chrome/Android report these; Safari doesn't).
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType ?? '')) return;
    return whenIdle(() => likelyNext(path).forEach((s) => s.preload().catch(() => {})));
  }, [path]);
  return null;
}

/** The Suspense fallback: the startup screen's quiet "Loading…", held back on fast loads. */
function Pending({ full }: { full?: boolean }) {
  const [show, setShow] = useState(!firstScreenShown);
  useEffect(() => {
    if (show) return;
    const t = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(t);
  }, [show]);
  return (
    <div className={`grid h-full place-items-center p-6 text-center ${full ? 'bg-slate-100' : ''}`}>
      <p className="text-sm text-slate-500" role="status">
        {show ? 'Loading…' : ''}
      </p>
    </div>
  );
}

/**
 * Reloads once per tab when a screen's chunk fails while online: after a deploy, the new
 * index.html points at the new chunks. Offline, a reload would only show the browser's error page.
 */
function reloadOnce() {
  if (!navigator.onLine) return false;
  try {
    if (sessionStorage.getItem('pp-chunk-reload')) return false;
    sessionStorage.setItem('pp-chunk-reload', '1');
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Catches a screen whose code didn't download, until the route changes. Other errors pass through. */
class ChunkError extends Component<{ path: string; children: ReactNode }, { error: unknown; reloading: boolean }> {
  state = { error: null as unknown, reloading: false };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.error && !this.state.reloading) this.setState({ error: null });
  }
  componentDidCatch(error: unknown) {
    if (error instanceof ChunkLoadError && reloadOnce()) this.setState({ reloading: true });
  }
  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (!(error instanceof ChunkLoadError)) throw error;
    if (reloading) return null;
    return (
      <div className="grid h-full place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-sm">
          <p className="font-semibold">Problem Pins couldn’t load.</p>
          <p className="mt-1 text-sm text-slate-600">This page didn’t load. Check your connection and try again.</p>
          <button onClick={() => window.location.reload()} className="mt-4 font-semibold text-brand">
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/** Demo mode only: switch between the two apps and restore the sample data. */
function DemoBar({ org }: { org: boolean }) {
  const { reset, toast } = useStore();
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-medium transition ${active ? 'bg-white text-ink shadow-sm' : 'text-slate-300 hover:text-white'}`;
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-3 bg-[#0b1020] px-4 text-xs text-slate-300 [--focus-ring:white] print:hidden">
      <span className="hidden sm:inline">
        <span className="font-semibold text-white">Problem Pins</span> · clickable prototype · sample data, West Chelsea
      </span>
      <div className="flex rounded-lg bg-white/10 p-0.5">
        <button className={tab(!org)} onClick={() => navigate('/')}>
          Resident
        </button>
        <button className={tab(org)} onClick={() => navigate('/org')}>
          District office
        </button>
      </div>
      <button
        className="flex items-center gap-1.5 text-slate-300 hover:text-white"
        onClick={async () => {
          if (await reset()) toast('Demo data reset');
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reset demo
      </button>
    </div>
  );
}

export default function App() {
  // Deferred, so moving to a screen whose chunk is still downloading keeps the current screen up
  // instead of blanking it. The first render isn't deferred and shows <Pending>.
  const { path, query } = useDeferredValue(useRoute());
  const { mode } = useStore();
  const seg = segments(path);
  const isOrg = seg[0] === 'org';

  let content;
  if (isOrg && seg[1] === 'login') {
    content = <Login next={query.get('next')} />;
  } else if (isOrg) {
    // `sent` is the old address of the Issues tab for what waits on the City.
    const section = (seg[1] ?? 'overview') as OrgSection | 'experiments' | 'sent';
    let page;
    switch (section) {
      case 'issues':
        page = <Issues selectedId={seg[2]} tab={query.get('tab') ?? 'inbox'} />;
        break;
      case 'sent':
        page = <Issues selectedId={seg[2]} tab="city" />;
        break;
      case 'map':
        page = <OrgMap issueId={query.get('issue')} />;
        break;
      case 'reports':
        page = <Reports month={query.get('month')} />;
        break;
      case 'experiments':
        page = <Experiments />;
        break;
      case 'qr':
        page = <QrPosters />;
        break;
      default:
        page = <Overview />;
    }
    content = (
      <RequireStaff path={path}>
        <OrgShell active={section === 'sent' ? 'issues' : section === 'experiments' ? 'reports' : section}>
          {page}
        </OrgShell>
      </RequireStaff>
    );
  } else {
    let page;
    switch (seg[0]) {
      case 'i':
        page = <IssueDetail id={seg[1]} />;
        break;
      case 'new':
        page = <NewPin category={query.get('cat')} from={query.get('from')} />;
        break;
      case 'scan':
        page = <ScanLanding code={seg[1] ?? ''} source={query.get('src')} />;
        break;
      case 'updates':
        page = <Updates />;
        break;
      case 'about':
        page = <About />;
        break;
      case 'account':
        page = <Account next={query.get('next')} from={query.get('from')} />;
        break;
      default:
        page = <MapHome focus={query.get('focus')} />;
    }
    content = (
      <ResidentShell>
        <Suspense fallback={<Pending />}>
          {page}
          <Prefetch path={path} />
        </Suspense>
      </ResidentShell>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {mode === 'demo' && <DemoBar org={isOrg} />}
      <div className="min-h-0 flex-1">
        <ChunkError path={path}>
          {isOrg ? (
            <Suspense fallback={<Pending full />}>
              {content}
              <Prefetch path={path} />
            </Suspense>
          ) : (
            content
          )}
        </ChunkError>
      </div>
      <Toast />
    </div>
  );
}
