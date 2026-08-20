-- Minimale Nachbildung der Supabase-Umgebung in einem nackten Postgres.
-- Nur so viel, wie die Migrationen und der RLS-Test tatsaechlich anfassen.
-- Die Definitionen von auth.uid() und auth.jwt() sind die von Supabase.

create extension if not exists pgcrypto;

-- Rollen, die PostgREST verwendet.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant anon, authenticated, service_role to postgres;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Nur die Spalten, die im Test bzw. im Trigger vorkommen.
create table if not exists auth.users (
  id                 uuid primary key,
  instance_id        uuid,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb
);

-- Originaldefinitionen aus Supabase.
create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$fn$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), '')::jsonb,
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$fn$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Realtime-Publication, die 0003 erweitert.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Supabase vergibt diese Standardrechte automatisch; hier von Hand,
-- damit der Ausgangszustand derselbe ist.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
