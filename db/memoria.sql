-- ============================================================================
--  Memoria del agente  (Fase 3)
--
--  - conversaciones.resumen*: resumen incremental de la conversacion (da
--    continuidad mas alla de la ventana de ultimos N mensajes).
--  - memoria_visitante: hechos/preferencias DURABLES por visitante recurrente,
--    identificado por visitante_key (email: / tel: / cookie:). Se recuperan por
--    similitud coseno EN MEMORIA (igual criterio que fragmentos / rag.js).
--  - tool `recordar`: el agente decide que guardar (se activa via agente_tools).
--
--  Idempotente. Correr DESPUES de schema.sql y motor-agente.sql.
-- ============================================================================

-- 1) Resumen incremental en conversaciones ------------------------------------
alter table public.conversaciones
  add column if not exists resumen               text;
alter table public.conversaciones
  add column if not exists resumen_hasta_mensaje uuid;
alter table public.conversaciones
  add column if not exists resumen_actualizado_at timestamptz;

-- 2) Memoria de largo plazo por visitante -------------------------------------
create table if not exists public.memoria_visitante (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references public.clientes(id) on delete cascade,
  agente_id     uuid references public.agentes(id) on delete set null,
  visitante_key text not null,                 -- email:... | tel:... | cookie:...
  tipo          text not null default 'hecho', -- hecho | preferencia | resumen_conv
  contenido     text not null,
  embedding     vector(1536),
  importancia   int  not null default 1,
  ultima_vez    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_memoria_vis_lookup
  on public.memoria_visitante(client_id, visitante_key);
create index if not exists idx_memoria_vis_embedding
  on public.memoria_visitante using hnsw (embedding vector_cosine_ops);

alter table public.memoria_visitante enable row level security;
drop policy if exists memoria_visitante_rw on public.memoria_visitante;
create policy memoria_visitante_rw on public.memoria_visitante for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

-- 3) Semilla de la tool `recordar` (idempotente por `key`) --------------------
insert into public.tools (key, nombre, descripcion, ambito) values
  ('recordar', 'Recordar (memoria)', 'Guarda un dato durable del visitante para futuras conversaciones.', 'todas')
on conflict (key) do nothing;
