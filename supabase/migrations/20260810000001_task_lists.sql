-- Named todo lists (e.g. "Costco", "Weekend chores"). Tasks may belong to a
-- list; list_id null means the household's General list. Deleting a list
-- moves its tasks to General rather than deleting them.

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One "Costco" per household, case-insensitively.
create unique index lists_household_name_key on public.lists (household_id, lower(name));

alter table public.tasks
  add column list_id uuid references public.lists(id) on delete set null;

create index tasks_list_idx on public.tasks (list_id);

alter table public.lists enable row level security;

create policy lists_all on public.lists
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

grant select, insert, update, delete on public.lists to authenticated;
