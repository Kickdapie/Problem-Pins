-- LOCAL ONLY. A demo staff account for the local stack, loaded by `npm run db:reset` (or
-- `npm run db:local-staff`) with `supabase db query --local`. It is deliberately not in
-- config.toml's seed paths. Never run this against a hosted project: the password is public.
--
--   email:    maya@westside.example
--   password: problem-pins-local
--
-- Real staff accounts are created as described in docs/BACKEND.md.

-- One statement (a DO block), because `supabase db query` runs a single command. Safe to rerun.
do $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    'a1b2c3d4-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'maya@westside.example',
    extensions.crypt('problem-pins-local', extensions.gen_salt('bf')),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (
    'a1b2c3d4-0000-4000-8000-000000000001',
    'a1b2c3d4-0000-4000-8000-000000000001',
    '{"sub": "a1b2c3d4-0000-4000-8000-000000000001", "email": "maya@westside.example", "email_verified": true}',
    'email',
    now(),
    now()
  ) on conflict do nothing;

  insert into public.staff (user_id, district_id, name, role)
  values ('a1b2c3d4-0000-4000-8000-000000000001', 'west-side-demo', 'Maya Ruiz', 'Community Coordinator')
  on conflict do nothing;
end
$$;
