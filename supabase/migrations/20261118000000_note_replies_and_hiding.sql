-- Problem Pins: one level of replies under neighbors' notes, and staff can hide a note or reply.
--
-- - `issue_updates.reply_to` points at the neighbor's note a row answers. Only one level: a reply
--   to a reply is stored under the same note (private.note_root). Deleting a note deletes its
--   replies (on delete cascade), and the person deleting it is told so.
-- - Neighbors reply with `comment(p_issue, p_text, p_reply_to)`: the same checks and hourly limit
--   as a note. Calls without `p_reply_to` work as before.
-- - Staff reply with `reply_to_note`: a district row under the note. It is not a district update:
--   the resident page keeps the last update on the status card and shows the reply under the note.
-- - Staff hide a neighbor's note or reply with `hide_note` and show it again with `unhide_note`.
--   Hidden, not deleted: the row stays, with who hid it (`hidden_by_name`, staff only). Neighbors
--   get the row without its text, so a hidden note with replies can leave a line in its place;
--   the device that wrote it still gets the text and sees that it was hidden. A hidden note takes
--   no new replies.
-- - issues_json returns `reply_to`, `hidden` and (for staff) `hidden_by` with each row.

alter table public.issue_updates
  add column reply_to uuid references public.issue_updates (id) on delete cascade;

create index issue_updates_reply_to_idx on public.issue_updates (reply_to) where reply_to is not null;

alter table public.issue_updates
  add column hidden_at timestamptz,
  add column hidden_by_name text;

-- The neighbor's note a reply goes under: the note itself, or the note the given reply answers.
create function private.note_root(p_issue text, p_note uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_root uuid;
begin
  select coalesce(u.reply_to, u.id) into v_root
    from public.issue_updates u
    where u.id = p_note and u.issue_id = p_issue and (u.reply_to is not null or u.role = 'resident');
  if v_root is null then
    raise exception 'That note was deleted.';
  end if;
  if exists (select 1 from public.issue_updates u where u.id = v_root and u.hidden_at is not null) then
    raise exception 'The district office hid that note, so it can’t take replies.';
  end if;
  return v_root;
end;
$$;

drop function public.comment(text, text);

create function public.comment(p_issue text, p_text text, p_reply_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  r public.issues := private.get_open_issue(p_issue);
  v_text text := btrim(coalesce(p_text, ''));
  v_root uuid;
begin
  if v_text = '' then
    raise exception 'Write something first.';
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'Keep notes under 1,000 characters.';
  end if;
  if p_reply_to is not null then
    v_root := private.note_root(r.id, p_reply_to);
  end if;
  perform pg_advisory_xact_lock(hashtext('pp-rate:' || v_uid::text));
  if (
    select count(*) from public.issue_updates
    where created_by = v_uid and role = 'resident' and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'You’ve added a lot of notes in the last hour. Try again a bit later.';
  end if;
  insert into public.issue_updates (issue_id, role, text, created_by, reply_to)
  values (r.id, 'resident', v_text, v_uid, v_root);
end;
$$;

create function public.reply_to_note(p_issue text, p_note uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
  v_text text := btrim(coalesce(p_text, ''));
  v_root uuid := private.note_root(r.id, p_note);
begin
  if v_text = '' then
    raise exception 'Write the reply first.';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'Keep replies under 2,000 characters.';
  end if;
  insert into public.issue_updates (issue_id, role, author_name, text, created_by, staff_name, reply_to)
  values (r.id, 'partner', private.district_name(r.district_id), v_text, auth.uid(), private.staff_name(r.district_id), v_root);
end;
$$;

-- A neighbor's note or reply only: district posts are edited by posting again, not hidden.
create function public.hide_note(p_issue text, p_note uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  update public.issue_updates
    set hidden_at = coalesce(hidden_at, now()),
        hidden_by_name = coalesce(hidden_by_name, private.staff_name(r.district_id))
    where id = p_note and issue_id = r.id and role = 'resident';
  if not found then
    raise exception 'That note was deleted.';
  end if;
end;
$$;

create function public.unhide_note(p_issue text, p_note uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.issues := private.require_staff(p_issue);
begin
  update public.issue_updates
    set hidden_at = null, hidden_by_name = null
    where id = p_note and issue_id = r.id and role = 'resident';
  if not found then
    raise exception 'That note was deleted.';
  end if;
end;
$$;

revoke execute on function private.note_root(text, uuid) from public, anon, authenticated;
revoke execute on function
  public.comment(text, text, uuid),
  public.reply_to_note(text, uuid, text),
  public.hide_note(text, uuid),
  public.unhide_note(text, uuid)
from public, anon;
grant execute on function
  public.comment(text, text, uuid),
  public.reply_to_note(text, uuid, text),
  public.hide_note(text, uuid),
  public.unhide_note(text, uuid)
to authenticated;

create or replace function private.issues_json(p_district text, p_uid uuid, p_staff boolean, p_ids text[])
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
        -- A hidden note's words reach only staff and the device that wrote it.
        'text', case
          when u.hidden_at is null or p_staff or (p_uid is not null and u.created_by = p_uid) then u.text
          else ''
        end,
        'created_at', u.created_at,
        'mine', u.role = 'resident' and p_uid is not null and u.created_by = p_uid,
        'staff_name', case when p_staff then u.staff_name end,
        'reply_to', u.reply_to,
        'hidden', u.hidden_at is not null,
        'hidden_by', case when p_staff then u.hidden_by_name end
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
