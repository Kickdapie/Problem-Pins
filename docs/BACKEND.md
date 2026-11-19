# Backend (Supabase)

Live mode runs on Supabase: Postgres for the data, Auth for identities, Storage for photos and
Realtime for change pings. The browser talks to it through `src/backend/supabase/`, which
implements the `Backend` contract in `src/backend/types.ts`. The database side is in
`supabase/migrations/`.

## Run it locally

You need Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```
supabase start          # first run pulls the images; prints URLs and keys
supabase status         # prints them again
```

Create `.env.local` (never committed):

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the Publishable key from `supabase status`>
VITE_DISTRICT_ID=west-side-demo
```

Then `npm run dev` (or the `pp-backend` launch config, port 5181). The app is in live mode: no demo
bar, real dates, shared data.

- **Staff sign-in** (local only): `#/org/login` with `maya@westside.example` / `problem-pins-local`.
  The account comes from `supabase/seed-local-staff.sql`, which `npm run db:reset` loads (or
  `npm run db:local-staff` on its own). It is not in config.toml's seed paths, so no hosted
  project or preview branch can get it.
- **Start over**: `npm run db:reset` reapplies the migrations and the sample data, then adds the
  local staff account. Plain `supabase db reset` leaves the staff account out.
  It also restarts the API gateway (Kong). The reset restarts other containers too, which can give
  them new addresses, and the gateway keeps sending requests to the old ones for several minutes.
  Those requests fail with a 502; when that hits Realtime, live updates stop and the Realtime tests
  time out. If that happens after a plain `supabase db reset` or a `docker restart` of any Supabase
  container, run `npm run db:restart-gateway`.
- **Look at the data**: Studio at http://127.0.0.1:54323.
- **Stop**: `supabase stop` (data is kept until the next reset).

To try a second resident on the same machine, open the app on another origin
(`http://[::1]:5181` next to `http://localhost:5181`) or in a private window. Each origin gets
its own anonymous identity.

## How it works

**Identities.** Residents never need an account. On first load the app signs the device in
anonymously, which gives it a stable user id; that is what makes "one +1 per device" work. A
resident may add an email to that identity (an optional resident account, below). Staff sign in
with email and password and have a row in `staff` for their district. When staff sign out, the
device gets its resident identity back, anonymous or an account (the app keeps its refresh token
aside while staff are signed in).

**Reads.** `get_snapshot(district)` returns everything the app shows in one call: the district,
its issues with updates and history, scan points, and what this device has done. Counts are
derived from records here, not stored: `votes`, `votesThisWeek` (votes on the last 7 New York
calendar days, today included), `following`, `confirmedFixed` and `duplicatesMerged` (issues
whose `merged_into` points here). Hidden issues are left out unless the caller is staff of that
district. The reporter's user id is never returned, only whether the issue is "mine". Staff
names (on City requests, history lines and district updates) go to staff only; residents see
updates signed by the district. So do residents' reports: staff get, per issue, how many devices
reported it, since when and why; a device only learns that it reported an issue (`me.reported`).
History lines marked `staff_only` (dismissed reports) are left out for residents.

**Only what changed.** Re-reading the whole district on every change doesn't scale: at 2,000 issues
a snapshot is 3.3 MB (about 335 kB gzipped) and ~90 ms of database time, and every +1 used to make
every open app fetch one. So `get_snapshot` also returns a `cursor` and `today` (New York), and the
app then calls `get_changes(district, cursor)` after its own mutations and on change pings. It
returns the district, scan points and `me` in full (they're small), only the issues that changed
since the cursor (built by the same function as the snapshot, so the same viewer rules apply),
`removed` (ids of changed issues this viewer can no longer see, e.g. just hidden), and a new cursor.
At 2,000 issues that is a few kB and under 2 ms. How it knows what changed
(`20261117000000_incremental_snapshot.sql`): every issue keeps `changed_xid`, the last transaction
that changed it or any of its records (triggers on the issue and on votes, follows, notes, history,
fix answers, City requests and reports; a merge also touches the issue it went into; moving records
in `merge_device` and `delete_resident_account` goes through the same triggers). The cursor is the
oldest transaction still running when the snapshot was read (`pg_snapshot_xmin` of the snapshot the
read used), so a change that began before the read and committed after it is sent next time; an
issue may be sent twice, never missed. Each change to an issue takes its row lock, so the last
transaction recorded on it is also the last to commit. Transaction ids are 64-bit (`xid8`), so they
never wrap around; a rolled-back change leaves nothing behind. One cost: a transaction left open
for a long time anywhere in the database holds every cursor back, so changes get bigger (still
correct) until it ends.

The app asks for a whole snapshot instead when:
- the viewer changed (sign-in, sign-out, a returning resident account, deleting one): the app keeps
  whose cursor it is and compares it with the session;
- the viewer's staff rights changed under the same sign-in (an admin added or removed their
  `staff` row): the cursor says whether it was read as staff (`<xid>:s` / `<xid>:r`), and
  `get_changes` answers `{ "reload": true }` (`20261117000001_changes_viewer_check.sql`); it gives
  the same answer for a cursor it can't read;
- `today` moved on ("this week" counts change without any record changing). The app also catches
  up when it comes back to the foreground, so a phone that slept overnight notices;
- a mutation failed (to undo its optimistic change), or reading the changes failed.

`removed` names hidden issues by id only; ids are sequential anyway, so it says no more than a gap
in the numbers.

**First load.** A device that already has a session reads as itself. A new device (no session in
the browser yet) reads `get_snapshot` while its anonymous sign-in is still going, as `anon`: until
it has done something it sees exactly what any other new device sees, so the two requests run side
by side instead of one after the other.

**Writes.** Every mutation is a Postgres function (RPC): `create_issue`, `vote`, `unvote`,
`follow`, `unfollow`, `comment`, `delete_note`, `confirm_fix`, `remove_issue`, `report_issue`, and
for staff `post_update`, `reply_to_note`, `set_status`, `assign`, `send_to_city`, `nudge_city`, `hide_issue`,
`unhide_issue`, `dismiss_reports`, `merge_issue`, `save_scan_point`, `delete_scan_point`,
`list_events`, and for resident accounts `resident_account`, `device_claim`, `merge_device`,
`delete_resident_account`. They run as `security definer` with a fixed `search_path` and check the caller
themselves. Messages they raise are written for residents and shown as they are; any other
database error becomes "Something went wrong. Please try again." Every staff action on an issue
writes the staff member's name on its history line (and on a district update), from the `staff`
table.

**Replies** (`20261118000000_note_replies_and_hiding.sql`). A neighbor's note can have replies, one level
deep: `issue_updates.reply_to` points at the note. Neighbors reply with `comment(p_issue, p_text,
p_reply_to)`, staff with `reply_to_note`; a reply to a reply is stored under the same note. A
district reply is not a district update: the resident page shows it under the note, not on the
status card. Someone's reply to a device's note brings that problem onto its You page.

**Taking things back.** A device can take back its +1 (`unvote`; not on its own pin, whose +1
stays), stop following (`unfollow`, which also deletes any contact it left for that issue) and
delete a note it wrote (`delete_note`; the row is deleted, with the replies under it). The device that pinned an issue can
remove it (`remove_issue`) while the office hasn't acted on it (still Open, no owner, no district
update, no City request, no merged duplicate) and no other device has +1'd it. Removing hides the
issue with the reason "Removed by the person who pinned it", so staff still find it under Hidden
and can restore it. `removalBlocker` in `src/lib/ownPin.ts` is the same rule for the app.

**Reports.** `report_issue` stores one report per device per issue with a reason (`spam`,
`offensive`, `personal_info`, `not_public_space`, `other`) in `reports`. Reports change nothing
residents see. Staff see open ones in the snapshot; `hide_issue` and `dismiss_reports` mark them
handled (the rows stay, so the same device can't report that pin again, but a new device can).

**Row level security** is on for every table, and direct access is almost nothing: anyone can
read `districts`, staff can read their own `staff` row, and signed-in devices can insert analytics
events. Every other read and write goes through the functions, so device ids (`created_by`,
`user_id`) never leave the database, not even for staff. `follow_contacts` (emails and phone
numbers from "Notify me") and `reports` have no policies at all, so only the service role can
read them directly.

**Realtime.** A trigger on issues, updates, history, votes, follows, confirmations, city requests,
reports and scan points sends one empty broadcast per district per transaction on the private topic
`district:<id>`. Clients ask for what changed (`get_changes`, above) when it arrives (at most once
a second), so nothing private goes over the socket and the functions still decide what each viewer sees (a hidden issue
disappears for residents). Signed-in devices may listen; nobody may send, because
`realtime.messages` has a select policy and no insert policy. Hosted projects must also turn off
public channels: otherwise anyone can join a public channel of the same name, and on Realtime
v2.103 joining it publicly right after leaving it privately stops the pings for every device
already listening. The local stack can't turn public channels off (Realtime resets the setting
when it starts).

**Photos.** Bucket `photos`, public read. JPEG, PNG or WebP up to 5 MB, at most 20 per hour per
device, stored under random names (`<uuid>.jpg`); Storage records the uploader in `owner_id`, so a
URL says nothing about which device took it. Issues store the names, and `create_issue` only
accepts names of photos the same device uploaded; the app turns names into URLs, so a pin can't
point at an image hosted elsewhere. The browser re-encodes photos through a canvas first, which
drops EXIF and GPS. Public URLs don't expire, so a photo stays reachable by its URL after its issue
is hidden; switching to signed URLs is possible later but would need the snapshot to sign every
photo URL.

**Rules the database enforces** (in `20261113000001_functions.sql`): pins must be inside the
district boundary and in one of its categories, titles 3 to 120 characters, up to 4 photos that
this device uploaded, 10 pins and 20 notes per device per hour (each limit takes a per-device lock
before counting, so parallel requests can't slip past it). Residents can only confirm a fix once
the issue is marked fixed. `send_to_city` needs the real 311 SR number. Scan point codes are never
reused: deleting one retires it, and saving a retired code is refused.

**Analytics.** Events go into `events` with the device's user id, so unique devices can be
counted later. `list_events` never returns that id, and nobody can read the table directly. Each
device can add at most 120 events per 10 minutes; extra ones are dropped without an error.

## Resident accounts

Optional, and off in live mode until a deployment sets `VITE_RESIDENT_ACCOUNTS=on` (the demo
always has them, and shows the code instead of emailing it). The product decisions are in
docs/ARCHITECTURE.md ("Accounts stay optional", "Decisions so far"); this is how they work.

**Why a resident would add one.** The device's anonymous identity lives in the browser's storage.
A new phone, a cleared browser or Safari's clean-up of sites not visited for a while loses it, and
with it the You page. An account keeps the pins, +1s, follows, notes and fix answers with an email.
It also makes counts more accurate: one person on two phones is one +1 once both are signed in.

**Signing in** (`src/backend/supabase/index.ts`, migration `20261116000000_resident_accounts.sql`):

- The app asks Auth to put the email on the device's own anonymous user
  (`auth.updateUser({ email })`). Auth emails a 6-digit code (the "Change email address"
  template); `verifyOtp({ type: 'email_change' })` confirms it. The user id doesn't change, so
  every record the device made is simply the account's. This is a new account.
- If the email already has an account, Auth refuses that (`email_exists`) and the app asks for a
  sign-in code instead (`signInWithOtp`, `shouldCreateUser: false`, the "Magic link" template).
  Before verifying it, the still-anonymous device asks for a one-time claim (`device_claim`: 32
  random bytes, stored as a hash, 15 minutes, at most 10 open per device). Once signed in, the
  account passes the claim to `merge_device`, which moves the device's records to the account and
  deletes the device's anonymous user. Holding both sessions is the proof; neither side can name
  the other's id. If that fails (a staff email ends up here), the app signs the account out and
  resumes the device's anonymous session as it was.
- Merging (`private.move_records`) treats the two as one phone: where both +1'd or followed the
  same problem, one row stays, with the earlier date; where both answered "is it fixed?" or
  reported the same pin, the first answer or report stays; a follow contact stays the account's.
  Pins and notes move as they are. Analytics events keep the device that sent them, so experiment
  numbers keep counting devices and past numbers don't change.
- The pending code (email, new or returning) is kept in the browser for an hour, so reopening the
  page after switching to the mail app still lands on "Enter the code".

**Signing out** ends the account's session on this phone only (`signOut({ scope: 'local' })`)
and signs the phone in anonymously as a new device: its records leave the phone, the +1s still
count. A +1 the signed-out phone adds to the same problem is folded in when it signs in again.

**Deleting** forgets the email and keeps the records, which are public and counted. The app signs
a fresh anonymous identity in beside the account and passes its claim to
`delete_resident_account`, which moves the account's records to that identity and deletes the
account's auth user (email, identities and sessions, so other phones are signed out). The phone
carries on as that anonymous identity, so its problems stay on it, without an email.

**Who sees what.** `resident_account()` returns `{ email, since }` to the signed-in resident only,
and null for anonymous devices and staff. Nothing else returns an email: not `get_snapshot`, not
`list_events`, not anything staff see. The district office sees no account data, not even counts
(docs/ARCHITECTURE.md explains why). People with access to the Supabase project (dashboard,
service role) can see the emails in Auth, like any Auth user's; the privacy page should say who
that is once hosting is decided.

**Staff and residents on one device.** A staff session can't start a resident account
("Sign out there first"), and a staff email can't be used as one (`merge_device` refuses it).
Staff signing in on a phone with a resident account set its session aside and give it back when
they sign out, as with an anonymous one.

**Limits.** Auth's: one email per address per minimum interval (1 s locally, 60 s by default on
hosted projects), the project's emails per hour (`email_sent`), and code checks per IP
(`token_verifications`, 30 per 5 minutes). A code works for an hour (`otp_expiry`). Ours: 10 open
claims per device.

**Known edges.** The flow tells a caller whether an email has an account (Auth's `email_exists`),
as Supabase's own sign-in does. After an account is deleted, another phone still holding its
access token can write for up to an hour (the token's lifetime) before its refresh fails and it
becomes a new anonymous device. Records it made in that hour count but are no one's.

**Settings a hosted project needs** before turning `VITE_RESIDENT_ACCOUNTS` on:

1. Authentication → Sign In / Providers → Email: **"Confirm email" on**. With it off, Auth applies
   an email change at once, without the code, so anyone could put someone else's address on their
   device. (Staff accounts are made with "Auto confirm user", so this doesn't affect them.)
2. Authentication → Emails → SMTP: a real provider. Supabase's built-in sender is for testing
   only (a few emails per hour, and only to the project team's addresses). Use the provider chosen for
   notifications (wave 2, e.g. Resend), and raise the "emails per hour" rate limit to match it.
3. Authentication → Emails → Templates: "Change email address" and "Magic link" both get the
   subject "Your Problem Pins code" and the body in `supabase/templates/resident-code.html`
   (code only, no link). The local stack uses that file through `config.toml`.
4. Leave "Secure email change" on and the email OTP length at 6.

## Seed data

`supabase/seed.sql` is generated from the demo's sample data:

```
npm run db:seed-sql     # rewrites supabase/seed.sql
supabase db reset       # loads it
```

Dates are written relative to the day the seed runs: the sample's "today" (2026-10-14) becomes
today in New York. The sample counts become records: anonymous votes, follows and fix
confirmations spread over each issue's life, and five merged duplicate reports behind PP-2402.
Votes can't predate the pin, so issues pinned less than a week before "today" show all their votes
as this week (PP-2440, PP-2447 and PP-2449 differ from the demo there).

## Tests

`npm test` includes `src/backend/supabase/supabase.integration.test.ts`, which runs against the
local stack when `supabase status` finds it running and skips otherwise (set
`SKIP_SUPABASE_TESTS=1` to skip anyway). `accounts.integration.test.ts` does the same for resident
accounts, reading the codes from the stack's mail catcher (Mailpit, http://127.0.0.1:54324): new
account in place, returning sign-in and merge, sign-out, staff next to accounts, delete, and the
function guards. It creates two throwaway districts with their own staff
and removes them afterwards, so the sample data is untouched. It covers RLS (no hidden issues,
contacts, reports or staff names for residents, also in `get_changes`, one vote per device, no staff actions for
residents, no cross-district staff access, no removing someone else's pin or note) and the main
RPCs, uploads and Realtime (including that no device can send pings).

## Changing the schema

```
supabase migration new add_something    # creates supabase/migrations/<timestamp>_add_something.sql
supabase db reset                       # applies everything to the local stack
```

For a new table: enable RLS, `revoke all ... from anon, authenticated` (the local stack grants
everything on new tables by default, hosted projects don't), then grant only what its policies
need. New functions are executable by everyone until you revoke that. Regenerate the seed if the
sample data needs the change, and push to hosted projects as below.

## Staff accounts

Staff rights come only from the `staff` table. Supabase can't turn off email sign-ups without
also turning off anonymous sign-ins, so anyone could create an email account through the API, but
without a `staff` row it is just another resident and the staff app refuses it. Staff accounts are
created by someone with access to the Supabase dashboard:

1. Authentication → Users → Add user → Create new user. Enter their email and a temporary
   password, tick "Auto confirm user". If it says the email is already registered, **stop**: you
   didn't create that account. It may be a resident account, or someone else may have signed up
   with that address first.
   Delete that user and start again, or ask the person to sign in and check it is really theirs.
2. Copy the new user's UUID from the user list, then in the SQL editor:

   ```sql
   insert into staff (user_id, district_id, name, role)
   values ('<the UUID you just copied>', 'your-district-id', 'Maya Ruiz', 'Community Coordinator');
   ```

   Use the UUID, not a lookup by email: the email only proves who typed it.
To remove someone, delete their `staff` row (and the user, if they have no other district).
A user with no `staff` row for the deployment's district can't sign in to the staff app.

## A new district

Insert a row into `districts` (Studio or SQL). `boundary` is a GeoJSON Polygon or MultiPolygon in
`[lng, lat]` order; `rules` uses the `AttentionRules` keys from `src/data/types.ts`. Then set
`VITE_DISTRICT_ID` to its `id` in that deployment's environment.

## Hosted projects

Use two projects: **staging** (sample data, for the team and demos) and **production** (the
pilot, real data only). For each one:

1. Create the project in the Supabase dashboard (US East is closest to New York).
2. Apply the migrations from this repo:

   ```
   supabase link --project-ref <project ref>
   supabase db push
   ```

   Run `supabase db push` again whenever a new migration lands. Never edit a migration that has
   been pushed; add a new one.
3. Authentication settings: allow new sign-ups and anonymous sign-ins (residents need both), keep
   the email provider on (staff) with "Confirm email" on, and set the Site URL to the deployment's
   URL. Resident accounts need more (see **Resident accounts**). Under Rate limits, the default of 30
   anonymous sign-ins per hour per IP address is low if many residents share one network (an
   event, a library). When it is hit, those devices can still read but can't +1, pin or get live
   updates. Raising
   it also makes it cheaper to fake extra +1s (each anonymous sign-in is a new "device"); a
   CAPTCHA on anonymous sign-in (Turnstile) is the fix if that happens. Set these in the
   dashboard: the values in `supabase/config.toml` are for the local stack (1000 sign-ins per
   hour, so tests can run), so don't `supabase config push` them.
4. Realtime settings: turn off public channels ("Allow public access"), so only the private
   change pings exist. See **Realtime** above for why.
5. Staging only, load the sample once:

   ```
   psql "<connection string>" --single-transaction -v ON_ERROR_STOP=1 -f supabase/seed.sql
   ```

   (`supabase db push --include-seed` does the same.) Never load `seed-local-staff.sql` into a
   hosted project: its password is in this repo.
6. Create staff accounts as above, and set the deployment's environment variables
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` = the publishable key, `VITE_DISTRICT_ID`).

**Free tier.** Free projects are paused after about a week without activity. A paused project
answers nothing until someone restores it from the dashboard, which takes a few minutes; a resident
scanning a poster in the meantime gets an error page. Free projects also have no backups. Staging
on the free tier is fine; production for a paid pilot should be on a paid plan.

## Open decisions

- Hosted projects: who owns them, which plan for production.
- Email provider for notifications (wave 2). Follow contacts are already stored, privately.
  Until something sends them, `VITE_NOTIFICATIONS` stays off: resident screens then don't ask
  for a phone or email and don't promise a message (`config.notifications`).
- Photos: public bucket (current) or signed URLs.
- Analytics keep the anonymous device id; the privacy page should say so, or we drop it.
- Rate limits (pins, notes, uploads per hour, anonymous sign-ins per IP) are first guesses.
  Whether to add a CAPTCHA (Turnstile) to anonymous sign-in, which needs a Cloudflare account.
- Contacts aren't verified (wave 2, with notifications). Stopping a follow deletes the contact.
- Deleting a note removes the row, which also frees a slot in the 20-notes-per-hour limit.
- Reports have no rate limit beyond one per device per issue, and a new anonymous identity is a
  new device. Turnstile would help here too.
- Staff can't delete a resident's note or edit a pin; hiding the whole pin is the only tool.
- Scan point changes (`save_scan_point`, `delete_scan_point`) don't record who made them.
- Old anonymous users pile up in Auth. Deleting them is safe for counts (votes don't reference
  `auth.users`), but those devices would lose their "my +1s" list.
- Resident accounts: which email provider sends the codes (the same one as notifications), and
  when to turn `VITE_RESIDENT_ACCOUNTS` on for the pilot. Once notifications exist, whether a
  signed-in resident's follows should use the account's (verified) email instead of asking again.
- Anonymous users left behind by signed-out phones pile up in Auth like any other; the same
  clean-up question as above applies.
