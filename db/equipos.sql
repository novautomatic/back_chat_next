-- ============================================================================
--  Orquestacion multi-agente: EQUIPOS  (Fase 4)
--
--  Un equipo = un router + especialistas. El flujo (widget) puede apuntar a un
--  equipo (flujos.equipo_id) en vez de a un solo agente: entonces un router
--  elige al especialista, y un agente puede derivar a otro con la tool
--  delegar_a. Cada agente sigue siendo una fila normal en `agentes` con su
--  propio cerebro/tools -> ningun agente se satura.
--
--  Idempotente. Correr DESPUES de schema.sql y motor-agente.sql.
-- ============================================================================

-- 1) Equipos ------------------------------------------------------------------
create table if not exists public.equipos (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clientes(id) on delete cascade,
  nombre          text not null,
  router_agente_id uuid references public.agentes(id) on delete set null, -- generalista/fallback
  modo_router     text not null default 'llm',   -- llm | embedding
  config          jsonb not null default '{}'::jsonb,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists idx_equipos_client on public.equipos(client_id);

-- 2) Miembros del equipo ------------------------------------------------------
create table if not exists public.equipo_miembros (
  id                     uuid primary key default uuid_generate_v4(),
  client_id              uuid not null references public.clientes(id) on delete cascade,
  equipo_id              uuid not null references public.equipos(id) on delete cascade,
  agente_id              uuid not null references public.agentes(id) on delete cascade,
  rol                    text not null default 'especialista', -- router | especialista
  especialidad           text,                                  -- "ventas", "soporte tecnico"...
  especialidad_embedding vector(1536),                          -- para modo_router = embedding
  orden                  int  not null default 0,
  created_at             timestamptz not null default now(),
  unique (equipo_id, agente_id)
);
create index if not exists idx_equipo_miembros_equipo on public.equipo_miembros(equipo_id);
create index if not exists idx_equipo_miembros_client on public.equipo_miembros(client_id);

-- 3) El flujo puede apuntar a un equipo --------------------------------------
alter table public.flujos
  add column if not exists equipo_id uuid references public.equipos(id) on delete set null;

-- 4) Semilla de la tool delegar_a (idempotente por `key`) --------------------
insert into public.tools (key, nombre, descripcion, ambito) values
  ('delegar_a', 'Delegar a especialista', 'Deriva la conversacion a otro agente del equipo segun su especialidad.', 'todas')
on conflict (key) do nothing;

-- 5) RLS: misma politica "por client_id" que el resto de tablas de negocio. ---
alter table public.equipos enable row level security;
drop policy if exists equipos_rw on public.equipos;
create policy equipos_rw on public.equipos for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

alter table public.equipo_miembros enable row level security;
drop policy if exists equipo_miembros_rw on public.equipo_miembros;
create policy equipo_miembros_rw on public.equipo_miembros for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
