-- ============================================================================
-- rls_test.sql - Beweist, dass die Policies aus 0002_rls.sql wirklich greifen
-- ============================================================================
--
-- AUSFUEHREN: komplett in den Supabase SQL-Editor einfuegen und starten.
-- Der Test laeuft in einer Transaktion und endet mit ROLLBACK - er hinterlaesst
-- nichts, auch nicht die beiden Testnutzer.
--
-- ERGEBNIS: Am Ende steht "ALLE TESTS BESTANDEN". Schlaegt eine Pruefung fehl,
-- bricht das Skript mit einer Fehlermeldung ab, die genau benennt, welche Regel
-- verletzt wurde. (Die Meldungen erscheinen im SQL-Editor unter "Messages"
-- bzw. in der psql-Ausgabe.)
--
-- WIE DAS FUNKTIONIERT:
-- Supabase leitet auth.uid() aus der Einstellung `request.jwt.claims` ab. Setzt
-- man die von Hand und wechselt in die Rolle `authenticated`, verhaelt sich die
-- Datenbank exakt so, als kaeme die Anfrage von diesem Nutzer durch PostgREST.
-- Deshalb prueft dieser Test die echten Policies - nicht eine Nachbildung.
--
-- WICHTIG - warum ueberall RETURNING steht:
-- Der Client ruft `.insert(...).select()` auf, PostgREST macht daraus ein
-- INSERT ... RETURNING. Bei aktivem RLS verlangt Postgres dafuer ZUSAETZLICH,
-- dass die SELECT-Policy die neue Zeile durchlaesst. Ein nacktes INSERT prueft
-- diesen Weg nicht - und genau daran ist eine erste Fassung dieses Tests
-- vorbeigelaufen, waehrend das Anlegen einer Liste in der App scheiterte
-- (siehe 0005_fix_list_insert_returning.sql). Ein Test muss den Zugriffsweg
-- nachstellen, den die Anwendung tatsaechlich nimmt, nicht einen bequemeren.
--
-- Bewusst ohne psql-Variablen (\set) und ohne Funktion fuers Rollenwechseln:
-- der SQL-Editor ist kein psql, und SET LOCAL ROLE innerhalb einer Funktion
-- verhaelt sich je nach Funktionsdefinition anders. Alles steht deshalb als
-- einfaches Top-Level-SQL da - dafuer laenger, aber ohne Ueberraschungen.
--
-- Feste IDs statt gen_random_uuid(), damit Fehlermeldungen wiedererkennbar sind:
--   Alice = 11111111-1111-4111-8111-111111111111
--   Bob   = 22222222-2222-4222-8222-222222222222
--   Liste = 33333333-3333-4333-8333-333333333333
-- ============================================================================

begin;

-- ---------------------------------------------------------------- Hilfsmittel

create or replace function pg_temp.assert(ok boolean, label text)
returns void
language plpgsql
as $fn$
begin
  if ok then
    raise notice '  bestanden : %', label;
  else
    raise exception 'FEHLGESCHLAGEN: %', label;
  end if;
end;
$fn$;

-- ------------------------------------------------------------ Vorbereitung

-- encrypted_password ist hier ein Platzhalter: es wird nie eine echte
-- Anmeldung durchgefuehrt, die Identitaet kommt aus den JWT-Claims.
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@test.local', 'x',
   now(), now(), now(),
   '{"provider":"email"}'::jsonb, '{"full_name":"Alice Test"}'::jsonb),
  ('22222222-2222-4222-8222-222222222222',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bob@test.local', 'x',
   now(), now(), now(),
   '{"provider":"email"}'::jsonb, '{"full_name":"Bob Test"}'::jsonb);

do $$
begin
  raise notice '';
  raise notice '=== Vorbereitung ===';
  perform pg_temp.assert(
    (select count(*) from public.profiles
      where id in ('11111111-1111-4111-8111-111111111111',
                   '22222222-2222-4222-8222-222222222222')) = 2,
    'Trigger handle_new_user legt fuer beide Nutzer ein Profil an'
  );
end $$;

-- ============================================== Akt 1: Alice legt eine Liste an

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"alice@test.local"}',
  true);
set local role authenticated;

do $$
declare
  neu uuid;
begin
  raise notice '';
  raise notice '=== Akt 1: Alice legt eine Liste an ===';

  -- Der kritische Weg: INSERT ... RETURNING, genau wie PostgREST es ausfuehrt.
  insert into public.lists (id, owner_id, name, color)
  values ('33333333-3333-4333-8333-333333333333',
          '11111111-1111-4111-8111-111111111111', 'Alices Liste', '#2E6F50')
  returning id into neu;

  perform pg_temp.assert(
    neu = '33333333-3333-4333-8333-333333333333',
    'Liste anlegen mit RETURNING (so macht es die App)'
  );

  insert into public.tasks (list_id, title, created_by)
  values ('33333333-3333-4333-8333-333333333333', 'Alices geheime Aufgabe',
          '11111111-1111-4111-8111-111111111111')
  returning id into neu;

  perform pg_temp.assert(neu is not null, 'Aufgabe anlegen mit RETURNING');
end $$;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.list_members
      where list_id = '33333333-3333-4333-8333-333333333333'
        and user_id = '11111111-1111-4111-8111-111111111111'
        and role = 'owner') = 1,
    'Trigger lists_add_owner macht die Erstellerin zur Besitzerin'
  );
  perform pg_temp.assert(
    (select count(*) from public.lists) = 1,
    'Alice sieht ihre eigene Liste'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 1,
    'Alice sieht ihre eigene Aufgabe'
  );
end $$;

-- ============================================ Akt 2: Bob ist kein Mitglied

reset role;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","email":"bob@test.local"}',
  true);
set local role authenticated;

do $$
begin
  raise notice '';
  raise notice '=== Akt 2: Bob ist kein Mitglied ===';

  -- Die wichtigsten beiden Zeilen des ganzen Skripts. Schlagen sie fehl,
  -- ist die App ein Datenleck.
  perform pg_temp.assert(
    (select count(*) from public.lists) = 0,
    'Bob sieht Alices Liste NICHT'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 0,
    'Bob sieht Alices Aufgaben NICHT'
  );

  -- Dass diese Abfrage ueberhaupt durchlaeuft, ist der eigentliche Punkt:
  -- eine Policy auf list_members, die selbst list_members abfragt, wuerde hier
  -- mit "infinite recursion detected in policy" abbrechen. Genau das
  -- verhindern die SECURITY-DEFINER-Helferfunktionen.
  perform pg_temp.assert(
    (select count(*) from public.list_members) = 0,
    'Abfrage auf list_members laeuft ohne Rekursionsfehler'
  );

  perform pg_temp.assert(
    (select count(*) from public.profiles) = 1,
    'Bob sieht nur sein eigenes Profil, nicht das von Alice'
  );
end $$;

do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.tasks (list_id, title)
    values ('33333333-3333-4333-8333-333333333333', 'Bob draengt sich rein');
  exception when others then
    blocked := true;
  end;
  perform pg_temp.assert(blocked, 'Bob kann in Alices Liste NICHTS schreiben');
end $$;

do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.list_invites (list_id, email, role, invited_by)
    values ('33333333-3333-4333-8333-333333333333', 'komplize@test.local',
            'editor', '22222222-2222-4222-8222-222222222222');
  exception when others then
    blocked := true;
  end;
  perform pg_temp.assert(blocked,
    'Bob kann sich NICHT selbst in Alices Liste einladen');
end $$;

-- ================================================ Akt 3: Alice laedt Bob ein

reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"alice@test.local"}',
  true);
set local role authenticated;

do $$
declare
  neu uuid;
begin
  insert into public.list_invites (list_id, email, role, token, invited_by)
  values ('33333333-3333-4333-8333-333333333333', 'bob@test.local', 'editor',
          'test-token-abc', '11111111-1111-4111-8111-111111111111')
  returning id into neu;

  perform pg_temp.assert(neu is not null, 'Einladung anlegen mit RETURNING');
end $$;

reset role;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","email":"bob@test.local"}',
  true);
set local role authenticated;

do $$
begin
  raise notice '';
  raise notice '=== Akt 3: Bob wird eingeladen ===';
  perform pg_temp.assert(
    (select count(*) from public.list_invites where token = 'test-token-abc') = 1,
    'Bob sieht die an seine E-Mail gerichtete Einladung'
  );
  perform pg_temp.assert(
    (select count(*) from public.lists) = 0,
    'Vor dem Annehmen sieht Bob die Liste weiterhin nicht'
  );
end $$;

select public.accept_list_invite('test-token-abc');

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.lists) = 1,
    'Nach dem Annehmen sieht Bob die Liste'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 1,
    'Nach dem Annehmen sieht Bob auch die Aufgaben'
  );
  perform pg_temp.assert(
    (select role::text from public.list_members
      where list_id = '33333333-3333-4333-8333-333333333333'
        and user_id = '22222222-2222-4222-8222-222222222222') = 'editor',
    'Bob bekommt die Rolle aus der Einladung (editor)'
  );
  perform pg_temp.assert(
    (select count(*) from public.profiles) = 2,
    'Jetzt sieht Bob auch Alices Profil - sie teilen eine Liste'
  );
end $$;

do $$
declare
  blocked boolean := false;
begin
  begin
    perform public.accept_list_invite('test-token-abc');
  exception when others then
    blocked := true;
  end;
  perform pg_temp.assert(blocked,
    'Ein Einladungstoken laesst sich nur EINMAL einloesen');
end $$;

-- ================================ Akt 4: Editor darf schreiben, nicht loeschen

do $$
declare
  neu uuid;
begin
  insert into public.tasks (list_id, title, created_by)
  values ('33333333-3333-4333-8333-333333333333', 'Bobs Beitrag',
          '22222222-2222-4222-8222-222222222222')
  returning id into neu;

  perform pg_temp.assert(neu is not null, 'Editor legt Aufgabe an mit RETURNING');
end $$;

-- Diese Pruefung steht bewusst VOR den Loeschversuchen: greift die
-- Loesch-Policy naemlich faelschlich, raeumt der Cascade die Aufgaben gleich
-- mit weg - und dann schluege diese Zeile fehl statt der eigentlich
-- gemeinten weiter unten. Eine Fehlermeldung, die auf die falsche Regel
-- zeigt, kostet beim spaeteren Debuggen mehr Zeit als sie wert ist.
do $$
begin
  raise notice '';
  raise notice '=== Akt 4: Bob als Editor ===';
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 2,
    'Editor Bob darf Aufgaben anlegen'
  );
end $$;

delete from public.lists where id = '33333333-3333-4333-8333-333333333333';
delete from public.list_members
where list_id = '33333333-3333-4333-8333-333333333333'
  and user_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  -- Ein DELETE ohne passende Policy wirft keinen Fehler, es trifft schlicht
  -- keine Zeile. Deshalb wird hier das Ergebnis geprueft, nicht eine Exception.
  perform pg_temp.assert(
    (select count(*) from public.lists
      where id = '33333333-3333-4333-8333-333333333333') = 1,
    'Editor Bob kann die Liste NICHT loeschen (nur Besitzer duerfen das)'
  );
  perform pg_temp.assert(
    (select count(*) from public.list_members
      where user_id = '11111111-1111-4111-8111-111111111111') = 1,
    'Editor Bob kann die Besitzerin NICHT aus ihrer eigenen Liste werfen'
  );
end $$;

-- ============================================ Akt 5: Herabstufung auf viewer

reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"alice@test.local"}',
  true);
set local role authenticated;

update public.list_members set role = 'viewer'
where list_id = '33333333-3333-4333-8333-333333333333'
  and user_id = '22222222-2222-4222-8222-222222222222';

reset role;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","email":"bob@test.local"}',
  true);
set local role authenticated;

update public.tasks set title = 'Umbenannt durch Bob'
where list_id = '33333333-3333-4333-8333-333333333333';

do $$
declare
  blocked boolean := false;
begin
  raise notice '';
  raise notice '=== Akt 5: Bob nur noch mit Leserecht ===';

  perform pg_temp.assert(
    (select count(*) from public.tasks) = 2,
    'Viewer Bob darf weiterhin lesen'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks where title = 'Umbenannt durch Bob') = 0,
    'Viewer Bob kann Aufgaben NICHT umbenennen'
  );

  begin
    insert into public.tasks (list_id, title)
    values ('33333333-3333-4333-8333-333333333333', 'Heimlich');
  exception when others then
    blocked := true;
  end;
  perform pg_temp.assert(blocked, 'Viewer Bob darf NICHT mehr schreiben');
end $$;

-- ============================================== Akt 6: Bob traegt sich aus

delete from public.list_members
where list_id = '33333333-3333-4333-8333-333333333333'
  and user_id = '22222222-2222-4222-8222-222222222222';

do $$
begin
  raise notice '';
  raise notice '=== Akt 6: Bob verlaesst die Liste ===';
  perform pg_temp.assert(
    (select count(*) from public.lists) = 0,
    'Nach dem Austragen sieht Bob die Liste nicht mehr'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 0,
    'Und auch die Aufgaben nicht mehr'
  );
end $$;

reset role;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"alice@test.local"}',
  true);
set local role authenticated;

do $$
begin
  perform pg_temp.assert(
    (select count(*) from public.lists) = 1,
    'Alice behaelt ihre Liste, nachdem Bob gegangen ist'
  );
  perform pg_temp.assert(
    (select count(*) from public.tasks) = 2,
    'Bobs Aufgabe bleibt in der Liste erhalten'
  );
end $$;

-- ============================================== Akt 7: Nicht angemeldet

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare
  ok boolean := false;
begin
  raise notice '';
  raise notice '=== Akt 7: Ohne Anmeldung ===';
  begin
    -- Entweder liefert die Abfrage null Zeilen (Policies greifen) oder sie
    -- scheitert am fehlenden GRANT. Beides ist das gewuenschte Ergebnis.
    ok := (select count(*) from public.lists) = 0;
  exception when others then
    ok := true;
  end;
  perform pg_temp.assert(ok, 'Ohne Anmeldung sind keine Listen erreichbar');
end $$;

-- ======================================= Akt 8: Ausfuehrungsrechte

reset role;

/*
 * Diese Pruefungen gab es zunaechst nicht - der Supabase-Security-Advisor hat
 * gemeldet, dass anon die Funktionen weiterhin aufrufen darf, obwohl in
 * 0002_rls.sql ein REVOKE steht. Ursache: Postgres vergibt EXECUTE automatisch
 * an PUBLIC, und ein REVOKE gegen anon nimmt davon nichts weg. Behoben in
 * 0004_function_privileges.sql.
 *
 * Ein Befund, den ein Test nicht nachstellt, kommt zurueck. Deshalb steht er
 * ab hier hier.
 */
do $$
declare
  fn text;
  helpers text[] := array[
    'public.is_list_member(uuid)',
    'public.can_edit_list(uuid)',
    'public.is_list_owner(uuid)',
    'public.shares_list_with(uuid)'
  ];
begin
  raise notice '';
  raise notice '=== Akt 8: Ausfuehrungsrechte auf Funktionen ===';

  perform pg_temp.assert(
    has_function_privilege('anon', 'public.accept_list_invite(text)', 'EXECUTE') = false,
    'anon darf accept_list_invite NICHT aufrufen'
  );
  perform pg_temp.assert(
    has_function_privilege('authenticated', 'public.accept_list_invite(text)', 'EXECUTE'),
    'authenticated darf accept_list_invite aufrufen'
  );

  foreach fn in array helpers loop
    perform pg_temp.assert(
      has_function_privilege('anon', fn, 'EXECUTE') = false,
      format('anon darf %s NICHT aufrufen', split_part(fn, '(', 1))
    );
    -- Die Gegenprobe ist genauso wichtig: entzieht man zu viel, faellt jede
    -- Policy-Auswertung fuer angemeldete Nutzer auf die Nase.
    perform pg_temp.assert(
      has_function_privilege('authenticated', fn, 'EXECUTE'),
      format('authenticated darf %s aufrufen', split_part(fn, '(', 1))
    );
  end loop;
end $$;

do $$
declare
  ohne_pfad text;
begin
  -- Zweiter Advisor-Befund: touch_updated_at und tasks_guard hatten kein
  -- festgesetztes search_path. Eine Funktion ohne festen Suchpfad loest
  -- unqualifizierte Namen gegen den Pfad des Aufrufers auf.
  select string_agg(p.proname, ', ' order by p.proname)
    into ohne_pfad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'touch_updated_at', 'handle_new_user', 'add_owner_as_member',
      'tasks_guard', 'is_list_member', 'can_edit_list', 'is_list_owner',
      'shares_list_with', 'accept_list_invite'
    )
    and (
      p.proconfig is null
      or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    );

  perform pg_temp.assert(
    ohne_pfad is null,
    coalesce('Funktionen ohne search_path: ' || ohne_pfad,
             'Alle eigenen Funktionen haben ein festes search_path')
  );
end $$;

-- ==================================================================== Fazit

do $$
begin
  raise notice '';
  raise notice '==================================================';
  raise notice '  ALLE TESTS BESTANDEN';
  raise notice '==================================================';
  raise notice 'Die Transaktion wird jetzt zurueckgerollt - es';
  raise notice 'bleiben keine Testdaten und keine Testnutzer.';
  raise notice '';
end $$;

rollback;
