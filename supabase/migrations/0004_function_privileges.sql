-- ============================================================================
-- 0004_function_privileges.sql - Zwei Befunde des Security-Advisors
-- ============================================================================
--
-- TEIL 1: Ein REVOKE, das ins Leere lief
--
-- Am Ende von 0002_rls.sql steht:
--
--     revoke execute on function public.accept_list_invite(text) from anon;
--
-- Das sieht richtig aus und bewirkt nichts. Postgres vergibt EXECUTE auf jede
-- neue Funktion automatisch an die Pseudo-Rolle PUBLIC, und anon erbt daraus.
-- Ein REVOKE gegen anon nimmt nur eine Berechtigung weg, die anon nie direkt
-- hatte - die Vergabe an PUBLIC bleibt bestehen. In der ACL sieht man das als
-- Eintrag `=X/postgres` (leerer Rollenname = PUBLIC).
--
-- Richtig ist deshalb: erst PUBLIC entziehen, dann gezielt vergeben.
--
-- Ausnutzbar war das nicht: fuer anon ist auth.uid() null, accept_list_invite
-- bricht sofort mit "Nicht angemeldet" ab, und die vier Helferfunktionen
-- beantworten ausschliesslich Fragen ueber auth.uid() - fuer anon also immer
-- mit false. Es war die Absicht, die nicht ankam, kein Datenleck. Trotzdem
-- gehoert es korrigiert: eine Sicherheitszeile, die nur so aussieht, als taete
-- sie etwas, ist schlimmer als gar keine - sie beruhigt beim naechsten Lesen.
--
-- TEIL 2: Fehlendes search_path auf zwei Trigger-Funktionen
--
-- touch_updated_at und tasks_guard hatten als einzige Funktionen im Schema
-- kein festgesetztes search_path. Beide sind SECURITY INVOKER, das Risiko ist
-- also gering. Aber der Wert lohnt sich trotzdem: eine Funktion ohne festes
-- search_path loest unqualifizierte Namen gegen den Suchpfad des Aufrufers
-- auf. Wer eine eigene Tabelle oder einen eigenen Operator vor public schieben
-- kann, aendert damit das Verhalten der Funktion.
-- ============================================================================

-- ------------------------------------------- Teil 1: Ausfuehrungsrechte

-- Reihenfolge beachten: erst PUBLIC entziehen, dann authenticated vergeben.
-- Andersherum wuerde das REVOKE die frische Vergabe wieder mitnehmen.

revoke execute on function public.accept_list_invite(text) from public, anon;
revoke execute on function public.is_list_member(uuid)     from public, anon;
revoke execute on function public.can_edit_list(uuid)      from public, anon;
revoke execute on function public.is_list_owner(uuid)      from public, anon;
revoke execute on function public.shares_list_with(uuid)   from public, anon;

-- authenticated braucht die Helfer, weil die Policies sie aufrufen und dabei
-- mit den Rechten des abfragenden Nutzers laufen. Ohne dieses GRANT scheitert
-- jede Abfrage auf lists, tasks, list_members und profiles.
grant execute on function public.accept_list_invite(text) to authenticated;
grant execute on function public.is_list_member(uuid)     to authenticated;
grant execute on function public.can_edit_list(uuid)      to authenticated;
grant execute on function public.is_list_owner(uuid)      to authenticated;
grant execute on function public.shares_list_with(uuid)   to authenticated;

-- Die Trigger-Funktionen handle_new_user und add_owner_as_member bleiben
-- absichtlich unangetastet: Postgres prueft EXECUTE bei Trigger-Funktionen
-- beim Anlegen des Triggers, nicht bei jedem Ausloesen. Ein Entzug haette
-- hier keinen Nutzen, aber das Potenzial, spaetere CREATE TRIGGER scheitern
-- zu lassen.

-- ------------------------------------------------- Teil 2: search_path

-- ALTER FUNCTION statt CREATE OR REPLACE: so steht der Funktionsrumpf
-- weiterhin nur an einer Stelle (0001_schema.sql) und kann nicht auseinander
-- laufen.
alter function public.touch_updated_at() set search_path = public, pg_temp;
alter function public.tasks_guard()      set search_path = public, pg_temp;
