-- Problem Pins: incremental snapshots.
--
-- Until now every change ping made every open app fetch the whole district (at 2,000 issues,
-- 3.3 MB and ~250 ms of database time per device). Now:
-- - Every issue remembers the last transaction that changed it or any of its records
--   (`changed_xid`, kept by triggers on the issue and on votes, follows, notes, history, fix answers,
--   City requests and reports).
-- - `get_snapshot` returns a `cursor` with the snapshot: the oldest transaction that was still
--   running when it read. Everything committed before that is in the snapshot.
-- - `get_changes(district, cursor)` returns only the issues changed by transactions from the cursor
--   on, plus the small parts in full (district, scan points, this device's own records), the ids of
--   changed issues this viewer can no longer see, and a new cursor. Sending an issue twice is
--   harmless, so the cursor errs on the early side and nothing committed late is missed.
-- What each viewer sees is decided exactly as in get_snapshot (same builder, below), so staff-only
-- fields stay staff-only and device ids stay in the database.

-- ---------------------------------------------------------------------------
-- Change tracking

-- Existing rows get this migration's transaction, so a cursor from before it sends them once more.
alter table public.issues add column changed_xid xid8 not null default pg_current_xact_id();

create function private.touch_issue_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.changed_xid := pg_current_xact_id();
  return new;
end;
$$;

create trigger touch before update on public.issues
  for each row execute function private.touch_issue_row();

-- A record of an issue changed (inserted, edited or deleted): the issue changed.
create function private.touch_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_xid xid8 := pg_current_xact_id();
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.issues set changed_xid = v_xid where id = old.issue_id and changed_xid <> v_xid;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.issue_id is distinct from old.issue_id) then
    update public.issues set changed_xid = v_xid where id = new.issue_id and changed_xid <> v_xid;
  end if;
  return null;
end;
$$;

create trigger touch after insert or update or delete on public.votes
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.follows
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.fix_confirmations
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.issue_updates
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.issue_history
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.city_requests
  for each row execute function private.touch_issue();
create trigger touch after insert or update or delete on public.reports
  for each row execute function private.touch_issue();

-- Merging changes the count of duplicates on the issue it points to (and on the one it pointed to).
create function private.touch_merge_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_xid xid8 := pg_current_xact_id();
begin
  update public.issues set changed_xid = v_xid
  where id in (old.merged_into, new.merged_into) and changed_xid <> v_xid;
  return null;
end;
$$;

create trigger touch_merge after update of merged_into on public.issues
  for each row when (old.merged_into is distinct from new.merged_into)
  execute function private.touch_merge_targets();

-- ---------------------------------------------------------------------------
-- The read, in parts. Only get_snapshot and get_changes call these (they run as the owner);
-- nobody else may, since the caller passes who is asking.

-- The issues this viewer may see, as get_snapshot has always returned them. `p_ids` null: all of them.
create function private.issues_json(p_district text, p_uid uuid, p_staff boolean, p_ids text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
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
    'is_user_report', p_uid is not null and i.created_by = p_uid,
    'votes', (select count(*) from public.votes v where v.issue_id = i.id),
    'votes_this_week', (
      select count(*) from public.votes v
      where v.issue_id = i.id
        -- "This week" = the last 7 calendar days in New York, today included.
        and (v.created_at at time zone 'America/New_York')::date >= (now() at time zone 'America/New_York')::date - 6
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
        'sent_by', case when p_staff then r.sent_by_name end,
        'last_follow_up_at', r.last_follow_up_at
      )
      from public.city_requests r where r.issue_id = i.id
    ),
    -- Open reports, staff only: how many devices, since when, and the reasons, most first.
    'reports', case when p_staff then (
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
        'mine', u.role = 'resident' and p_uid is not null and u.created_by = p_uid,
        'staff_name', case when p_staff then u.staff_name end
      ) order by u.created_at, u.id)
      from public.issue_updates u where u.issue_id = i.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', h.text,
        'created_at', h.created_at,
        'staff_name', case when p_staff then h.staff_name end,
        'staff_only', h.staff_only
      ) order by h.created_at, h.id)
      from public.issue_history h where h.issue_id = i.id and (p_staff or not h.staff_only)
    ), '[]'::jsonb)
  ) order by i.created_at desc, i.id desc), '[]'::jsonb)
  from public.issues i
  where i.district_id = p_district
    and (not i.hidden or p_staff)
    and (p_ids is null or i.id = any (p_ids));
$$;

create function private.scan_points_json(p_district text, p_staff boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code,
    'name', p.name,
    'detail', p.detail,
    'lat', p.lat,
    'lng', p.lng,
    -- Don't point residents at a hidden issue.
    'issue_id', case when i.id is not null and (not i.hidden or p_staff) then i.id end
  ) order by p.created_at, p.code), '[]'::jsonb)
  from public.scan_points p
  left join public.issues i on i.id = p.issue_id
  where p.district_id = p_district and p.retired_at is null;
$$;

-- What this device has done in the district.
create function private.me_json(p_district text, p_uid uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'voted', coalesce((
      select jsonb_agg(v.issue_id order by v.created_at)
      from public.votes v join public.issues i on i.id = v.issue_id
      where v.user_id = p_uid and i.district_id = p_district
    ), '[]'::jsonb),
    'following', coalesce((
      select jsonb_agg(f.issue_id order by f.created_at)
      from public.follows f join public.issues i on i.id = f.issue_id
      where f.user_id = p_uid and i.district_id = p_district
    ), '[]'::jsonb),
    'confirmed', coalesce((
      select jsonb_object_agg(c.issue_id, c.answer)
      from public.fix_confirmations c join public.issues i on i.id = c.issue_id
      where c.user_id = p_uid and i.district_id = p_district
    ), '{}'::jsonb),
    'reported', coalesce((
      select jsonb_agg(rp.issue_id order by rp.created_at)
      from public.reports rp join public.issues i on i.id = rp.issue_id
      where rp.user_id = p_uid and i.district_id = p_district
    ), '[]'::jsonb)
  );
$$;

revoke execute on function
  private.touch_issue_row(),
  private.touch_issue(),
  private.touch_merge_targets(),
  private.issues_json(text, uuid, boolean, text[]),
  private.scan_points_json(text, boolean),
  private.me_json(text, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads

-- Everything the app shows, as before, plus `cursor` (for get_changes) and `today` (New York),
-- which tells the app when "this week" counts moved on without any record changing.
create or replace function public.get_snapshot(p_district text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- First, before reading: this function's reads all see one snapshot, taken no earlier than this.
  v_cursor xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_uid uuid := auth.uid();
  v_staff boolean := private.is_staff(p_district);
  v_district jsonb;
begin
  select to_jsonb(d) into v_district from public.districts d where d.id = p_district;
  if v_district is null then
    raise exception 'District "%" isn’t set up in this database.', p_district;
  end if;

  return jsonb_build_object(
    'district', v_district,
    'issues', private.issues_json(p_district, v_uid, v_staff, null),
    'scan_points', private.scan_points_json(p_district, v_staff),
    'me', private.me_json(p_district, v_uid),
    'cursor', v_cursor::text,
    'today', (now() at time zone 'America/New_York')::date
  );
end;
$$;

-- What changed since a cursor from get_snapshot or get_changes, for the same viewer. The app asks
-- for a whole snapshot instead when the viewer changed (sign-in, sign-out) or `today` did.
-- `removed`: changed issues this viewer can no longer see (hidden or merged since), by id only.
create function public.get_changes(p_district text, p_since text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cursor xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_since xid8;
  v_uid uuid := auth.uid();
  v_staff boolean := private.is_staff(p_district);
  v_district jsonb;
  v_changed text[];
  v_removed text[];
begin
  begin
    v_since := p_since::xid8;
  exception when others then
    raise exception 'Reload the page to see the latest.';
  end;
  select to_jsonb(d) into v_district from public.districts d where d.id = p_district;
  if v_district is null then
    raise exception 'District "%" isn’t set up in this database.', p_district;
  end if;

  select
    coalesce(array_agg(i.id) filter (where not i.hidden or v_staff), '{}'),
    coalesce(array_agg(i.id) filter (where i.hidden and not v_staff), '{}')
  into v_changed, v_removed
  from public.issues i
  where i.district_id = p_district and i.changed_xid >= v_since;

  return jsonb_build_object(
    'district', v_district,
    'issues', case when cardinality(v_changed) = 0 then '[]'::jsonb
      else private.issues_json(p_district, v_uid, v_staff, v_changed) end,
    'removed', to_jsonb(v_removed),
    'scan_points', private.scan_points_json(p_district, v_staff),
    'me', private.me_json(p_district, v_uid),
    'cursor', v_cursor::text,
    'today', (now() at time zone 'America/New_York')::date
  );
end;
$$;

revoke execute on function public.get_changes(text, text) from public;
-- Like get_snapshot, readable before the anonymous sign-in finishes.
grant execute on function public.get_changes(text, text) to anon, authenticated;
