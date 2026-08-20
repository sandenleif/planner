-- ============================================================================
-- 0002_rls.sql - Row Level Security
-- ============================================================================
-- Das Herzstueck der geteilten Listen. Die Regel "wer darf was" steht hier,
-- in der Datenbank - nicht im App-Code. Damit ist sie auch dann noch gueltig,
-- wenn jemand den anon-Key aus dem Client zieht und direkt gegen die REST-API
-- spricht.
--
-- WICHTIG - Rekursionsfalle:
-- Eine Policy AUF list_members, die SELECT auf list_members macht, ruft sich
-- selbst auf -> "infinite recursion detected in policy". Loesung: die Abfrage
-- in eine SECURITY DEFINER Funktion auslagern. Die laeuft mit den Rechten des
-- Definers und umgeht damit RLS, ohne ein Loch zu reissen: sie beantwortet
-- ausschliesslich Fragen ueber auth.uid(), also ueber den Aufrufer selbst.
-- ============================================================================

-- --------------------------------------------------------- Helferfunktionen

create or replace function public.is_list_member(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.list_members m
    where m.list_id = p_list_id
      and m.user_id = (select auth.uid())
  );
$fn$;

create or replace function public.can_edit_list(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.list_members m
    where m.list_id = p_list_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'editor')
  );
$fn$;

create or replace function public.is_list_owner(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.list_members m
    where m.list_id = p_list_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$fn$;

-- Teile ich mindestens eine Liste mit diesem Nutzer? Steuert, wessen Profil
-- (Name, Avatar) ich sehen darf.
create or replace function public.shares_list_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1
    from public.list_members mine
    join public.list_members theirs on theirs.list_id = mine.list_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$fn$;

-- --------------------------------------------------------------- Privilegien

-- Supabase vergibt fuer neue Tabellen normalerweise automatisch Rechte an
-- anon/authenticated (per ALTER DEFAULT PRIVILEGES). Das hier explizit
-- hinzuschreiben kostet nichts und macht das Schema unabhaengig davon -
-- etwa beim Einspielen in ein selbst gehostetes Postgres.
--
-- Wichtig: GRANT allein oeffnet nichts. Was eine Zeile sichtbar macht,
-- entscheiden ausschliesslich die Policies weiter unten. Ohne passende
-- Policy liefert ein SELECT trotz GRANT null Zeilen.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.lists,
  public.list_members,
  public.tasks,
  public.list_invites
to authenticated;

-- anon (nicht angemeldet) bekommt bewusst gar nichts: es gibt in dieser App
-- keine oeffentlich lesbaren Daten.

-- ------------------------------------------------------------ RLS einschalten

alter table public.profiles       enable row level security;
alter table public.lists          enable row level security;
alter table public.list_members   enable row level security;
alter table public.tasks          enable row level security;
alter table public.list_invites   enable row level security;

-- ------------------------------------------------------------------- Profile

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_list_with(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -------------------------------------------------------------------- Listen

create policy lists_select on public.lists
  for select to authenticated
  using (public.is_list_member(id));

create policy lists_insert on public.lists
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy lists_update on public.lists
  for update to authenticated
  using (public.can_edit_list(id))
  with check (public.can_edit_list(id));

-- Hartes Loeschen bleibt dem Besitzer vorbehalten. Der Normalfall ist der
-- Soft-Delete via UPDATE deleted_at, den auch Editoren duerfen.
create policy lists_delete on public.lists
  for delete to authenticated
  using (public.is_list_owner(id));

-- ------------------------------------------------------------- Mitgliedschaft

create policy list_members_select on public.list_members
  for select to authenticated
  using (public.is_list_member(list_id));

create policy list_members_insert on public.list_members
  for insert to authenticated
  with check (public.is_list_owner(list_id));

create policy list_members_update on public.list_members
  for update to authenticated
  using (public.is_list_owner(list_id))
  with check (public.is_list_owner(list_id));

-- Besitzer koennen jeden entfernen; alle anderen koennen sich selbst
-- aus einer geteilten Liste austragen.
create policy list_members_delete on public.list_members
  for delete to authenticated
  using (public.is_list_owner(list_id) or user_id = (select auth.uid()));

-- ------------------------------------------------------------------ Aufgaben

create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_list_member(list_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_edit_list(list_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_edit_list(list_id))
  with check (public.can_edit_list(list_id));

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.can_edit_list(list_id));

-- ---------------------------------------------------------------- Einladungen

create policy list_invites_select on public.list_invites
  for select to authenticated
  using (
    public.is_list_owner(list_id)
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

create policy list_invites_insert on public.list_invites
  for insert to authenticated
  with check (public.is_list_owner(list_id) and invited_by = (select auth.uid()));

create policy list_invites_delete on public.list_invites
  for delete to authenticated
  using (public.is_list_owner(list_id));

-- Einloesen laeuft ueber die RPC unten, nicht ueber ein direktes UPDATE.

-- ------------------------------------------------------ RPC: Einladung nutzen

create or replace function public.accept_list_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  inv    public.list_invites%rowtype;
  me     uuid := (select auth.uid());
  my_mail text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if me is null then
    raise exception 'Nicht angemeldet';
  end if;

  select * into inv from public.list_invites where token = p_token;

  if inv.id is null then
    raise exception 'Einladung nicht gefunden';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Einladung wurde bereits eingeloest';
  end if;
  if inv.expires_at < now() then
    raise exception 'Einladung ist abgelaufen';
  end if;
  if lower(inv.email) <> my_mail then
    raise exception 'Diese Einladung gilt fuer eine andere E-Mail-Adresse';
  end if;

  insert into public.list_members (list_id, user_id, role)
  values (inv.list_id, me, inv.role)
  on conflict (list_id, user_id) do update set role = excluded.role;

  update public.list_invites
     set accepted_at = now(), accepted_by = me
   where id = inv.id;

  return inv.list_id;
end;
$fn$;

revoke execute on function public.accept_list_invite(text) from anon;
grant  execute on function public.accept_list_invite(text) to authenticated;
