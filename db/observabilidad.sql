-- ============================================================================
--  Observabilidad: feedback del usuario + evals  (Fase 5)
--
--  - feedback: pulgar arriba/abajo del visitante sobre una respuesta del agente.
--  - eval_casos / eval_corridas: banco de pruebas con "LLM-as-judge" para medir
--    la calidad antes de cambiar prompts/tools (lo corre back/scripts/run-evals.js).
--
--  Las trazas (telemetria de cada paso) ya viven en db/trazas.sql.
--  Idempotente. Correr DESPUES de schema.sql.
-- ============================================================================

-- 1) Feedback -----------------------------------------------------------------
create table if not exists public.feedback (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clientes(id) on delete cascade,
  conversacion_id uuid references public.conversaciones(id) on delete cascade,
  mensaje_id      uuid references public.mensajes(id) on delete cascade,
  valor           smallint not null,   -- 1 = pulgar arriba, -1 = pulgar abajo
  comentario      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_feedback_client on public.feedback(client_id, created_at);
create index if not exists idx_feedback_mensaje on public.feedback(mensaje_id);

alter table public.feedback enable row level security;
drop policy if exists feedback_rw on public.feedback;
create policy feedback_rw on public.feedback for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

-- 2) Evals: casos de prueba ---------------------------------------------------
create table if not exists public.eval_casos (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid not null references public.agentes(id) on delete cascade,
  entrada    text not null,           -- mensaje del usuario a probar
  criterio   text not null,           -- que debe cumplir la respuesta
  referencia text,                    -- respuesta ideal (opcional)
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_eval_casos_agente on public.eval_casos(agente_id);

alter table public.eval_casos enable row level security;
drop policy if exists eval_casos_rw on public.eval_casos;
create policy eval_casos_rw on public.eval_casos for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

-- 3) Evals: corridas (resultados) ---------------------------------------------
create table if not exists public.eval_corridas (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid references public.agentes(id) on delete set null,
  caso_id    uuid references public.eval_casos(id) on delete cascade,
  respuesta  text,
  aprobado   boolean,
  puntaje    numeric,
  juez_notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_eval_corridas_caso on public.eval_corridas(caso_id, created_at);

alter table public.eval_corridas enable row level security;
drop policy if exists eval_corridas_rw on public.eval_corridas;
create policy eval_corridas_rw on public.eval_corridas for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
