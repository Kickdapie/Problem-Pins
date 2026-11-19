import { useEffect, useState, type ReactNode } from 'react';
import {
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Menu,
  QrCode,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from '../components/ui';
import { navigate } from '../router';
import { useStore } from '../store';
import SettingsDialog from './Settings';

export type OrgSection = 'overview' | 'issues' | 'map' | 'reports' | 'qr';

/**
 * Dashboard frame: a sidebar from `md` up, a compact top bar with a slide-in menu on phones.
 */
export default function OrgShell({ active, children }: { active: OrgSection; children: ReactNode }) {
  const { district, staff, signOut, toast } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Close the phone menu whenever the page changes.
  useEffect(() => setMenuOpen(false), [active]);

  const initials = (staff?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  // One entry per page. What waits on the City is a tab of Issues, reached from the Overview's figure too.
  const items: { id: OrgSection; label: string; Icon: LucideIcon; to: string }[] = [
    { id: 'overview', label: 'Overview', Icon: LayoutGrid, to: '/org' },
    { id: 'issues', label: 'Issues', Icon: Inbox, to: '/org/issues' },
    { id: 'map', label: 'Map', Icon: MapIcon, to: '/org/map' },
    { id: 'reports', label: 'Reports', Icon: FileText, to: '/org/reports' },
    { id: 'qr', label: 'QR posters', Icon: QrCode, to: '/org/qr' },
  ];
  const current = items.find((i) => i.id === active);

  const go = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };

  const nav = (
    <nav className="space-y-0.5">
      {items.map(({ id, label, Icon, to }) => (
        <button
          key={id}
          onClick={() => go(to)}
          aria-current={active === id ? 'page' : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm md:py-2 ${
            active === id ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          <Icon className="h-4 w-4" />
          <span className="flex-1 text-left">{label}</span>
        </button>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-3">
      <button
        onClick={() => {
          setMenuOpen(false);
          setSettingsOpen(true);
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-white/5 hover:text-white"
      >
        <SlidersHorizontal className="h-4 w-4" /> Settings
      </button>
      <div className="flex items-center gap-3 border-t border-white/10 px-1 pt-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{staff?.name ?? 'Not signed in'}</p>
          {/* A title like "Community Coordinator" is wider than the column: let it wrap instead of cutting it. */}
          <p className="text-xs leading-tight text-slate-400">{staff?.role ?? ''}</p>
        </div>
        <button
          onClick={async () => {
            setMenuOpen(false);
            if (await signOut()) toast('Signed out');
          }}
          title="Sign out"
          aria-label="Sign out"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Phone: compact top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 bg-sidebar px-3 text-white [--focus-ring:white] md:hidden print:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current?.label ?? 'Dashboard'}</span>
        <span className="truncate text-xs text-slate-400">{district.name}</span>
      </header>

      {/* Phone: slide-in menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[1500] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(280px,85vw)] flex-col bg-sidebar px-4 py-4 text-slate-300 [--focus-ring:white]">
            <div className="flex items-center justify-between px-1">
              <Logo dark size="sm" />
              <button autoFocus onClick={() => setMenuOpen(false)} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 mt-3 px-1 text-xs text-slate-400">{district.name}</p>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-[232px] shrink-0 flex-col bg-sidebar px-4 py-5 text-slate-300 [--focus-ring:white] md:flex print:hidden">
        <div className="px-1">
          <Logo dark />
        </div>
        <p className="mb-3 mt-3 px-1 text-xs text-slate-400">{district.name}</p>
        {nav}
        {footer}
      </aside>

      <main id="org-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-50">{children}</main>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
