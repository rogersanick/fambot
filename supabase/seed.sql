-- Local-dev seed. Applied by `supabase db reset`.

-- Deep-link base URL used by SQL-side composers (reminder cron).
insert into public.app_config (key, value)
values ('app_base_url', 'http://localhost:3000')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- The local-dev bridge. The bridge worker's .env carries the matching
-- plaintext secret (BRIDGE_SECRET=local-dev-bridge-secret).
insert into public.bridges (id, name, bot_handle, secret_hash, status, worker_version)
values (
  '00000000-0000-0000-0000-000000000001',
  'local-dev',
  'local-dev',
  encode(digest('local-dev-bridge-secret', 'sha256'), 'hex'),
  'active',
  '0.1.0'
)
on conflict (id) do update set
  secret_hash = excluded.secret_hash,
  status = excluded.status;
