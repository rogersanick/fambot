-- FamBot v2: minimal household schema. Six tables, RLS as the only
-- authorization layer (the MCP server and portal both act as the signed-in
-- Supabase user), one security-definer RPC to bootstrap a household.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member', 'agent')),
  -- Normalized iMessage handle (lowercased phone/email) for sender matching.
  handle text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index members_household_handle_key
  on public.members (household_id, handle) where handle is not null;
create unique index members_household_user_key
  on public.members (household_id, user_id) where user_id is not null;

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  chat_guid text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assignee_id uuid references public.members(id) on delete set null,
  due_at timestamptz,
  created_by uuid references public.members(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_household_status_idx on public.tasks (household_id, status);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_household_starts_idx on public.events (household_id, starts_at);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  message text not null,
  fire_at timestamptz not null,
  -- Delivery target. Null => portal-only reminder (never sent over iMessage).
  channel_id uuid references public.channels(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  task_id uuid references public.tasks(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  sent_at timestamptz,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index reminders_due_idx on public.reminders (status, fire_at);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_touch_updated_at before update on public.tasks
  for each row execute function public.touch_updated_at();
create trigger events_touch_updated_at before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Security definer so policies on `members` can consult `members` without
-- recursing through RLS.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.channels   enable row level security;
alter table public.tasks      enable row level security;
alter table public.events     enable row level security;
alter table public.reminders  enable row level security;

create policy households_select on public.households
  for select to authenticated using (public.is_household_member(id));
create policy households_update on public.households
  for update to authenticated using (public.is_household_member(id));
-- No direct insert: household creation goes through setup_household().

create policy members_select on public.members
  for select to authenticated using (public.is_household_member(household_id));
create policy members_insert on public.members
  for insert to authenticated with check (public.is_household_member(household_id));
create policy members_update on public.members
  for update to authenticated using (public.is_household_member(household_id));

create policy channels_select on public.channels
  for select to authenticated using (public.is_household_member(household_id));
create policy channels_insert on public.channels
  for insert to authenticated with check (public.is_household_member(household_id));
create policy channels_update on public.channels
  for update to authenticated using (public.is_household_member(household_id));
create policy channels_delete on public.channels
  for delete to authenticated using (public.is_household_member(household_id));

create policy tasks_all on public.tasks
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy events_all on public.events
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy reminders_all on public.reminders
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Data API grants (new tables are not auto-exposed).
grant select, insert, update, delete
  on public.households, public.members, public.channels,
     public.tasks, public.events, public.reminders
  to authenticated;

-- ---------------------------------------------------------------------------
-- setup_household: bootstrap RPC (avoids the RLS chicken-and-egg on first
-- insert). The caller becomes a member of the new household; agents pass
-- role 'agent', humans 'owner'.
-- ---------------------------------------------------------------------------

create or replace function public.setup_household(
  p_name text,
  p_timezone text default 'America/New_York',
  p_display_name text default null,
  p_role text default 'owner',
  p_chat_guid text default null,
  p_chat_name text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid;
  v_display text := p_display_name;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_role not in ('owner', 'agent') then
    raise exception 'role must be owner or agent';
  end if;

  if v_display is null then
    if p_role = 'agent' then
      v_display := 'FamBot';
    else
      select coalesce(split_part(email, '@', 1), 'Owner') into v_display
        from auth.users where id = v_uid;
    end if;
  end if;

  insert into households (name, timezone) values (p_name, p_timezone)
    returning id into v_household;

  insert into members (household_id, display_name, role, user_id)
    values (v_household, v_display, p_role, v_uid);

  if p_chat_guid is not null then
    insert into channels (household_id, chat_guid, name)
      values (v_household, p_chat_guid, p_chat_name);
  end if;

  return v_household;
end;
$$;

revoke all on function public.setup_household(text, text, text, text, text, text) from public, anon;
grant execute on function public.setup_household(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_member_with_email: invite an existing auth user (human or agent) into a
-- household by email. Security definer because members can't read auth.users.
-- ---------------------------------------------------------------------------

create or replace function public.add_member_with_email(
  p_household_id uuid,
  p_display_name text,
  p_email text,
  p_role text default 'member',
  p_handle text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_member uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household';
  end if;
  if p_role not in ('owner', 'member', 'agent') then
    raise exception 'invalid role';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'no account with email %', p_email;
  end if;

  insert into members (household_id, display_name, role, handle, user_id)
    values (p_household_id, p_display_name, p_role, nullif(lower(trim(p_handle)), ''), v_user)
    on conflict (household_id, user_id) where user_id is not null
    do update set display_name = excluded.display_name, role = excluded.role
    returning id into v_member;

  return v_member;
end;
$$;

revoke all on function public.add_member_with_email(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_member_with_email(uuid, text, text, text, text) to authenticated;
