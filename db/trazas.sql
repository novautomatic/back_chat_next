-- ============================================================================
--  Telemetria / Observabilidad  ·  Tabla de TRAZAS  (Fase 0 del motor-agente)
--
--  Una "traza" es un PASO dentro de un turno de conversacion. Un turno (un
--  mensaje del visitante) puede generar varias trazas cuando el motor entra en
--  modo agent-loop (una por llamada al LLM, una por cada tool, router, etc.).
--  En el motor "clasico" (una sola llamada) se registra una unica traza tipo
--  'llm' por turno.
--
--  Se usa para medir tokens, latencia y QUE hizo el agente en cada paso, sin
--  anadir latencia al usuario: la escritura es best-effort en background.
--
--  Idempotente y autosuficiente. Correr DESPUES de schema.sql.
-- ============================================================================
create table if not exists public.trazas (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clientes(id) on delete cascade,
  conversacion_id   uuid references public.conversaciones(id) on delete cascade,
  mensaje_id        uuid references public.mensajes(id) on delete set null,
  agente_id         uuid references public.agentes(id) on delete set null,
  turno_id          uuid not null,                 -- agrupa todos los pasos de UN turno
  paso              int  not null default 1,       -- orden del paso dentro del turno
  tipo              text not null,                 -- llm | tool | router | delegacion | error
  nombre            text,                          -- nombre de la tool / sub-agente / modelo
  entrada           jsonb,                         -- args / prompt resumido (saneado)
  salida            jsonb,                         -- resultado resumido (saneado)
  modelo            text,
  tokens_prompt     int,
  tokens_completion int,
  latencia_ms       int,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_trazas_client on public.trazas(client_id);
create index if not exists idx_trazas_conv   on public.trazas(conversacion_id);
create index if not exists idx_trazas_turno  on public.trazas(turno_id);
create index if not exists idx_trazas_agente on public.trazas(agente_id, created_at);

-- RLS: misma politica "por client_id" que el resto de tablas de negocio.
alter table public.trazas enable row level security;
drop policy if exists trazas_rw on public.trazas;
create policy trazas_rw on public.trazas for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
