-- Problem Pins: get_changes answers "load everything again" instead of guessing.
--
-- - The cursor now also says whether it was read as staff (`<xid>:s` or `<xid>:r`). If that changed
--   while the same user stayed signed in (a `staff` row added or removed by an admin), the issues
--   the app holds were built for the other kind of viewer: hidden issues and staff-only fields would
--   stay on a former staff member's screen until each issue changed. get_changes then returns
--   `{ "reload": true }` and the app loads a whole snapshot (which applies the new rights).
-- - A cursor it can't read gets the same answer instead of an error, which the app showed as a
--   toast after a mutation that had in fact been saved.
-- Who the viewer is (user id) is still checked by the app, which knows it without asking.

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
    'cursor', v_cursor::text || case when v_staff then ':s' else ':r' end,
    'today', (now() at time zone 'America/New_York')::date
  );
end;
$$;

create or replace function public.get_changes(p_district text, p_since text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cursor xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_uid uuid := auth.uid();
  v_staff boolean := private.is_staff(p_district);
  v_since xid8;
  v_district jsonb;
  v_changed text[];
  v_removed text[];
begin
  -- (SIMILAR TO matches the whole string.)
  if coalesce(p_since, '') not similar to '[0-9]{1,20}:[sr]'
     or split_part(p_since, ':', 2) <> (case when v_staff then 's' else 'r' end) then
    return jsonb_build_object('reload', true);
  end if;
  v_since := split_part(p_since, ':', 1)::xid8;

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
    'cursor', v_cursor::text || case when v_staff then ':s' else ':r' end,
    'today', (now() at time zone 'America/New_York')::date
  );
end;
$$;
