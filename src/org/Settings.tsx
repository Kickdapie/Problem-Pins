import type { ReactNode } from 'react';
import { labelClass } from '../components/ui';
import { CATEGORIES } from '../data/meta';
import { useStore } from '../store';
import { TODO_GROUPS } from './dashboard';
import Dialog from './Dialog';

/** District settings, read-only. For the pilot they are set up by the Problem Pins team, not edited here. */
export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { district } = useStore();
  const { rules } = district;
  const facts: [string, ReactNode][] = [
    ['Name', <span className="font-medium">{district.name}</span>],
    ['Area', district.area],
    ['Office email', district.contactEmail ?? <span className="text-slate-500">Not set</span>],
    ['Boundary', district.boundary ? 'Pins outside it are refused' : 'None, pins are accepted anywhere'],
    ['Owners', district.teams.join(', ')],
    ['Categories', district.categories.map((c) => CATEGORIES[c].label).join(', ')],
  ];

  return (
    <Dialog title="District settings" onClose={onClose}>
      <div className="text-sm">
        {/* First, because it is what someone who came here to change something needs to know. */}
        <p className="text-slate-600">These are set up with the Problem Pins team for the pilot. To change one, ask them: there’s no editor here yet.</p>

        <dl className="mt-4 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className={`${labelClass} mb-1.5`}>What goes on the to-do list</p>
          <ul className="space-y-1.5">
            {TODO_GROUPS.map((g) => (
              <li key={g.kind}>
                <p className="font-medium">{g.title}</p>
                <p className="text-slate-500">{g.rule(rules)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            In each group the longest wait comes first. How many neighbors +1’d only breaks ties; it never puts an issue on the list.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
