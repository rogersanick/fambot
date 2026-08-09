-- FamBot initial schema.
-- Tenant boundary: household_id. Channels map many-to-one to households.
-- Portal access goes through RLS; the bridge and agent go through edge
-- functions using the service role. anon has zero access everywhere.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- ────────────────────────────────────────────────────────────────────
-- Helpers
-- ────────────────────────────────────────────────────────────────────

-- Lowercase-alphanumeric nanoid used for household slugs (8) and
-- task/event short codes (6). 36^6 ≈ 2.2B per household — collision
-- risk is negligible and uniqueness is still enforced by constraints.
create or replace function public.fambot_nanoid(size int default 8)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  id text := '';
  bytes bytea := gen_random_bytes(size);
  i int;
begin
  for i in 0 .. size - 1 loop
    id := id || substr(alphabet, (get_byte(bytes, i) % 36) + 1, 1);
  end loop;
  return id;
end;
$$;

-- Small key/value store so SQL-side composers (the reminder cron) can
-- build deep links without access to edge-function env vars.
create table public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────
-- Transport: bridges and channels
-- ────────────────────────────────────────────────────────────────────

create table public.bridges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bot_handle text unique,
  secret_hash text not null,          -- sha256 hex of the bearer secret
  status text not null default 'provisioning'
    check (status in ('provisioning', 'active', 'disabled')),
  last_seen_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  macos_version text,
  bluebubbles_version text,
  worker_version text,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default public.fambot_nanoid(8),
  display_name text,
  invocation_name text not null default 'fambot',
  timezone text,                      -- IANA; household inactive until set
  state text not null default 'pending_setup'
    check (state in ('pending_setup', 'active', 'stopped')),
  quiet_hours_start time,
  quiet_hours_end time,
  morning_default time not null default '09:00',
  afternoon_default time not null default '15:00',
  evening_default time not null default '18:00',
  before_event_offset_minutes int not null default 60,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  stopped_at timestamptz
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id),  -- null until setup
  bridge_id uuid not null references public.bridges(id),
  channel_type text not null default 'imessage_group'
    check (channel_type in ('imessage_group', 'imessage_dm', 'sms')),
  chat_guid text not null,
  state text not null default 'pending_setup'
    check (state in ('pending_setup', 'active', 'stopped')),
  created_at timestamptz not null default now(),
  unique (bridge_id, chat_guid)
);

create index channels_household_idx on public.channels (household_id);

-- ────────────────────────────────────────────────────────────────────
-- People
-- ────────────────────────────────────────────────────────────────────

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  normalized_handle text not null,    -- phone/email as seen on iMessage
  display_name text,
  aliases text[] not null default '{}',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  removed_at timestamptz,
  unique (household_id, normalized_handle)
);

create table public.member_links (
  auth_user_id uuid not null references auth.users(id),
  member_id uuid not null references public.members(id),
  household_id uuid not null references public.households(id),
  linked_at timestamptz not null default now(),
  primary key (auth_user_id, member_id)
);

create index member_links_user_idx on public.member_links (auth_user_id);

create table public.link_codes (
  code text primary key,
  member_id uuid not null references public.members(id),
  household_id uuid not null references public.households(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────
-- Ingestion
-- ────────────────────────────────────────────────────────────────────

create table public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.bridges(id),
  channel_id uuid references public.channels(id),
  household_id uuid references public.households(id),
  message_guid text not null,
  chat_guid text not null,
  sender_handle text not null,
  message_text text not null,
  received_at timestamptz not null default now(),
  invoked_bot boolean not null default true,
  processing_state text not null default 'received'
    check (processing_state in ('received', 'processing', 'done', 'failed', 'ignored')),
  raw_metadata jsonb,
  error_code text,
  unique (bridge_id, message_guid)    -- idempotency level 1
);

create index inbound_messages_household_idx
  on public.inbound_messages (household_id, received_at desc);

create table public.bot_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id),
  inbound_message_id uuid references public.inbound_messages(id),
  model_provider text,
  model_identifier text,
  prompt_version text,
  structured_output jsonb,
  validation_result jsonb,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  state text not null default 'started'
    check (state in ('started', 'succeeded', 'validation_failed', 'llm_error', 'executor_error')),
  error_code text,
  created_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────
-- Domain: tasks, events, reminders, clarifications
-- ────────────────────────────────────────────────────────────────────

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  short_code text not null default public.fambot_nanoid(6),
  title text not null,
  notes text,
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),  -- deletes are soft
  assignee_member_id uuid references public.members(id),
  created_by_member_id uuid references public.members(id),
  due_at timestamptz,
  source_message_id uuid references public.inbound_messages(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, short_code)
);

create index tasks_household_status_idx on public.tasks (household_id, status, due_at);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  short_code text not null default public.fambot_nanoid(6),
  title text not null,
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  location text,
  created_by_member_id uuid references public.members(id),
  source_message_id uuid references public.inbound_messages(id),
  status text not null default 'active'
    check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, short_code),
  check (ends_at is null or ends_at > starts_at)
);

create index events_household_starts_idx on public.events (household_id, starts_at);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  task_id uuid references public.tasks(id),
  event_id uuid references public.events(id),
  assignee_member_id uuid references public.members(id),
  fire_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'enqueued', 'delivered', 'cancelled')),
  dedupe_key text not null unique,    -- idempotency level 3
  enqueued_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(task_id, event_id) = 1)
);

create index reminders_due_idx on public.reminders (state, fire_at);

create table public.pending_clarifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  requester_member_id uuid references public.members(id),
  draft_action jsonb not null,
  missing_field text not null,
  question_text text not null,
  state text not null default 'open'
    check (state in ('open', 'answered', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  resolved_at timestamptz
);

-- At most one open clarification per household.
create unique index pending_clarifications_one_open_idx
  on public.pending_clarifications (household_id)
  where state = 'open';

-- ────────────────────────────────────────────────────────────────────
-- Outbox and audit
-- ────────────────────────────────────────────────────────────────────

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references public.bridges(id),
  channel_id uuid references public.channels(id),
  household_id uuid references public.households(id),
  chat_guid text not null,
  message_type text not null
    check (message_type in ('confirmation', 'clarification', 'reminder', 'onboarding', 'system')),
  message_text text not null,
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'sent', 'retry', 'suppressed', 'failed')),
  dedupe_key text not null unique,    -- idempotency level 2
  not_before timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index outbox_pending_idx on public.outbox (bridge_id, state, created_at);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  actor_type text not null
    check (actor_type in ('member', 'bot', 'portal', 'system')),
  actor_member_id uuid references public.members(id),
  inbound_message_id uuid references public.inbound_messages(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_household_idx on public.audit_log (household_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────
-- Audit triggers
-- Bot mutations (service role) set transaction-locals via set_config;
-- portal mutations are attributed through auth.uid() → member_links.
-- ────────────────────────────────────────────────────────────────────

create or replace function public.audit_domain_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := nullif(current_setting('fambot.actor_type', true), '');
  v_actor_member uuid := nullif(current_setting('fambot.actor_member_id', true), '')::uuid;
  v_inbound uuid := nullif(current_setting('fambot.inbound_message_id', true), '')::uuid;
  v_household uuid := coalesce(new.household_id, old.household_id);
  v_action text;
begin
  if v_actor_type is null then
    if auth.uid() is not null then
      v_actor_type := 'portal';
      select member_id into v_actor_member
        from public.member_links
       where auth_user_id = auth.uid() and household_id = v_household
       limit 1;
    else
      v_actor_type := 'system';
    end if;
  end if;

  v_action := case tg_op when 'INSERT' then 'create' else 'update' end;
  -- Surface soft-delete/complete transitions as first-class actions.
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    v_action := case new.status
      when 'cancelled' then 'cancel'
      when 'done' then 'complete'
      when 'open' then 'reopen'
      when 'active' then 'reactivate'
      else 'update'
    end;
  end if;

  insert into public.audit_log
    (household_id, actor_type, actor_member_id, inbound_message_id,
     action, entity_type, entity_id, before_state, after_state)
  values
    (v_household, v_actor_type, v_actor_member, v_inbound,
     v_action, tg_table_name::text, new.id,
     case when tg_op = 'UPDATE' then to_jsonb(old) end,
     to_jsonb(new));

  return new;
end;
$$;

create trigger tasks_audit
  after insert or update on public.tasks
  for each row execute function public.audit_domain_change();

create trigger events_audit
  after insert or update on public.events
  for each row execute function public.audit_domain_change();

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────

alter table public.app_config enable row level security;
alter table public.bridges enable row level security;
alter table public.households enable row level security;
alter table public.channels enable row level security;
alter table public.members enable row level security;
alter table public.member_links enable row level security;
alter table public.link_codes enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.bot_runs enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.reminders enable row level security;
alter table public.pending_clarifications enable row level security;
alter table public.outbox enable row level security;
alter table public.audit_log enable row level security;

-- Transport tables: service role only. Belt and braces beyond RLS.
revoke all on public.app_config, public.bridges, public.channels,
  public.link_codes, public.inbound_messages, public.bot_runs,
  public.pending_clarifications, public.outbox
  from anon, authenticated;

-- anon gets nothing anywhere.
revoke all on public.households, public.members, public.member_links,
  public.tasks, public.events, public.reminders, public.audit_log
  from anon;

-- The portal's grants (rows still filtered by the RLS policies below).
grant select on public.households, public.members, public.member_links,
  public.tasks, public.events, public.reminders, public.audit_log
  to authenticated;
grant insert, update on public.tasks, public.events to authenticated;

-- member_links: users see only their own links (no recursion risk).
create policy member_links_self_select on public.member_links
  for select to authenticated
  using (auth_user_id = auth.uid());

-- Household-scoped SELECT for the portal.
create policy households_member_select on public.households
  for select to authenticated
  using (id in (select household_id from public.member_links
                where auth_user_id = auth.uid()));

create policy members_member_select on public.members
  for select to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()));

create policy tasks_member_select on public.tasks
  for select to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()));

create policy tasks_member_insert on public.tasks
  for insert to authenticated
  with check (household_id in (select household_id from public.member_links
                               where auth_user_id = auth.uid()));

create policy tasks_member_update on public.tasks
  for update to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()))
  with check (household_id in (select household_id from public.member_links
                               where auth_user_id = auth.uid()));

create policy events_member_select on public.events
  for select to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()));

create policy events_member_insert on public.events
  for insert to authenticated
  with check (household_id in (select household_id from public.member_links
                               where auth_user_id = auth.uid()));

create policy events_member_update on public.events
  for update to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()))
  with check (household_id in (select household_id from public.member_links
                               where auth_user_id = auth.uid()));

create policy reminders_member_select on public.reminders
  for select to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()));

create policy audit_member_select on public.audit_log
  for select to authenticated
  using (household_id in (select household_id from public.member_links
                          where auth_user_id = auth.uid()));

-- ────────────────────────────────────────────────────────────────────
-- Portal RPCs (security definer; each verifies membership itself)
-- ────────────────────────────────────────────────────────────────────

-- Household settings are updated only through this RPC so the portal
-- can never touch state/slug/lifecycle columns directly.
create or replace function public.update_household_settings(
  p_household_id uuid,
  p_display_name text default null,
  p_invocation_name text default null,
  p_timezone text default null,
  p_quiet_hours_start time default null,
  p_quiet_hours_end time default null,
  p_morning_default time default null,
  p_afternoon_default time default null,
  p_evening_default time default null,
  p_before_event_offset_minutes int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.member_links
    where auth_user_id = auth.uid() and household_id = p_household_id
  ) then
    raise exception 'not a member of this household';
  end if;

  if p_invocation_name is not null
     and p_invocation_name !~ '^[a-zA-Z]{2,20}$' then
    raise exception 'invocation name must be a single word of 2-20 letters';
  end if;

  if p_timezone is not null and not exists (
    select 1 from pg_timezone_names where name = p_timezone
  ) then
    raise exception 'invalid timezone';
  end if;

  update public.households set
    display_name = coalesce(p_display_name, display_name),
    invocation_name = coalesce(lower(p_invocation_name), invocation_name),
    timezone = coalesce(p_timezone, timezone),
    quiet_hours_start = coalesce(p_quiet_hours_start, quiet_hours_start),
    quiet_hours_end = coalesce(p_quiet_hours_end, quiet_hours_end),
    morning_default = coalesce(p_morning_default, morning_default),
    afternoon_default = coalesce(p_afternoon_default, afternoon_default),
    evening_default = coalesce(p_evening_default, evening_default),
    before_event_offset_minutes = coalesce(p_before_event_offset_minutes, before_event_offset_minutes)
  where id = p_household_id;
end;
$$;

-- Redeem a one-time "@fambot link" code for the signed-in user.
create or replace function public.redeem_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.link_codes;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_row
    from public.link_codes
   where code = lower(p_code)
   for update;

  if v_row.code is null or v_row.used_at is not null or v_row.expires_at < now() then
    raise exception 'invalid or expired code';
  end if;

  insert into public.member_links (auth_user_id, member_id, household_id)
  values (auth.uid(), v_row.member_id, v_row.household_id)
  on conflict do nothing;

  update public.link_codes set used_at = now() where code = v_row.code;

  select slug into v_slug from public.households where id = v_row.household_id;
  return jsonb_build_object('household_slug', v_slug);
end;
$$;

-- On first sign-in: link automatically when the auth email matches a
-- member handle. Returns linked household slugs.
create or replace function public.auto_link_member_by_email()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return;
  end if;

  insert into public.member_links (auth_user_id, member_id, household_id)
  select auth.uid(), m.id, m.household_id
    from public.members m
   where lower(m.normalized_handle) = lower(v_email)
     and m.removed_at is null
  on conflict do nothing;

  return query
    select h.slug from public.households h
    where h.id in (select household_id from public.member_links
                   where auth_user_id = auth.uid());
end;
$$;

grant execute on function public.update_household_settings to authenticated;
grant execute on function public.redeem_link_code to authenticated;
grant execute on function public.auto_link_member_by_email to authenticated;
revoke execute on function public.update_household_settings from anon;
revoke execute on function public.redeem_link_code from anon;
revoke execute on function public.auto_link_member_by_email from anon;

-- ────────────────────────────────────────────────────────────────────
-- Scheduling functions
-- ────────────────────────────────────────────────────────────────────

-- Runs every minute. Selects due reminders, aggregates per channel any
-- others due within the following 5 minutes, defers delivery during
-- quiet hours, and inserts idempotent outbox rows.
create or replace function public.enqueue_due_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url text;
  grp record;
  v_text text;
  v_link text;
  v_not_before timestamptz;
  v_count int;
begin
  select value into v_base_url from public.app_config where key = 'app_base_url';
  v_base_url := coalesce(v_base_url, 'http://localhost:3000');

  for grp in
    with due as (
      select r.id, r.household_id, r.task_id, r.event_id, r.fire_at,
             r.assignee_member_id
        from public.reminders r
        join public.households h on h.id = r.household_id
       where r.state = 'pending'
         and h.state = 'active'
         and (
           r.fire_at <= now()
           or (r.fire_at <= now() + interval '5 minutes'
               and exists (
                 select 1 from public.reminders r2
                  where r2.state = 'pending'
                    and r2.household_id = r.household_id
                    and r2.fire_at <= now()))
         )
       order by r.fire_at
       for update of r skip locked
    )
    select d.household_id,
           array_agg(d.id order by d.fire_at, d.id) as reminder_ids
      from due d
     group by d.household_id
  loop
    declare
      v_household public.households;
      v_channel public.channels;
      v_lines text[] := '{}';
      r record;
    begin
      select * into v_household from public.households where id = grp.household_id;

      select * into v_channel
        from public.channels
       where household_id = grp.household_id and state = 'active'
       order by created_at
       limit 1;

      if v_channel.id is null then
        continue;
      end if;

      v_count := array_length(grp.reminder_ids, 1);

      for r in
        select rem.id,
               coalesce(m.display_name, m.normalized_handle) as who,
               coalesce(t.title, e.title) as title,
               t.short_code as task_code,
               e.short_code as event_code,
               rem.fire_at
          from public.reminders rem
          left join public.members m on m.id = rem.assignee_member_id
          left join public.tasks t on t.id = rem.task_id
          left join public.events e on e.id = rem.event_id
         where rem.id = any (grp.reminder_ids)
         order by rem.fire_at, rem.id
      loop
        if v_count = 1 then
          v_text := 'Reminder' || case when r.who is not null then ' for ' || r.who else '' end
                    || ': ' || r.title || '.';
          if r.task_code is not null then
            v_link := v_base_url || '/h/' || v_household.slug || '/k/' || r.task_code;
          else
            v_link := v_base_url || '/h/' || v_household.slug || '/calendar';
          end if;
        else
          v_lines := v_lines || ('• ' ||
            case when r.who is not null then r.who || ': ' else '' end || r.title);
        end if;
      end loop;

      if v_count > 1 then
        v_text := 'Reminders:' || E'\n' || array_to_string(v_lines, E'\n');
        v_link := v_base_url || '/h/' || v_household.slug || '/today';
      end if;

      v_text := v_text || E'\n' || v_link;

      -- Quiet hours: defer to the end of the window (handles wrap past midnight).
      v_not_before := null;
      if v_household.quiet_hours_start is not null
         and v_household.quiet_hours_end is not null
         and v_household.timezone is not null then
        declare
          v_local_now timestamptz := now();
          v_local_time time := (now() at time zone v_household.timezone)::time;
          v_in_quiet boolean;
        begin
          if v_household.quiet_hours_start <= v_household.quiet_hours_end then
            v_in_quiet := v_local_time >= v_household.quiet_hours_start
                      and v_local_time < v_household.quiet_hours_end;
          else
            v_in_quiet := v_local_time >= v_household.quiet_hours_start
                       or v_local_time < v_household.quiet_hours_end;
          end if;
          if v_in_quiet then
            v_not_before :=
              ((now() at time zone v_household.timezone)::date + v_household.quiet_hours_end)
                at time zone v_household.timezone;
            if v_not_before <= now() then
              v_not_before := v_not_before + interval '1 day';
            end if;
          end if;
        end;
      end if;

      insert into public.outbox
        (bridge_id, channel_id, household_id, chat_guid, message_type,
         message_text, dedupe_key, not_before)
      values
        (v_channel.bridge_id, v_channel.id, grp.household_id, v_channel.chat_guid,
         'reminder', v_text, 'reminder:' || grp.reminder_ids[1]::text, v_not_before)
      on conflict (dedupe_key) do nothing;

      update public.reminders
         set state = 'enqueued', enqueued_at = now()
       where id = any (grp.reminder_ids);
    end;
  end loop;
end;
$$;

-- Expire clarifications past their 24h window.
create or replace function public.expire_clarifications()
returns void
language sql
security definer
set search_path = public
as $$
  update public.pending_clarifications
     set state = 'expired', resolved_at = now()
   where state = 'open' and expires_at < now();
$$;

-- Return leased-but-unacknowledged outbox rows to the pool.
create or replace function public.release_expired_outbox_leases()
returns void
language sql
security definer
set search_path = public
as $$
  update public.outbox
     set state = 'pending', lease_owner = null, lease_expires_at = null
   where state = 'leased' and lease_expires_at < now();
$$;

select cron.schedule('fambot-enqueue-reminders', '* * * * *',
  $$select public.enqueue_due_reminders()$$);
select cron.schedule('fambot-expire-clarifications', '* * * * *',
  $$select public.expire_clarifications()$$);
select cron.schedule('fambot-release-leases', '* * * * *',
  $$select public.release_expired_outbox_leases()$$);
