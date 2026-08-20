-- ============================================================================
-- 0003_realtime.sql - Live-Sync fuer geteilte Listen
-- ============================================================================
-- Supabase Realtime sendet Aenderungen nur fuer Tabellen, die in der
-- Publication supabase_realtime stehen. Die RLS-Policies gelten dabei weiter:
-- ein Client bekommt ausschliesslich Events zu Zeilen, die er auch per SELECT
-- lesen duerfte.
-- ============================================================================

alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.list_members;
alter publication supabase_realtime add table public.tasks;

-- REPLICA IDENTITY FULL laesst Postgres bei UPDATE/DELETE die komplette alte
-- Zeile ins WAL schreiben. Ohne das enthaelt ein DELETE-Event nur den
-- Primaerschluessel - und damit kein list_id, nach dem der Client filtern
-- koennte. Kostet etwas WAL-Volumen, ist bei diesen Datenmengen aber egal.
alter table public.lists          replica identity full;
alter table public.list_members   replica identity full;
alter table public.tasks          replica identity full;
