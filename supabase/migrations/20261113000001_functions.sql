-- Problem Pins: the read RPC (get_snapshot) and every mutation the app makes.
--
-- All of these are `security definer` with `search_path = ''`, so they bypass RLS and do
-- their own checks: who is calling (auth.uid()), whether they may see the issue, and
-- whether they are staff of its district. Errors are raised with messages that are safe
-- to show residents (the client shows P0001 messages as they are).
-- History and update texts match src/backend/demo.ts.

-- ---------------------------------------------------------------------------
-- Helpers (private schema: not exposed through the API)

create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Couldn’t connect this device. Reload the page and try again.';
  end if;
  return auth.uid();
end;
$$;

-- The issue if the caller may see it (hidden ones only for staff), locked for the
-- rest of the transaction so concurrent votes and staff edits don't interleave.
create function private.get_issue(p_id text)
returns public.issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues;
begin
  select * into r from public.issues where id = p_id for no key update;
  if not found or (r.hidden and not private.is_staff(r.district_id)) then
    raise exception 'Problem % doesn’t exist.', p_id;
  end if;
  return r;
end;
$$;

-- Like get_issue, for issues residents act on: merged duplicates are read-only.
create function private.get_open_issue(p_id text)
returns public.issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.get_issue(p_id);
begin
  if r.merged_into is not null then
    raise exception 'This problem was merged into %. Open that one instead.', r.merged_into;
  end if;
  return r;
end;
$$;

create function private.require_staff(p_id text)
returns public.issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.get_issue(p_id);
begin
  if not private.is_staff(r.district_id) then
    raise exception 'Sign in as staff to do that.';
  end if;
  return r;
end;
$$;

create function private.require_district_staff(p_district text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff(p_district) then
    raise exception 'Sign in as staff to do that.';
  end if;
end;
$$;

create function private.log(p_issue text, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.issue_history (issue_id, text) values (p_issue, p_text);
$$;

create function private.vote_count(p_issue text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.votes where issue_id = p_issue;
$$;

-- "1 neighbor", "3 neighbors": for history lines and updates residents read.
create function private.neighbors(p_count integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_count || case when p_count = 1 then ' neighbor' else ' neighbors' end;
$$;

create function private.district_name(p_district text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select name from public.districts where id = p_district;
$$;

-- Labels from src/data/meta.ts (STATUSES[status].label).
create function private.status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'open' then 'Open'
    when 'in_review' then 'In review'
    when 'scheduled' then 'Scheduled'
    when 'sent_to_city' then 'Sent to City'
    when 'fixed' then 'Fixed'
  end;
$$;

create function private.check_status(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if private.status_label(p_status) is null then
    raise exception 'Unknown status "%".', p_status;
  end if;
end;
$$;

-- Point in a GeoJSON ring ([lng, lat] pairs), ray casting.
create function private.in_ring(p_ring jsonb, p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := jsonb_array_length(p_ring);
  inside boolean := false;
  i integer;
  j integer := n - 1;
  xi double precision;
  yi double precision;
  xj double precision;
  yj double precision;
begin
  for i in 0 .. n - 1 loop
    xi := (p_ring -> i ->> 0)::double precision;
    yi := (p_ring -> i ->> 1)::double precision;
    xj := (p_ring -> j ->> 0)::double precision;
    yj := (p_ring -> j ->> 1)::double precision;
    if (yi > p_lat) <> (yj > p_lat) then
      if p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi then
        inside := not inside;
      end if;
    end if;
    j := i;
  end loop;
  return inside;
end;
$$;

-- Point in a district boundary (Polygon or MultiPolygon, holes respected). Null = no limit.
create function private.in_boundary(p_boundary jsonb, p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  polygon jsonb;
  hole integer;
  in_hole boolean;
begin
  if p_boundary is null then
    return true;
  end if;
  for polygon in
    select value from jsonb_array_elements(
      case p_boundary ->> 'type'
        when 'Polygon' then jsonb_build_array(p_boundary -> 'coordinates')
        else p_boundary -> 'coordinates'
      end
    )
  loop
    if private.in_ring(polygon -> 0, p_lat, p_lng) then
      in_hole := false;
      for hole in 1 .. jsonb_array_length(polygon) - 1 loop
        if private.in_ring(polygon -> hole, p_lat, p_lng) then
          in_hole := true;
        end if;
      end loop;
      if not in_hole then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read: everything the app shows, in one round trip.

create function public.get_snapshot(p_district text)
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
        'updates', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', u.id,
            'role', u.role,
            'author', u.author_name,
            'text', u.text,
            'created_at', u.created_at,
            'mine', u.role = 'resident' and v_uid is not null and u.created_by = v_uid
          ) order by u.created_at, u.id)
          from public.issue_updates u where u.issue_id = i.id
        ), '[]'::jsonb),
        'history', coalesce((
          select jsonb_agg(jsonb_build_object('text', h.text, 'created_at', h.created_at) order by h.created_at, h.id)
          from public.issue_history h where h.issue_id = i.id
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
      ), '{}'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Residents

-- Rate limits per device. Product settings, not experiment thresholds.
-- create_issue: 10 per hour. comment: 20 per hour. Photo uploads: see the storage migration.
-- Each limit takes a per-device lock before counting, so parallel requests can't slip past it.

create function public.create_issue(
  p_district text,
  p_title text,
  p_category text,
  p_lat double precision,
  p_lng double precision,
  p_location_label text,
  p_via text,
  p_description text default '',
  p_location_detail text default null,
  p_photos text[] default '{}',
  p_scan_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  d public.districts;
  v_id text;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_photos text[] := coalesce(p_photos, '{}');
  v_photo text;
  v_scan_code text := nullif(upper(btrim(coalesce(p_scan_code, ''))), '');
begin
  select * into d from public.districts where id = p_district;
  if not found then
    raise exception 'District "%" isn’t set up in this database.', p_district;
  end if;
  if char_length(v_title) < 3 then
    raise exception 'Give the problem a short title.';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the title under 120 characters.';
  end if;
  if char_length(v_description) > 2000 then
    raise exception 'Keep the description under 2,000 characters.';
  end if;
  if p_category is null or not (p_category = any (d.categories)) then
    raise exception 'Pick a category.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Pick a spot on the map.';
  end if;
  if not private.in_boundary(d.boundary, p_lat, p_lng) then
    raise exception 'That spot is outside the area % covers.', d.name;
  end if;
  if char_length(coalesce(p_location_label, '')) > 120 or char_length(coalesce(p_location_detail, '')) > 200
     or char_length(coalesce(p_via, '')) > 160 then
    raise exception 'Some of the details are too long. Shorten them and try again.';
  end if;
  if cardinality(v_photos) > 4 then
    raise exception 'Add up to 4 photos.';
  end if;
  -- Photos are object names in our bucket (the app turns them into URLs), uploaded by this device.
  foreach v_photo in array v_photos loop
    if v_photo !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'photos' and o.name = v_photo and o.owner_id = v_uid::text
       ) then
      raise exception 'Photos have to be uploaded through Problem Pins.';
    end if;
  end loop;
  if v_scan_code !~ '^[A-Z0-9][A-Z0-9-]{0,15}$' then
    raise exception 'That poster code isn’t valid.';
  end if;
  perform pg_advisory_xact_lock(hashtext('pp-rate:' || v_uid::text));
  if (select count(*) from public.issues where created_by = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You’ve pinned a lot in the last hour. Try again a bit later.';
  end if;

  insert into public.issues (
    district_id, title, description, category, lat, lng, location_label, location_detail,
    photos, via, scan_code, created_by
  ) values (
    p_district, v_title, v_description, p_category, p_lat, p_lng, coalesce(p_location_label, ''),
    nullif(btrim(coalesce(p_location_detail, '')), ''), v_photos, coalesce(p_via, ''),
    v_scan_code, v_uid
  )
  returning id into v_id;

  insert into public.votes (issue_id, user_id) values (v_id, v_uid);
  insert into public.follows (issue_id, user_id) values (v_id, v_uid);
  perform private.log(v_id, 'Pinned via ' || coalesce(p_via, 'the map'));
  return v_id;
end;
$$;

create function public.vote(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
begin
  -- One vote per device; a second one is ignored.
  insert into public.votes (issue_id, user_id) values (r.id, v_uid) on conflict do nothing;
end;
$$;

create function public.follow(p_issue text, p_email text default null, p_phone text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '');
begin
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254) then
    raise exception 'That email address doesn’t look right.';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then
    raise exception 'That phone number doesn’t look right.';
  end if;

  insert into public.follows (issue_id, user_id) values (r.id, v_uid) on conflict do nothing;
  if v_email is not null or v_phone is not null then
    insert into public.follow_contacts (issue_id, user_id, email, phone)
    values (r.id, v_uid, v_email, v_phone)
    on conflict (issue_id, user_id) do update
      set email = coalesce(excluded.email, public.follow_contacts.email),
          phone = coalesce(excluded.phone, public.follow_contacts.phone),
          created_at = now();
  end if;
end;
$$;

create function public.comment(p_issue text, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
  v_text text := btrim(coalesce(p_text, ''));
begin
  if v_text = '' then
    raise exception 'Write something first.';
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'Keep notes under 1,000 characters.';
  end if;
  perform pg_advisory_xact_lock(hashtext('pp-rate:' || v_uid::text));
  if (
    select count(*) from public.issue_updates
    where created_by = v_uid and role = 'resident' and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'You’ve added a lot of notes in the last hour. Try again a bit later.';
  end if;
  insert into public.issue_updates (issue_id, role, text, created_by)
  values (r.id, 'resident', v_text, v_uid);
end;
$$;

create function public.confirm_fix(p_issue text, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
begin
  if p_answer is null or p_answer not in ('yes', 'no') then
    raise exception 'Answer yes or no.';
  end if;
  if r.status <> 'fixed' then
    raise exception 'This hasn’t been marked fixed yet.';
  end if;
  insert into public.fix_confirmations (issue_id, user_id, answer)
  values (r.id, v_uid, p_answer)
  on conflict do nothing;
  if not found then
    return; -- one answer per device
  end if;
  perform private.log(
    r.id,
    case p_answer when 'yes' then 'A neighbor confirmed the fix' else 'A neighbor says it is still not fixed' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff

create function public.post_update(p_issue text, p_text text, p_status text default null)
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
    perform private.log(r.id, 'Status changed to ' || private.status_label(p_status));
  end if;
  insert into public.issue_updates (issue_id, role, author_name, text, created_by)
  values (r.id, 'partner', private.district_name(r.district_id), v_text, auth.uid());
end;
$$;

create function public.set_status(p_issue text, p_status text)
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
  perform private.log(
    r.id,
    case
      when p_status = 'fixed' then 'Marked fixed by ' || coalesce(r.owner, private.district_name(r.district_id))
      else 'Status changed to ' || private.status_label(p_status)
    end
  );
end;
$$;

create function public.assign(p_issue text, p_owner text)
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
  perform private.log(r.id, case when v_owner is null then 'Unassigned' else 'Assigned to ' || v_owner end);
end;
$$;

create function public.send_to_city(
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
  v_staff_name text;
begin
  if v_sr = '' then
    raise exception 'Enter the 311 service request number.';
  end if;
  if char_length(v_sr) > 40 or char_length(v_agency) > 80 then
    raise exception 'The SR number or agency is too long.';
  end if;
  v_routed_to := coalesce(nullif(btrim(coalesce(p_routed_to, '')), ''), v_agency);
  select s.name into v_staff_name from public.staff s
    where s.user_id = auth.uid() and s.district_id = r.district_id;

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
  perform private.log(r.id, 'Sent to NYC 311 · SR ' || v_sr);
  insert into public.issue_updates (issue_id, role, author_name, text, created_by)
  values (
    r.id, 'partner', private.district_name(r.district_id),
    format(
      'This is %s''s responsibility, so we filed it with 311 (SR %s) with %s attached. We''ll keep following up.',
      v_agency, v_sr, private.neighbors(private.vote_count(r.id))
    ),
    auth.uid()
  );
end;
$$;

create function public.nudge_city(p_issue text)
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
  perform private.log(r.id, format('Followed up with the City, %s attached', private.neighbors(private.vote_count(r.id))));
end;
$$;

create function public.hide_issue(p_issue text, p_reason text)
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
  perform private.log(r.id, case when v_reason = '' then 'Hidden by staff' else 'Hidden by staff: ' || v_reason end);
end;
$$;

create function public.unhide_issue(p_issue text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  update public.issues set hidden = false, hidden_reason = null where id = r.id;
  perform private.log(r.id, 'Restored by staff');
end;
$$;

-- Moves votes, follows and contacts from the duplicate onto `p_into` (a device that was on
-- both counts once), re-points earlier duplicates, and marks the duplicate as merged.
-- The duplicate stays readable so old links can redirect.
create function public.merge_issue(p_duplicate text, p_into text)
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

  perform private.log(target.id, format('Merged duplicate %s · %s', dup.id, private.neighbors(v_dup_votes)));
  perform private.log(dup.id, 'Merged into ' || target.id);
end;
$$;

-- Creates or updates a printed QR code. Retired codes can't come back: they are on old posters.
create function public.save_scan_point(
  p_district text,
  p_code text,
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_detail text default '',
  p_issue_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_district_staff(p_district);
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,15}$' then
    raise exception 'Use up to 16 letters, numbers and dashes for the code.';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'Give the spot a name (up to 120 characters).';
  end if;
  if char_length(coalesce(p_detail, '')) > 200 then
    raise exception 'Keep the detail under 200 characters.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Pick a spot on the map.';
  end if;
  if p_issue_id is not null
     and not exists (select 1 from public.issues where id = p_issue_id and district_id = p_district) then
    raise exception 'Problem % doesn’t exist.', p_issue_id;
  end if;
  if exists (
    select 1 from public.scan_points
    where district_id = p_district and code = v_code and retired_at is not null
  ) then
    raise exception 'Code % was used on an earlier poster. Pick a new code.', v_code;
  end if;

  insert into public.scan_points (district_id, code, name, detail, lat, lng, issue_id)
  values (p_district, v_code, v_name, btrim(coalesce(p_detail, '')), p_lat, p_lng, p_issue_id)
  on conflict (district_id, code) do update
    set name = excluded.name,
        detail = excluded.detail,
        lat = excluded.lat,
        lng = excluded.lng,
        issue_id = excluded.issue_id;
end;
$$;

create function public.delete_scan_point(p_district text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_district_staff(p_district);
  update public.scan_points
    set retired_at = now()
    where district_id = p_district and code = upper(btrim(coalesce(p_code, ''))) and retired_at is null;
end;
$$;

-- Analytics events since a New York date (inclusive), oldest first, 1000 per page.
-- Page with p_after_id = the last id of the previous page.
create function public.list_events(p_district text, p_since date default null, p_after_id bigint default 0)
returns table (id bigint, name text, issue_id text, scan_code text, props jsonb, at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_district_staff(p_district);
  return query
    select e.id, e.name, e.issue_id, e.scan_code, e.props, e.at
    from public.events e
    where e.district_id = p_district
      and e.id > coalesce(p_after_id, 0)
      and (p_since is null or e.at >= (p_since::timestamp at time zone 'America/New_York'))
    order by e.id
    limit 1000;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Functions are executable by PUBLIC by default; undo that.

revoke execute on all functions in schema private from public, anon, authenticated;

revoke execute on function
  public.get_snapshot(text),
  public.create_issue(text, text, text, double precision, double precision, text, text, text, text, text[], text),
  public.vote(text),
  public.follow(text, text, text),
  public.comment(text, text),
  public.confirm_fix(text, text),
  public.post_update(text, text, text),
  public.set_status(text, text),
  public.assign(text, text),
  public.send_to_city(text, text, text, text),
  public.nudge_city(text),
  public.hide_issue(text, text),
  public.unhide_issue(text),
  public.merge_issue(text, text),
  public.save_scan_point(text, text, text, double precision, double precision, text, text),
  public.delete_scan_point(text, text),
  public.list_events(text, date, bigint)
from public, anon;

-- Reading works even before the anonymous sign-in finishes (or if it is rate limited).
grant execute on function public.get_snapshot(text) to anon, authenticated;

grant execute on function
  public.create_issue(text, text, text, double precision, double precision, text, text, text, text, text[], text),
  public.vote(text),
  public.follow(text, text, text),
  public.comment(text, text),
  public.confirm_fix(text, text),
  public.post_update(text, text, text),
  public.set_status(text, text),
  public.assign(text, text),
  public.send_to_city(text, text, text, text),
  public.nudge_city(text),
  public.hide_issue(text, text),
  public.unhide_issue(text),
  public.merge_issue(text, text),
  public.save_scan_point(text, text, text, double precision, double precision, text, text),
  public.delete_scan_point(text, text),
  public.list_events(text, date, bigint)
to authenticated;
