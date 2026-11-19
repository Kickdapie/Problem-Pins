-- Problem Pins: optional resident accounts (docs/BACKEND.md, "Resident accounts").
--
-- Residents still need no account. One who wants their pins, +1s and follows on another phone
-- can add an email, proved with a 6-digit code that Supabase Auth sends:
-- - A new account is the device's own anonymous user getting that email (Auth's email change),
--   so the user id and every row stay as they are. Nothing here is involved.
-- - Signing in to an existing account from a device that has its own anonymous records:
--   before verifying the code, the device asks for a one-time claim (`device_claim`); once signed
--   in, the account hands the claim to `merge_device`, which moves the device's records to the
--   account and counts one person once. The claim is what proves the caller held both sessions.
-- - Deleting an account: the app signs a fresh anonymous device in beside the account and passes
--   its claim to `delete_resident_account`, which moves the account's records to that device and
--   deletes the account's auth user (its email, and its sessions on every phone). The records stay:
--   they are public and counted.
-- Staff accounts can't be used as resident accounts, and analytics events keep the device that
-- sent them (experiment numbers count devices, and past numbers don't change).

-- ---------------------------------------------------------------------------
-- One-time claims on an anonymous device. Only a hash is stored; a claim lasts 15 minutes.

create table private.device_claims (
  token_hash bytea primary key,
  device_id uuid not null,
  created_at timestamptz not null default now()
);

create index device_claims_device_idx on private.device_claims (device_id, created_at);

alter table private.device_claims enable row level security;
revoke all on private.device_claims from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers

-- The caller, if they are signed in to a resident account (a confirmed email, not staff anywhere).
create function private.require_resident_account()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if exists (select 1 from public.staff s where s.user_id = v_uid) then
    raise exception 'This email is a district office account. Sign in to the staff app instead.';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_uid and not u.is_anonymous and u.email is not null and u.email_confirmed_at is not null
  ) then
    raise exception 'Sign in with your email first.';
  end if;
  return v_uid;
end;
$$;

-- Uses up a claim and returns its anonymous device. Fails if it is unknown, used or too old.
create function private.take_claim(p_claim text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
begin
  delete from private.device_claims
    where token_hash = extensions.digest(coalesce(p_claim, ''), 'sha256')
      and created_at > now() - interval '15 minutes'
    returning device_id into v_device;
  if v_device is null
     or not exists (select 1 from auth.users u where u.id = v_device and u.is_anonymous) then
    raise exception 'That took too long. Ask for a new code and try again.';
  end if;
  return v_device;
end;
$$;

-- Moves everything one user did to another, as if one phone had done it all. Where both +1'd,
-- followed, answered or reported the same problem, the earlier one stays (one person, counted
-- once); a +1 and a follow keep the earlier date. Pins and notes move as they are.
create function private.move_records(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Both users, in a fixed order, so a merge can't interleave with their votes or pins.
  perform pg_advisory_xact_lock(hashtext('pp-rate:' || least(p_from, p_to)::text));
  perform pg_advisory_xact_lock(hashtext('pp-rate:' || greatest(p_from, p_to)::text));

  update public.votes t set created_at = f.created_at
    from public.votes f
    where t.user_id = p_to and f.user_id = p_from and f.issue_id = t.issue_id and f.created_at < t.created_at;
  delete from public.votes f
    using public.votes t
    where f.user_id = p_from and t.user_id = p_to and t.issue_id = f.issue_id;
  update public.votes set user_id = p_to where user_id = p_from;

  update public.follows t set created_at = f.created_at
    from public.follows f
    where t.user_id = p_to and f.user_id = p_from and f.issue_id = t.issue_id and f.created_at < t.created_at;
  delete from public.follows f
    using public.follows t
    where f.user_id = p_from and t.user_id = p_to and t.issue_id = f.issue_id;
  update public.follows set user_id = p_to where user_id = p_from;

  -- A contact left with "Notify me": the account's stays.
  delete from public.follow_contacts f
    using public.follow_contacts t
    where f.user_id = p_from and t.user_id = p_to and t.issue_id = f.issue_id;
  update public.follow_contacts set user_id = p_to where user_id = p_from;

  -- One answer per person, like one per device: the first one stays.
  delete from public.fix_confirmations c
    using public.fix_confirmations o
    where c.issue_id = o.issue_id
      and ((c.user_id = p_to and o.user_id = p_from and o.created_at < c.created_at)
        or (c.user_id = p_from and o.user_id = p_to and o.created_at <= c.created_at));
  update public.fix_confirmations set user_id = p_to where user_id = p_from;

  -- One report per person per pin: the first one stays.
  delete from public.reports r
    using public.reports o
    where r.issue_id = o.issue_id
      and ((r.user_id = p_to and o.user_id = p_from and o.created_at < r.created_at)
        or (r.user_id = p_from and o.user_id = p_to and o.created_at <= r.created_at));
  update public.reports set user_id = p_to where user_id = p_from;

  update public.issues set created_by = p_to where created_by = p_from;
  update public.issue_updates set created_by = p_to where created_by = p_from and role = 'resident';
end;
$$;

-- ---------------------------------------------------------------------------
-- Resident account functions

-- The resident account signed in on this device, or null (anonymous devices and staff).
-- `since` is the New York date the email was first confirmed.
create function public.resident_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email', u.email,
    'since', (u.email_confirmed_at at time zone 'America/New_York')::date
  )
  from auth.users u
  where u.id = (select auth.uid())
    and not u.is_anonymous
    and u.email is not null
    and u.email_confirmed_at is not null
    and not exists (select 1 from public.staff s where s.user_id = u.id);
$$;

-- A one-time claim on this anonymous device, for merge_device or delete_resident_account.
-- At most 10 open claims per device (each one lasts 15 minutes).
create function public.device_claim()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'This phone is already signed in to an account.';
  end if;
  perform pg_advisory_xact_lock(hashtext('pp-claim:' || v_uid::text));
  delete from private.device_claims where created_at <= now() - interval '15 minutes';
  if (select count(*) from private.device_claims where device_id = v_uid) >= 10 then
    raise exception 'Too many sign-in attempts from this phone. Try again in a few minutes.';
  end if;
  insert into private.device_claims (token_hash, device_id) values (extensions.digest(v_token, 'sha256'), v_uid);
  return v_token;
end;
$$;

-- Signed in to an existing account on a device that had its own anonymous records: they move to
-- the account. The device's anonymous user is then deleted (the device uses the account now).
create function public.merge_device(p_claim text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_resident_account();
  v_device uuid := private.take_claim(p_claim);
begin
  perform private.move_records(v_device, v_uid);
  delete from auth.users where id = v_device and is_anonymous;
end;
$$;

-- Forgets the account's email: its records move to the fresh anonymous device behind the claim
-- (this phone keeps them), and the account's auth user is deleted, which signs it out everywhere.
create function public.delete_resident_account(p_claim text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_resident_account();
  v_device uuid := private.take_claim(p_claim);
begin
  perform private.move_records(v_uid, v_device);
  delete from auth.users where id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. New functions are executable by PUBLIC by default; undo that.

revoke execute on function
  private.require_resident_account(),
  private.take_claim(text),
  private.move_records(uuid, uuid)
from public, anon, authenticated;

revoke execute on function
  public.resident_account(),
  public.device_claim(),
  public.merge_device(text),
  public.delete_resident_account(text)
from public, anon;

grant execute on function
  public.resident_account(),
  public.device_claim(),
  public.merge_device(text),
  public.delete_resident_account(text)
to authenticated;
