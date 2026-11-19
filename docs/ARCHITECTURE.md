# Architecture and module plan

How the prototype is put together, the contracts the parallel modules build against, and who
owns which files. Read this before changing anything shared. The phases and team decisions live
in the GitHub issues (Kickdapie/Problem-Pins #1 roadmap, #2 checklist).

## Layers

```
screens (src/resident, src/org)
   │  useStore()
   ▼
store (src/store.tsx)          holds the latest Snapshot, loads what changed after every
   │  Backend interface         mutation and change ping, turns errors into toasts,
   │                            tracks analytics for actions
   ▼
src/backend/types.ts  ◄── the contract
   ├── demo.ts                  sample data in localStorage, date frozen at 2026-10-14
   └── supabase/                shared Postgres + Auth + Storage + Realtime (live mode)
```

Screens never call a backend directly. Everything goes through `useStore()`. Store actions return
`Promise<boolean>` (true = saved) and never throw, so a screen can do
`if (await assign(id, team)) toast('Assigned')`.

## Modes

| | demo | live |
|---|---|---|
| Data | `src/data/sampleData.ts`, saved in this browser | Supabase, shared by everyone |
| Date | frozen at `DEMO_TODAY` (2026-10-14) | today in New York |
| Staff | any email signs in as Maya Ruiz | real Supabase Auth accounts |
| Resident accounts (optional) | on; the code is shown on screen, no email is sent | off unless `VITE_RESIDENT_ACCOUNTS=on`; codes come by email |
| Demo bar, SAMPLE DATA badge | shown | hidden |

`src/config.ts` picks the mode: live when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set,
otherwise demo. `?mode=demo` in the URL (before the `#`) forces the demo on any deployment, for
presentations. Two demo tabs stay in sync through `storage` events.

## Conventions

- **Dates** in the domain model are New York calendar dates, `YYYY-MM-DD`. Use `today()`,
  `daysBetween()`, `nyDate()` from `src/lib/format.ts`; never `new Date()` for display logic.
  Analytics events carry full ISO timestamps (`at`).
- **IDs**: the backend generates issue IDs (`PP-2461`, ...). Scan point codes (`Q-12`) are printed
  on posters, so they are never reused.
- **Counts** (`votes`, `votesThisWeek`, `following`, `confirmedFixed`, `duplicatesMerged`) are derived
  by the backend from records. The UI only shows them.
- **Errors**: backends reject with an `Error` whose message is safe to show to a resident.
- **Large districts** (thousands of issues, many residents at once): the store loads one snapshot,
  then only what changed (`loadChanges`), and keeps the objects of issues that didn't change. So
  `store.issues`, `store.hiddenIssues` and each issue keep their identity until they change:
  memoize derived lists on them (`useMemo`), and make list rows and map markers `memo` components
  that take the issue and plain values, not `useStore()`. Pass them one stable callback
  (`useLatest` in `src/lib/`), since store actions are new functions after every change. Long lists
  render a page at a time with `useProgressive` (MapHome, Issues); the map draws every match.
  Optimistic changes (+1, follow) are functions of the snapshot (`optimisticVote`,
  `optimisticFollow` in `src/backend/changes.ts`) that the store applies again to every snapshot
  arriving before their mutation is answered; they decide by `me`, so they never count twice.
- **Hidden and merged issues**: `store.issues` excludes them; `store.hiddenIssues` (staff) has them;
  `store.getIssue(id)` finds any issue the viewer may see, so old links to a merged pin redirect.
- **Privacy**: no personal data in analytics events. Follow contacts (email/phone) are stored but
  never returned by `load()`. A resident account's email is returned only to that resident
  (`me.account`), never to neighbors or staff. Photos are re-encoded through a canvas, which strips
  EXIF/GPS.
- **District**: everything district-specific (name, area, boundary, teams, attention rules,
  categories) comes from `store.district`. Don't hard-code "West Side District" or "West Chelsea".
- **Analytics**: the store tracks resident and staff actions centrally. Screens only track views
  (`map_view`, `scan_view`, `issue_view`, `pin_start`). Event names are a union in `types.ts`.
- **Routing** is hash-based (`#/i/PP-2402`). Printed QR codes use a short path (`/q/Q-12`), which
  `src/router.ts` rewrites to `#/scan/Q-12?src=qr`; the host must serve `index.html` for `/q/*`.
- **Code splitting** keeps the QR scan fast on mobile data. `src/App.tsx` loads every screen with
  `React.lazy` except `resident/ScanLanding`, which ships in the entry chunk with the store, router,
  `components/ui` and `resident/shared`. So anything those files import is downloaded on every QR
  scan: never import Leaflet/`IssueMap`, `qrcode`/`lib/qr`, `components/Poster` or anything in
  `src/org/` from them, and keep new dependencies out of them. `src/org/*` is never imported from
  `src/resident/*`. Load heavy libraries where they're used (`lib/qr.ts` imports `qrcode` on first
  use). A new route goes in `screensFor` in `App.tsx`, so its chunk starts downloading at startup.
  Check with `npm run build`: the `index-*.js` chunk is about 78 kB gzip. If a screen's chunk fails
  to download (offline, or a deploy replaced it), the page reloads once per tab while online, then
  shows "couldn't load" with Try again; a failed background prefetch does nothing.
- **Caching**: files under `/assets/` have content hashes and are cached for a year
  (`vercel.json`, `public/_headers`); `index.html` is not.

## Visual rules

Every screen follows these. The shared classes are in `src/components/ui.tsx` (`labelClass`,
`linkClass`, `fieldClass`) and `src/resident/shared.tsx` (`LABEL`, `LINK`, `BUTTON`).

- **Type.** Inter for everything. Mono only for issue IDs, 311 SR numbers, poster codes and URLs.
  No uppercase, letter-spaced labels: a section label is `text-xs font-medium text-slate-500` in
  sentence case. Nothing below 12px.
- **Color means status.** The five status colors in `src/data/meta.ts` are the only data colors.
  A category is an icon and a label, never a color.
- **Orange means "act here".** The one primary button of a view, text saying something waits on
  the reader, and the Open status. Not for plain links, selected rows or decoration.
- **Say it once, in words.** No grids of stat tiles inside small cards; a number appears once per
  screen; at most three " · " facts in a row, each understandable alone.
- **At most one tinted surface per screen**, only where the tint carries meaning (a status card,
  the to-do banner).
- **No placeholder art.** A missing photo shows nothing, or a flat grey thumbnail.
- **Readable and reachable.** No `text-slate-400` for text that must be read; every control works
  from the keyboard and shows the focus ring from `src/index.css`.
- **Copy** is plain and true: sentence case, no exclamation marks, "+1" and "neighbors" (never
  "votes"); residents report "problems", staff handle "issues"; the office is the district's name
  or "the district office". No screen promises a text or email while `config.notifications` is off.
- **Accounts stay optional.** Scan → +1 and pinning never ask for an email. The account is offered
  only after something is saved and only as a plain link (never orange, never a banner or a modal):
  on the You page, in a new pin's "Your pin is live" card, and in About. Never on the scan landing
  or an issue page, where the +1 happens. The words are "Keep … with your email" and "Sign in",
  never "Sign up", "Create an account" or "Register", and every offer says what it is for (a new
  phone, a cleared browser). Screens say where problems are kept: "on this phone" or "in your
  account". The account's code email is the only email it sends, so it promises nothing else.

## Routes

| Route | Screen | Owner |
|---|---|---|
| `#/` | `resident/MapHome` | location |
| `#/i/:id` | `resident/IssueDetail` | (shared, wave 2: notifications) |
| `#/new?cat=&from=` | `resident/NewPin` | location |
| `#/scan/:code?src=` | `resident/ScanLanding` | qr-analytics |
| `#/updates` | `resident/Updates` | (shared, wave 2: notifications) |
| `#/about` | `resident/About`: who runs it, what happens to a pin, what is public | (shared) |
| `#/account?next=&from=` | `resident/Account`: optional resident account. Signed out: email, then a 6-digit code (the demo shows it; "Use it" signs in), then back to `next` (resident paths only, default `/updates`). Signed in: the email, what is saved, how another phone works, who sees the email, Sign out and Delete account (confirmed in place). `from` is the analytics source (`updates`, `new_pin`, `about`, `demo`). Hidden behind `residentAccounts` in `src/config.ts` | (shared) |
| `#/org` `#/org/issues/:id?tab=` `#/org/map` | `org/*`. `#/org/sent` is the old address of `#/org/issues?tab=city` and still opens it | staff-app |
| `#/org/reports?month=` | `org/Reports` | qr-analytics |
| `#/org/experiments` | `org/Experiments`: the Problem Pins team's experiment results. Not in the sidebar; Reports links to it in demo mode only | qr-analytics |
| `#/org/qr` | `org/QrPosters` | qr-analytics |
| `#/org/login?next=` | `org/Login` | staff-app |

All `#/org/*` routes except login are wrapped in `org/RequireStaff` (staff-app).

## Modules and file ownership

Wave 1 runs in parallel, one git worktree and branch per module, all cut from `live-prototype`.
A module only edits the files it owns. If it truly needs a change in a shared file, it keeps the
change small and additive and lists it in its final report.

| Module | Owns | Dev server |
|---|---|---|
| **backend** (Supabase) | `supabase/**`, `src/backend/supabase/**`, `scripts/` seed tooling, `docs/BACKEND.md` | `pp-backend` :5181, local Supabase :54321 |
| **staff-app** | `src/org/**` except `Reports.tsx` and `QrPosters.tsx` | `pp-staff` :5182 |
| **location** | `src/resident/MapHome.tsx`, `src/resident/NewPin.tsx`, `src/components/IssueMap.tsx`, `src/data/geo.ts`, `src/data/demoDistrict.ts`, new `src/lib/` location/geocoding/geometry files | `pp-location` :5183 |
| **qr-analytics** | `src/org/QrPosters.tsx`, `src/org/Reports.tsx`, `src/resident/ScanLanding.tsx`, new `src/lib/` QR/metrics/CSV files, demo event seed, short-link host config (`vercel.json`, `public/_redirects`) | `pp-qr` :5184 |

Shared files (the contract; additive changes only, mentioned in the report):
`src/data/types.ts`, `src/backend/types.ts`, `src/backend/demo.ts`, `src/store.tsx`, `src/App.tsx`,
`src/router.ts`, `src/config.ts`, `src/components/ui.tsx`, `package.json`, `.env.example` (append
your own section).

Wave 2, after wave 1 is merged: email notifications (Supabase Edge Function + Resend, real "Notify
me", unsubscribe), accessibility and language access (Spanish, Chinese), deployment (hosting,
domain, staging and production Supabase projects, privacy page), spam protection (Turnstile).

## Working on a module

```
npm install
npm test            # Vitest
npm run build       # typecheck + production build
```

- Preview with your module's launch config (`.claude/launch.json`), never the default port, so
  parallel sessions don't collide.
- Commit to your module branch. Don't push: merging into `live-prototype` happens locally after review.
- Keep the demo working. Every feature must behave sensibly in demo mode without Supabase.
- Style: follow the existing look (orange `#ef5a1f`, ink `#141b2d`, mono labels for IDs and section
  headers, honest status copy). No gradients, emoji or decorative filler.
- The instructor's rule: product code is fair game, but experiment thresholds and analysis belong
  to the team. Leave them as clearly marked settings for the team to fill in, never invented numbers.

## Decisions so far

- Backend: Supabase. Residents get an anonymous Supabase identity per device (one vote per device),
  staff sign in with email and password.
- Resident accounts are optional (2026-11-16). A resident may add an email, proved with a 6-digit
  code, so their pins, +1s and follows survive a new phone or a cleared browser; one person on two
  phones then counts once. No account is ever needed to pin or +1, and the district office sees no
  account data, not even a count of "verified" neighbors: an email doesn't prove someone lives in
  the district, and showing it would make staff discount the anonymous +1s the QR experiment
  depends on. How it works: docs/BACKEND.md, "Resident accounts".
- Analytics: our own `events` table, no third-party tracker.
- Hosting, domain, map tile provider, budget: still open (see roadmap issue #1).
