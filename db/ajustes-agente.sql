-- ============================================================================
--  Ajustes de COMPORTAMIENTO del agente  (configurables, no hardcodeados)
--
--  Saca al panel parámetros que antes vivían fijos en el código:
--   - max_productos : tope de productos por respuesta (antes: sin límite -> "los
--     manda todos de golpe"). Default 6 = base para todos los agentes.
--   - rag_fragmentos: cuántos fragmentos de conocimiento recupera el RAG por
--     turno (antes: fijo 8).
--   - max_historial : cuántos mensajes previos entran como contexto (antes: 12).
--
--  Al agregar la columna con DEFAULT, Postgres rellena las filas existentes con
--  ese valor: así TODOS los agentes (presentes y futuros) heredan la base, y
--  cada uno se puede ajustar desde el panel. Para cambiar la BASE de los futuros
--  agentes, cambia el DEFAULT de la columna (alter ... set default N).
--
--  Idempotente. Correr DESPUES de motor-agente.sql.
-- ============================================================================

alter table public.agentes add column if not exists max_productos  int not null default 6;
alter table public.agentes add column if not exists rag_fragmentos int not null default 8;
alter table public.agentes add column if not exists max_historial  int not null default 12;
