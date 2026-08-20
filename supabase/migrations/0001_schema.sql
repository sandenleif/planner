-- ============================================================================
-- 0001_schema.sql - Tabellen, Indizes, Trigger
-- ============================================================================
-- Konventionen, die im ganzen Schema gelten:
--   * position  : Fractional Index (text, lexikografisch sortiert). Erlaubt
--                 Umsortieren per Drag&Drop, ohne die Geschwister neu zu
--                 nummerieren - wichtig, sobald zwei Leute gleichzeitig in
--                 derselben Liste sortieren.
--   * deleted_at: Soft-Delete. Ohne Tombstone kann ein Client beim Sync nicht
--                 zwischen "geloescht" und "noch nie gesehen" unterscheiden.
--   * updated_at: wird per Trigger gesetzt, Basis fuer Last-Write-Wins.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- Hilfsmittel

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- ------------------------------------------------------------------- Profile

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Legt beim Signup automatisch ein Profil an.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------- Listen

create type public.member_role as enum ('owner', 'editor', 'viewer');

-- Wiederholungsrhythmus. Bewusst eine kleine Aufzaehlung statt einer vollen
-- RRULE: deckt die Alltagsfaelle ab und laesst sich ohne Bibliothek rechnen.
create type public.recurrence as enum
  ('daily', 'weekdays', 'weekly', 'monthly', 'yearly');

create table public.lists (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  color      text,
  position   text not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index lists_owner_idx on public.lists (owner_id) where deleted_at is null;

create trigger lists_touch
  before update on public.lists
  for each row execute function public.touch_updated_at();

create table public.list_members (
  list_id    uuid not null references public.lists(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create index list_members_user_idx on public.list_members (user_id);

-- Ohne diesen Trigger kann der Ersteller seine eigene Liste nicht sehen:
-- alle Policies haengen an list_members, nicht an lists.owner_id.
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.list_members (list_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$fn$;

create trigger lists_add_owner
  after insert on public.lists
  for each row execute function public.add_owner_as_member();

-- ------------------------------------------------------------------ Aufgaben

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references public.lists(id) on delete cascade,
  parent_id    uuid references public.tasks(id) on delete cascade,
  title        text not null,
  notes        text,
  done         boolean not null default false,
  completed_at timestamptz,
  due_at       timestamptz,
  all_day      boolean not null default true,
  priority     smallint check (priority between 0 and 3),
  recurrence   public.recurrence,
  position     text not null default 'a0',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint tasks_no_self_parent check (id <> parent_id)
);

create index tasks_list_idx   on public.tasks (list_id)   where deleted_at is null;
create index tasks_parent_idx on public.tasks (parent_id) where deleted_at is null;
create index tasks_due_idx    on public.tasks (due_at)    where deleted_at is null and done = false;
create index tasks_sync_idx   on public.tasks (list_id, updated_at);

create trigger tasks_touch
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Haelt done/completed_at konsistent, verhindert Eltern in fremden Listen
-- und Zyklen in der Unterpunkt-Hierarchie.
create or replace function public.tasks_guard()
returns trigger
language plpgsql
as $fn$
declare
  parent_list uuid;
  cursor_id   uuid;
  depth       int := 0;
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif not new.done then
    new.completed_at := null;
  end if;

  if new.parent_id is not null then
    select list_id into parent_list from public.tasks where id = new.parent_id;
    if parent_list is null then
      raise exception 'Elternaufgabe % existiert nicht', new.parent_id;
    end if;
    if parent_list <> new.list_id then
      raise exception 'Unterpunkt muss in derselben Liste liegen wie die Elternaufgabe';
    end if;

    -- Zyklus-Schutz: von parent_id nach oben laufen, new.id darf nicht auftauchen.
    cursor_id := new.parent_id;
    while cursor_id is not null and depth < 64 loop
      if cursor_id = new.id then
        raise exception 'Zyklus in der Unterpunkt-Hierarchie';
      end if;
      select parent_id into cursor_id from public.tasks where id = cursor_id;
      depth := depth + 1;
    end loop;
  end if;

  return new;
end;
$fn$;

create trigger tasks_guard_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_guard();

-- ---------------------------------------------------------------- Einladungen

create table public.list_invites (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.lists(id) on delete cascade,
  email       text not null,
  role        public.member_role not null default 'editor',
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create index list_invites_list_idx  on public.list_invites (list_id);
create index list_invites_email_idx on public.list_invites (lower(email))
  where accepted_at is null;
