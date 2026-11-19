-- Problem Pins: change pings over Realtime, and the photo bucket.

-- ---------------------------------------------------------------------------
-- Realtime. Any change to an issue or its records sends a content-free broadcast on
-- the private topic `district:<id>`. Clients reload their snapshot when it arrives, so
-- RLS decides what they see and nothing private travels over the socket.
-- One ping per district per transaction, however many rows changed.
-- Private, so that only this trigger can ping: signed-in devices may listen (policy below)
-- but there is no insert policy, so no client can send on these topics. Hosted projects
-- also turn off public channels (docs/BACKEND.md); otherwise anyone could make every open
-- app reload by broadcasting on a public channel.

create function private.ping_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_district text := v_row ->> 'district_id';
  v_sent text := coalesce(current_setting('pp.pinged', true), '');
begin
  if current_setting('pp.seeding', true) = 'on' then
    return null;
  end if;
  if v_district is null then
    select i.district_id into v_district from public.issues i where i.id = v_row ->> 'issue_id';
  end if;
  if v_district is null or position('|' || v_district || '|' in v_sent) > 0 then
    return null;
  end if;
  perform set_config('pp.pinged', v_sent || '|' || v_district || '|', true);
  perform realtime.send(jsonb_build_object('table', tg_table_name), 'change', 'district:' || v_district, true);
  return null;
end;
$$;

revoke execute on function private.ping_district() from public, anon, authenticated;

create trigger ping after insert or update or delete on public.issues
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.issue_updates
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.issue_history
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.votes
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.follows
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.fix_confirmations
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.city_requests
  for each row execute function private.ping_district();
create trigger ping after insert or update or delete on public.scan_points
  for each row execute function private.ping_district();

create policy "Signed-in devices hear district pings" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) like 'district:%');

-- ---------------------------------------------------------------------------
-- Photos. Public bucket: the photos are of public spaces, shown on a public map, and
-- the browser re-encodes them through a canvas first (no EXIF/GPS). URLs don't expire,
-- so a photo stays reachable by URL after its issue is hidden.
-- Devices upload flat, random names (`<uuid>.jpg`), at most 20 per hour. Storage records the
-- uploader in `owner_id`, so the public URL says nothing about which device took the photo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create function private.recent_uploads()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from storage.objects
  where bucket_id = 'photos'
    and owner_id = (select auth.uid())::text
    and created_at > now() - interval '1 hour';
$$;

revoke execute on function private.recent_uploads() from public, anon;
grant execute on function private.recent_uploads() to authenticated;

create policy "Devices upload photos under random names" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and owner_id = (select auth.uid())::text
    and private.recent_uploads() < 20
  );
