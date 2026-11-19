-- Problem Pins: tables and row level security.
--
-- Access model (see docs/BACKEND.md):
-- - Residents are Supabase anonymous users (role `authenticated`, one per device).
-- - Staff are email/password users with a row in `staff` for their district.
-- - Reads go through `get_snapshot` and writes through the RPCs in the next migration.
--   Those are `security definer` functions with explicit checks. Direct table access is
--   limited to what the policies below allow; nothing is writable directly except `events`.
-- - Counts (votes, followers, confirmations, merged duplicates) are never stored. They are
--   derived from the records in `get_snapshot`.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Districts: the organization a deployment serves (VITE_DISTRICT_ID).

create table public.districts (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  area text not null,
  center_lat double precision not null,
  center_lng double precision not null,
  zoom smallint not null default 16,
  -- GeoJSON Polygon or MultiPolygon, [lng, lat] order. Null = no limit.
  boundary jsonb check (boundary is null or boundary ->> 'type' in ('Polygon', 'MultiPolygon')),
  categories text[] not null check (
    cardinality(categories) > 0
    and categories <@ array['lighting', 'seating', 'accessibility', 'litter', 'noise', 'other']
  ),
  teams text[] not null default '{}',
  -- AttentionRules (src/data/types.ts): { cityNoReplyDays, quietDays }
  rules jsonb not null,
  contact_email text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Staff: which auth users work for which district. Rows are added by an admin
-- (SQL editor or service role), never by the app.

create table public.staff (
  user_id uuid not null references auth.users (id) on delete cascade,
  district_id text not null references public.districts (id) on delete cascade,
  name text not null,
  role text not null default 'Staff',
  created_at timestamptz not null default now(),
  primary key (user_id, district_id)
);

-- ---------------------------------------------------------------------------
-- Issues. IDs come from a sequence that starts after the sample data (PP-2459).

create sequence public.issue_number_seq start 2461;

create table public.issues (
  id text primary key default 'PP-' || nextval('public.issue_number_seq'),
  district_id text not null references public.districts (id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null check (category in ('lighting', 'seating', 'accessibility', 'litter', 'noise', 'other')),
  status text not null default 'open' check (status in ('open', 'in_review', 'scheduled', 'sent_to_city', 'fixed')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  location_label text not null check (char_length(location_label) <= 120),
  location_detail text check (char_length(location_detail) <= 200),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  via text not null default '' check (char_length(via) <= 160),
  scan_code text,
  owner text check (char_length(owner) <= 80),
  agency text check (char_length(agency) <= 80),
  hidden boolean not null default false,
  hidden_reason text,
  merged_into text references public.issues (id),
  fixed_at timestamptz,
  -- The device that pinned it. Never returned to residents (only "is this mine").
  created_by uuid,
  created_at timestamptz not null default now()
);

create index issues_district_idx on public.issues (district_id);
create index issues_merged_into_idx on public.issues (merged_into) where merged_into is not null;
create index issues_created_by_idx on public.issues (created_by, created_at);

-- Partner updates and resident notes.
create table public.issue_updates (
  id uuid primary key default gen_random_uuid(),
  issue_id text not null references public.issues (id) on delete cascade,
  role text not null check (role in ('partner', 'resident')),
  -- Partner: the district name. Resident: null, shown as "Neighbor" (sample data has names).
  author_name text,
  text text not null check (char_length(text) between 1 and 2000),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index issue_updates_issue_idx on public.issue_updates (issue_id, created_at);
create index issue_updates_created_by_idx on public.issue_updates (created_by, created_at);

create table public.issue_history (
  id bigint generated always as identity primary key,
  issue_id text not null references public.issues (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create index issue_history_issue_idx on public.issue_history (issue_id, created_at);

-- One vote per device per issue. No foreign key to auth.users: votes outlive
-- anonymous users if those are ever cleaned up.
create table public.votes (
  issue_id text not null references public.issues (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create index votes_user_idx on public.votes (user_id);

create table public.follows (
  issue_id text not null references public.issues (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create index follows_user_idx on public.follows (user_id);

-- Contacts left with "Notify me". Private: no policies, so only the service role
-- (e.g. a notification function) can read them.
create table public.follow_contacts (
  issue_id text not null references public.issues (id) on delete cascade,
  user_id uuid not null,
  email text check (char_length(email) <= 254),
  phone text check (phone ~ '^\+?[0-9]{7,15}$'),
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id),
  check (email is not null or phone is not null)
);

create table public.fix_confirmations (
  issue_id text not null references public.issues (id) on delete cascade,
  user_id uuid not null,
  answer text not null check (answer in ('yes', 'no')),
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create index fix_confirmations_user_idx on public.fix_confirmations (user_id);

-- The 311 service request staff filed for an issue (one per issue; re-sending replaces it).
create table public.city_requests (
  issue_id text primary key references public.issues (id) on delete cascade,
  sr text not null check (char_length(sr) between 1 and 40),
  agency text not null,
  routed_to text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid,
  sent_by_name text not null,
  last_follow_up_at timestamptz
);

-- Printed QR codes. Codes are never reused, so deleting only retires them.
create table public.scan_points (
  district_id text not null references public.districts (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  name text not null check (char_length(name) between 1 and 120),
  detail text not null default '' check (char_length(detail) <= 200),
  lat double precision not null,
  lng double precision not null,
  issue_id text references public.issues (id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (district_id, code)
);

-- Product analytics. No personal data: the UI only sends event names, IDs and small props.
-- user_id (the anonymous device) is kept for counting unique devices and cleaning up abuse;
-- it is never returned by list_events.
create table public.events (
  id bigint generated always as identity primary key,
  district_id text not null references public.districts (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,39}$'),
  issue_id text check (char_length(issue_id) <= 20),
  scan_code text check (char_length(scan_code) <= 16),
  props jsonb check (props is null or (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 2048)),
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);

create index events_district_at_idx on public.events (district_id, at);
create index events_user_at_idx on public.events (user_id, at);

-- ---------------------------------------------------------------------------
-- Privileges. Start from nothing (local and hosted projects have different defaults),
-- then grant what the policies below need.

revoke all on all tables in schema public from anon, authenticated;
revoke all on sequence public.issue_number_seq from anon, authenticated;

-- Everything else is read through get_snapshot and list_events (security definer), which leave
-- out device ids (`created_by`, `user_id`). With no direct reads, not even staff can link one
-- device's pins, notes and app events.
grant select on public.districts to anon, authenticated;
grant select on public.staff to authenticated;
grant insert (district_id, name, issue_id, scan_code, props) on public.events to authenticated;

-- Is the caller staff of this district? Used inside the functions, which run as their owner.
create function private.is_staff(p_district text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.district_id = p_district
  );
$$;

revoke execute on function private.is_staff(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security, on for every table. Policies exist only for what is granted above;
-- every other read and write goes through the functions in the next migration.

alter table public.districts enable row level security;
alter table public.staff enable row level security;
alter table public.issues enable row level security;
alter table public.issue_updates enable row level security;
alter table public.issue_history enable row level security;
alter table public.votes enable row level security;
alter table public.follows enable row level security;
alter table public.follow_contacts enable row level security;
alter table public.fix_confirmations enable row level security;
alter table public.city_requests enable row level security;
alter table public.scan_points enable row level security;
alter table public.events enable row level security;

create policy "Districts are public" on public.districts
  for select to anon, authenticated using (true);

create policy "Staff read their own rows" on public.staff
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Signed-in devices record events" on public.events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- At most 120 events per device per 10 minutes. Extra ones are dropped without an error, so
-- analytics never get in the way, and one device can't flood the experiment numbers.
create function private.limit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('pp.seeding', true) = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('pp-events:' || coalesce(new.user_id::text, '')));
  if (
    select count(*) from public.events
    where user_id = new.user_id and at > now() - interval '10 minutes'
  ) >= 120 then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function private.limit_events() from public, anon, authenticated;

create trigger limit_events before insert on public.events
  for each row execute function private.limit_events();
