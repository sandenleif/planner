-- ============================================================================
-- 0005_fix_list_insert_returning.sql
-- ============================================================================
-- Behebt: "new row violates row-level security policy for table lists" beim
-- Anlegen einer Liste.
--
-- WAS PASSIERT IST
--
-- Der Client ruft `.insert(...).select().single()` auf. PostgREST macht daraus
-- ein INSERT ... RETURNING. Und bei aktivem RLS verlangt Postgres fuer die
-- zurueckgegebene Zeile zusaetzlich, dass die SELECT-Policy greift - ein
-- INSERT allein reicht nicht.
--
-- Die SELECT-Policy lautete:
--
--     using (public.is_list_member(id))
--
-- Die Mitgliedschaft entsteht aber erst im AFTER-INSERT-Trigger
-- lists_add_owner. Zum Zeitpunkt der RETURNING-Pruefung existiert sie noch
-- nicht. Henne und Ei: die Liste darf nicht zurueckgegeben werden, weil ihr
-- Besitzer noch kein Mitglied ist, und Mitglied wird er erst, nachdem die
-- Liste angelegt wurde.
--
-- Ein nacktes INSERT ohne RETURNING lief deshalb durch - genau so stand es im
-- Test, und genau deshalb ist es dort nicht aufgefallen. Der Test hat die
-- Datenbank geprueft, aber nicht den Zugriffsweg, den die App tatsaechlich
-- nimmt. Das ist inzwischen korrigiert: rls_test.sql benutzt jetzt ueberall
-- RETURNING.
--
-- DIE KORREKTUR
--
-- Der Besitzer darf seine Liste immer sehen, unabhaengig von der
-- Mitgliedertabelle. Das ist nicht nur ein Kniff gegen dieses Problem,
-- sondern auch inhaltlich richtiger: verschwaende jemals eine Zeile in
-- list_members, waere die Liste sonst fuer niemanden mehr erreichbar - auch
-- nicht fuer die Person, der sie gehoert.
--
-- Die Berechtigung wird dadurch nicht weiter: owner_id kann nach dem Anlegen
-- niemand mehr aendern (lists_update prueft can_edit_list, und der Wert
-- gehoert nicht zu den Feldern, die der Client schickt).
-- ============================================================================

drop policy if exists lists_select on public.lists;

create policy lists_select on public.lists
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_list_member(id)
  );
