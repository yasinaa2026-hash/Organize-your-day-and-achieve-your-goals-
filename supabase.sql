-- وقتي | Supabase database setup
-- 1) Run this file in Supabase Dashboard > SQL Editor.
-- 2) Enable Authentication > Providers > Anonymous Sign-Ins.
-- 3) Use only the project URL and public publishable/anon key in the app.
-- Never expose a service_role or secret key in browser code.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{4,10}$'),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.room_tasks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 90),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, room_id)
);

create table if not exists public.task_completions (
  task_id uuid not null,
  room_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (task_id, room_id) references public.room_tasks(id, room_id) on delete cascade
);

create index if not exists room_tasks_room_id_idx on public.room_tasks(room_id);
create index if not exists task_completions_room_id_idx on public.task_completions(room_id);

-- Membership helper: SECURITY DEFINER prevents recursive RLS evaluation.
create or replace function public.is_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = target_room and user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_tasks enable row level security;
alter table public.task_completions enable row level security;

drop policy if exists "Members can read their rooms" on public.rooms;
create policy "Members can read their rooms" on public.rooms
for select to authenticated using (public.is_room_member(id));

drop policy if exists "Members can read room members" on public.room_members;
create policy "Members can read room members" on public.room_members
for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "Members can read room tasks" on public.room_tasks;
create policy "Members can read room tasks" on public.room_tasks
for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "Members can add room tasks" on public.room_tasks;
create policy "Members can add room tasks" on public.room_tasks
for insert to authenticated
with check (created_by = auth.uid() and public.is_room_member(room_id));

drop policy if exists "Members can read task completions" on public.task_completions;
create policy "Members can read task completions" on public.task_completions
for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "Members can complete their own tasks" on public.task_completions;
create policy "Members can complete their own tasks" on public.task_completions
for insert to authenticated
with check (user_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists "Members can undo their own completions" on public.task_completions;
create policy "Members can undo their own completions" on public.task_completions
for delete to authenticated
using (user_id = auth.uid() and public.is_room_member(room_id));

-- Room creation inserts both the room and its owner membership atomically.
create or replace function public.create_room(p_code text, p_name text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول إلى الغرفة أولاً';
  end if;
  if p_code !~ '^[A-Z0-9-]{4,10}$' then
    raise exception 'رمز الغرفة غير صالح';
  end if;
  if char_length(trim(p_name)) not between 1 and 40 then
    raise exception 'اسم الغرفة غير صالح';
  end if;
  if char_length(trim(p_display_name)) not between 1 and 24 then
    raise exception 'اسم العرض غير صالح';
  end if;

  insert into public.rooms(code, name, owner_id)
  values (upper(p_code), trim(p_name), auth.uid())
  returning * into new_room;

  insert into public.room_members(room_id, user_id, display_name)
  values (new_room.id, auth.uid(), trim(p_display_name));

  return jsonb_build_object(
    'id', new_room.id,
    'code', new_room.code,
    'name', new_room.name,
    'owner_id', new_room.owner_id
  );
end;
$$;

-- Join by code; the room is only visible after membership has been created.
create or replace function public.join_room_by_code(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  found_room public.rooms;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول إلى الغرفة أولاً';
  end if;
  if char_length(trim(p_display_name)) not between 1 and 24 then
    raise exception 'اسم العرض غير صالح';
  end if;

  select * into found_room
  from public.rooms
  where code = upper(trim(p_code));

  if found_room.id is null then
    raise exception 'لم يتم العثور على غرفة بهذا الرمز';
  end if;

  insert into public.room_members(room_id, user_id, display_name)
  values (found_room.id, auth.uid(), trim(p_display_name))
  on conflict (room_id, user_id)
  do update set display_name = excluded.display_name;

  return jsonb_build_object(
    'id', found_room.id,
    'code', found_room.code,
    'name', found_room.name,
    'owner_id', found_room.owner_id
  );
end;
$$;

revoke all on function public.create_room(text, text, text) from public;
revoke all on function public.join_room_by_code(text, text) from public;
grant execute on function public.create_room(text, text, text) to authenticated;
grant execute on function public.join_room_by_code(text, text) to authenticated;

grant usage on schema public to authenticated;
grant select on public.rooms, public.room_members, public.room_tasks, public.task_completions to authenticated;
grant insert on public.room_tasks, public.task_completions to authenticated;
grant delete on public.task_completions to authenticated;

-- Realtime: updates to room members, shared tasks and completions.
do $$
begin
  alter publication supabase_realtime add table public.room_members;
exception when duplicate_object then null;
when others then
  if sqlstate <> '42710' then raise; end if;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.room_tasks;
exception when duplicate_object then null;
when others then
  if sqlstate <> '42710' then raise; end if;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.task_completions;
exception when duplicate_object then null;
when others then
  if sqlstate <> '42710' then raise; end if;
end
$$;
