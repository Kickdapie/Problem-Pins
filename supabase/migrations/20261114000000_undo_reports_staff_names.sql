-- Problem Pins: residents can take things back and report pins; staff actions record who did them.
--
-- - Residents: unvote, unfollow (also forgets the contact), delete_note, remove_issue (the device
--   that pinned an issue hides it while the office hasn't acted and nobody else +1'd it),
--   report_issue (one report per device per issue).
-- - Staff: dismiss_reports. Every staff action now writes the staff member's name on the history
--   line (and on district updates). Only staff receive those names, as with `sent_by_name`.
-- - get_snapshot gives staff each issue's open reports and the staff names; residents get neither,
--   nor the staff-only history lines (dismissed reports).
-- The staff functions below are the ones from 20261113000001_functions.sql with the name added;
-- `create or replace` keeps their grants. Texts match src/backend/demo.ts.

-- ---------------------------------------------------------------------------
-- Columns and the reports table

alter table public.issue_history
  add column staff_id uuid,
  add column staff_name text,
  -- Lines residents never see (dismissed reports: reports are never public).
  add column staff_only boolean not null default false;

-- The staff member who posted a district update (author_name stays the district).
alter table public.issue_updates add column staff_name text;

-- Residents' reports on a pin. Private like follow_contacts: no policies, read through
-- get_snapshot by staff only. One per device per issue, kept after staff handle it so the
-- same device can't report the same pin again.
create table public.reports (
  issue_id text not null references public.issues (id) on delete cascade,
  user_id uuid not null,
  reason text not null check (reason in ('spam', 'offensive', 'personal_info', 'not_public_space', 'other')),
  created_at timestamptz not null default now(),
  -- Staff hid the pin or dismissed the reports.
  handled_at timestamptz,
  handled_by uuid,
  primary key (issue_id, user_id)
);

create index reports_user_idx on public.reports (user_id);
create index reports_open_idx on public.reports (issue_id) where handled_at is null;

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create trigger ping after insert or update or delete on public.reports
  for each row execute function private.ping_district();

-- ---------------------------------------------------------------------------
-- Helpers

-- The caller's name as staff of this district, or null.
create function private.staff_name(p_district text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.name from public.staff s where s.user_id = (select auth.uid()) and s.district_id = p_district;
$$;

-- A history line for a staff action, with who did it.
create function private.staff_log(p_issue text, p_text text, p_staff_only boolean default false)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.issue_history (issue_id, text, staff_id, staff_name, staff_only)
  select i.id, p_text, (select auth.uid()), private.staff_name(i.district_id), p_staff_only
  from public.issues i where i.id = p_issue;
$$;

-- "1 report", "3 reports".
create function private.reports_text(p_count integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_count || case when p_count = 1 then ' report' else ' reports' end;
$$;

-- ---------------------------------------------------------------------------
-- Read

create or replace function public.get_snapshot(p_district text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean := private.is_staff(p_district);
  -- "This week" = the last 7 calendar days in New York, today included.
  v_week_start date := (now() at time zone 'America/New_York')::date - 6;
  v_district jsonb;
begin
  select to_jsonb(d) into v_district from public.districts d where d.id = p_district;
  if v_district is null then
    raise exception 'District "%" isn’t set up in this database.', p_district;
  end if;

  return jsonb_build_object(
    'district', v_district,
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'description', i.description,
        'category', i.category,
        'status', i.status,
        'lat', i.lat,
        'lng', i.lng,
        'location_label', i.location_label,
        'location_detail', i.location_detail,
        'photos', to_jsonb(i.photos),
        'via', i.via,
        'owner', i.owner,
        'agency', i.agency,
        'hidden', i.hidden,
        'hidden_reason', i.hidden_reason,
        'merged_into', i.merged_into,
        'fixed_at', i.fixed_at,
        'created_at', i.created_at,
        'is_user_report', v_uid is not null and i.created_by = v_uid,
        'votes', (select count(*) from public.votes v where v.issue_id = i.id),
        'votes_this_week', (
          select count(*) from public.votes v
          where v.issue_id = i.id and (v.created_at at time zone 'America/New_York')::date >= v_week_start
        ),
        'following', (select count(*) from public.follows f where f.issue_id = i.id),
        'confirmed_fixed', (
          select count(*) from public.fix_confirmations c where c.issue_id = i.id and c.answer = 'yes'
        ),
        -- Only answers given since it was last marked fixed: reopening it clears them.
        'not_fixed', (
          select count(*) from public.fix_confirmations c
          where c.issue_id = i.id and c.answer = 'no' and i.status = 'fixed' and c.created_at >= i.fixed_at
        ),
        'duplicates_merged', (select count(*) from public.issues m where m.merged_into = i.id),
        'city_request', (
          select jsonb_build_object(
            'sr', r.sr,
            'agency', r.agency,
            'routed_to', r.routed_to,
            'sent_at', r.sent_at,
            'sent_by', case when v_staff then r.sent_by_name end,
            'last_follow_up_at', r.last_follow_up_at
          )
          from public.city_requests r where r.issue_id = i.id
        ),
        -- Open reports, staff only: how many devices, since when, and the reasons, most first.
        'reports', case when v_staff then (
          select jsonb_build_object(
            'count', sum(g.n),
            'since', min(g.first_at),
            'reasons', jsonb_agg(jsonb_build_object('reason', g.reason, 'count', g.n) order by g.n desc, g.reason)
          )
          from (
            select rp.reason, count(*) as n, min(rp.created_at) as first_at
            from public.reports rp
            where rp.issue_id = i.id and rp.handled_at is null
            group by rp.reason
          ) g
          having count(*) > 0
        ) end,
        'updates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', u.id,
            'role', u.role,
            'author', u.author_name,
            'text', u.text,
            'created_at', u.created_at,
            'mine', u.role = 'resident' and v_uid is not null and u.created_by = v_uid,
            'staff_name', case when v_staff then u.staff_name end
          ) order by u.created_at, u.id)
          from public.issue_updates u where u.issue_id = i.id
        ), '[]'::jsonb),
        'history', coalesce((
          select jsonb_agg(jsonb_build_object(
            'text', h.text,
            'created_at', h.created_at,
            'staff_name', case when v_staff then h.staff_name end,
            'staff_only', h.staff_only
          ) order by h.created_at, h.id)
          from public.issue_history h where h.issue_id = i.id and (v_staff or not h.staff_only)
        ), '[]'::jsonb)
      ) order by i.created_at desc, i.id desc)
      from public.issues i
      where i.district_id = p_district and (not i.hidden or v_staff)
    ), '[]'::jsonb),
    'scan_points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', p.code,
        'name', p.name,
        'detail', p.detail,
        'lat', p.lat,
        'lng', p.lng,
        -- Don't point residents at a hidden issue.
        'issue_id', case when i.id is not null and (not i.hidden or v_staff) then i.id end
      ) order by p.created_at, p.code)
      from public.scan_points p
      left join public.issues i on i.id = p.issue_id
      where p.district_id = p_district and p.retired_at is null
    ), '[]'::jsonb),
    'me', jsonb_build_object(
      'voted', coalesce((
        select jsonb_agg(v.issue_id order by v.created_at)
        from public.votes v join public.issues i on i.id = v.issue_id
        where v.user_id = v_uid and i.district_id = p_district
      ), '[]'::jsonb),
      'following', coalesce((
        select jsonb_agg(f.issue_id order by f.created_at)
        from public.follows f join public.issues i on i.id = f.issue_id
        where f.user_id = v_uid and i.district_id = p_district
      ), '[]'::jsonb),
      'confirmed', coalesce((
        select jsonb_object_agg(c.issue_id, c.answer)
        from public.fix_confirmations c join public.issues i on i.id = c.issue_id
        where c.user_id = v_uid and i.district_id = p_district
      ), '{}'::jsonb),
      'reported', coalesce((
        select jsonb_agg(rp.issue_id order by rp.created_at)
        from public.reports rp join public.issues i on i.id = rp.issue_id
        where rp.user_id = v_uid and i.district_id = p_district
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Residents: taking things back

-- Takes back this device's +1. The device that pinned an issue keeps its +1.
create function public.unvote(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
begin
  if r.created_by = v_uid then
    raise exception 'You pinned this, so your +1 stays.';
  end if;
  delete from public.votes where issue_id = r.id and user_id = v_uid;
end;
$$;

-- Stops following and forgets any contact this device left for the issue.
create function public.unfollow(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_issue(p_issue);
begin
  delete from public.follows where issue_id = r.id and user_id = v_uid;
  delete from public.follow_contacts where issue_id = r.id and user_id = v_uid;
end;
$$;

-- Deletes a note this device wrote. Gone for good: a resident may have shared too much in it.
create function public.delete_note(p_issue text, p_note uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_issue(p_issue);
begin
  delete from public.issue_updates
    where id = p_note and issue_id = r.id and role = 'resident' and created_by = v_uid;
  if not found then
    raise exception 'Only the phone that wrote a note can delete it.';
  end if;
end;
$$;

-- The device that pinned an issue takes it off the map, while the office hasn't done anything
-- with it and no other device has +1'd it. Hidden, not deleted: staff find it under Hidden and
-- can restore it. The same rule as removalBlocker in src/lib/ownPin.ts.
create function public.remove_issue(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
begin
  if r.created_by is distinct from v_uid then
    raise exception 'Only the phone that pinned this can remove it.';
  end if;
  if r.status <> 'open' or r.owner is not null
     or exists (select 1 from public.issue_updates u where u.issue_id = r.id and u.role = 'partner')
     or exists (select 1 from public.city_requests c where c.issue_id = r.id)
     or exists (select 1 from public.issues m where m.merged_into = r.id) then
    raise exception '% has picked this up, so it stays on the map. You can still add a note.', private.district_name(r.district_id);
  end if;
  if exists (select 1 from public.votes v where v.issue_id = r.id and v.user_id <> v_uid) then
    raise exception 'Neighbors have +1’d this, so it stays on the map. You can still add a note.';
  end if;
  update public.issues set hidden = true, hidden_reason = 'Removed by the person who pinned it' where id = r.id;
  perform private.log(r.id, 'Removed by the person who pinned it');
end;
$$;

-- One report per device per issue; a second one is ignored. Reports change nothing residents
-- see: they put the issue on the staff to-do list until staff hide it or dismiss them.
create function public.report_issue(p_issue text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
begin
  if p_reason is null or p_reason not in ('spam', 'offensive', 'personal_info', 'not_public_space', 'other') then
    raise exception 'Pick a reason.';
  end if;
  insert into public.reports (issue_id, user_id, reason) values (r.id, v_uid, p_reason) on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff: the same functions as before, now recording who did it

create or replace function public.post_update(p_issue text, p_text text, p_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_text text := btrim(coalesce(p_text, ''));
begin
  if v_text = '' then
    raise exception 'Write the update first.';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'Keep updates under 2,000 characters.';
  end if;
  if p_status is not null and p_status <> r.status then
    perform private.check_status(p_status);
    update public.issues
      set status = p_status, fixed_at = case when p_status = 'fixed' then now() end
      where id = r.id;
    perform private.staff_log(r.id, 'Status changed to ' || private.status_label(p_status));
  end if;
  insert into public.issue_updates (issue_id, role, author_name, text, created_by, staff_name)
  values (r.id, 'partner', private.district_name(r.district_id), v_text, auth.uid(), private.staff_name(r.district_id));
end;
$$;

create or replace function public.set_status(p_issue text, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  perform private.check_status(p_status);
  if p_status = r.status then
    return;
  end if;
  update public.issues
    set status = p_status, fixed_at = case when p_status = 'fixed' then now() end
    where id = r.id;
  perform private.staff_log(
    r.id,
    case
      when p_status = 'fixed' then 'Marked fixed by ' || coalesce(r.owner, private.district_name(r.district_id))
      else 'Status changed to ' || private.status_label(p_status)
    end
  );
end;
$$;

create or replace function public.assign(p_issue text, p_owner text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_owner text := nullif(btrim(coalesce(p_owner, '')), '');
begin
  if char_length(v_owner) > 80 then
    raise exception 'Keep the team name under 80 characters.';
  end if;
  update public.issues
    set owner = v_owner,
        status = case when status = 'open' and v_owner is not null then 'in_review' else status end
    where id = r.id;
  perform private.staff_log(r.id, case when v_owner is null then 'Unassigned' else 'Assigned to ' || v_owner end);
end;
$$;

create or replace function public.send_to_city(
  p_issue text,
  p_sr text,
  p_agency text default null,
  p_routed_to text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_sr text := btrim(coalesce(p_sr, ''));
  v_agency text := coalesce(nullif(btrim(coalesce(p_agency, '')), ''), r.agency, 'NYC 311');
  v_routed_to text;
  v_staff_name text := private.staff_name(r.district_id);
begin
  if v_sr = '' then
    raise exception 'Enter the 311 service request number.';
  end if;
  if char_length(v_sr) > 40 or char_length(v_agency) > 80 then
    raise exception 'The SR number or agency is too long.';
  end if;
  v_routed_to := coalesce(nullif(btrim(coalesce(p_routed_to, '')), ''), v_agency);

  update public.issues set status = 'sent_to_city', owner = v_agency, fixed_at = null where id = r.id;
  insert into public.city_requests (issue_id, sr, agency, routed_to, sent_by, sent_by_name)
  values (r.id, v_sr, v_agency, v_routed_to, auth.uid(), v_staff_name)
  on conflict (issue_id) do update
    set sr = excluded.sr,
        agency = excluded.agency,
        routed_to = excluded.routed_to,
        sent_at = now(),
        sent_by = excluded.sent_by,
        sent_by_name = excluded.sent_by_name,
        last_follow_up_at = null;
  perform private.staff_log(r.id, 'Sent to NYC 311 · SR ' || v_sr);
  insert into public.issue_updates (issue_id, role, author_name, text, created_by, staff_name)
  values (
    r.id, 'partner', private.district_name(r.district_id),
    format(
      'This is %s''s responsibility, so we filed it with 311 (SR %s) with %s attached. We''ll keep following up.',
      v_agency, v_sr, private.neighbors(private.vote_count(r.id))
    ),
    auth.uid(),
    v_staff_name
  );
end;
$$;

create or replace function public.nudge_city(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  update public.city_requests set last_follow_up_at = now() where issue_id = r.id;
  if not found then
    raise exception '% hasn’t been sent to the City yet.', r.id;
  end if;
  perform private.staff_log(r.id, format('Followed up with the City, %s attached', private.neighbors(private.vote_count(r.id))));
end;
$$;

-- Hiding is one answer to residents' reports, so it settles them too.
create or replace function public.hide_issue(p_issue text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) > 200 then
    raise exception 'Keep the reason under 200 characters.';
  end if;
  update public.issues set hidden = true, hidden_reason = nullif(v_reason, '') where id = r.id;
  update public.reports set handled_at = now(), handled_by = auth.uid() where issue_id = r.id and handled_at is null;
  perform private.staff_log(r.id, case when v_reason = '' then 'Hidden by staff' else 'Hidden by staff: ' || v_reason end);
end;
$$;

create or replace function public.unhide_issue(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  update public.issues set hidden = false, hidden_reason = null where id = r.id;
  perform private.staff_log(r.id, 'Restored by staff');
end;
$$;

-- Keeps the pin up and settles its open reports. The history line is for staff only.
create function public.dismiss_reports(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_count integer;
begin
  update public.reports set handled_at = now(), handled_by = auth.uid() where issue_id = r.id and handled_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.staff_log(r.id, 'Kept the pin, dismissed ' || private.reports_text(v_count), true);
  end if;
end;
$$;

-- Moves votes, follows and contacts from the duplicate onto `p_into` (a device that was on
-- both counts once), re-points earlier duplicates, and marks the duplicate as merged.
-- The duplicate stays readable so old links can redirect.
create or replace function public.merge_issue(p_duplicate text, p_into text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dup public.issues;
  target public.issues;
  v_dup_votes integer;
begin
  if p_duplicate = p_into then
    raise exception 'Pick a different problem to merge into.';
  end if;
  dup := private.require_staff(p_duplicate);
  target := private.require_staff(p_into);
  if dup.district_id <> target.district_id then
    raise exception 'Those problems belong to different districts.';
  end if;
  if dup.merged_into is not null then
    raise exception '% was already merged into %.', dup.id, dup.merged_into;
  end if;
  if target.merged_into is not null then
    raise exception '% was itself merged into %.', target.id, target.merged_into;
  end if;

  v_dup_votes := private.vote_count(dup.id);

  update public.votes v set issue_id = target.id
    where v.issue_id = dup.id
      and not exists (select 1 from public.votes w where w.issue_id = target.id and w.user_id = v.user_id);
  delete from public.votes where issue_id = dup.id;

  update public.follows f set issue_id = target.id
    where f.issue_id = dup.id
      and not exists (select 1 from public.follows g where g.issue_id = target.id and g.user_id = f.user_id);
  delete from public.follows where issue_id = dup.id;

  update public.follow_contacts c set issue_id = target.id
    where c.issue_id = dup.id
      and not exists (select 1 from public.follow_contacts k where k.issue_id = target.id and k.user_id = c.user_id);
  delete from public.follow_contacts where issue_id = dup.id;

  update public.issues set merged_into = target.id where merged_into = dup.id;
  update public.issues set merged_into = target.id where id = dup.id;

  perform private.staff_log(target.id, format('Merged duplicate %s · %s', dup.id, private.neighbors(v_dup_votes)));
  perform private.staff_log(dup.id, 'Merged into ' || target.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. New functions are executable by PUBLIC by default; undo that.
-- (The replaced functions keep the grants from 20261113000001_functions.sql.)

revoke execute on function
  private.staff_name(text),
  private.staff_log(text, text, boolean),
  private.reports_text(integer)
from public, anon, authenticated;

revoke execute on function
  public.unvote(text),
  public.unfollow(text),
  public.delete_note(text, uuid),
  public.remove_issue(text),
  public.report_issue(text, text),
  public.dismiss_reports(text)
from public, anon;

grant execute on function
  public.unvote(text),
  public.unfollow(text),
  public.delete_note(text, uuid),
  public.remove_issue(text),
  public.report_issue(text, text),
  public.dismiss_reports(text)
to authenticated;
