-- ============================================================================
--  Motor del agente: feature flag + catalogo de herramientas (tools)  (Fase 1)
--
--  - agentes.modo_motor: 'clasico' (una llamada, comportamiento historico) o
--    'loop' (agent-loop con function calling). Default 'clasico' -> migracion
--    sin cambios de comportamiento hasta activar el flag por agente.
--  - agentes.max_pasos: tope de iteraciones del loop (cota anti-timeout Vercel).
--  - tools: catalogo GLOBAL de herramientas disponibles (lo administra el super
--    admin). El handler vive en codigo (back/src/agent/tools/<key>.js); aqui solo
--    se describe y se publica.
--  - agente_tools: que tools tiene activas cada agente (config por cliente).
--    Si un agente en modo 'loop' NO tiene filas aqui, el backend usa el set base
--    (buscar_conocimiento + responder_al_usuario) por defecto.
--
--  Idempotente y autosuficiente. Correr DESPUES de schema.sql.
-- ============================================================================

-- 1) Flag de motor + cota de pasos en la tabla de agentes ---------------------
alter table public.agentes
  add column if not exists modo_motor text not null default 'clasico'; -- clasico | loop
alter table public.agentes
  add column if not exists max_pasos  int  not null default 4;

-- 2) Catalogo GLOBAL de tools -------------------------------------------------
create table if not exists public.tools (
  id                uuid primary key default uuid_generate_v4(),
  key               text not null unique,            -- coincide con el handler en codigo
  nombre            text not null,
  descripcion       text,
  parametros_schema jsonb not null default '{}'::jsonb, -- override opcional del schema OpenAI
  ambito            text not null default 'todas',    -- todas | ventas | soporte | reservas...
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- 3) Tools activas por agente (instancia + parametrizacion) -------------------
create table if not exists public.agente_tools (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid not null references public.agentes(id) on delete cascade,
  tool_id    uuid not null references public.tools(id)   on delete cascade,
  activo     boolean not null default true,
  config     jsonb not null default '{}'::jsonb,        -- overrides por agente
  created_at timestamptz not null default now(),
  unique (agente_id, tool_id)
);

create index if not exists idx_agente_tools_agente on public.agente_tools(agente_id);
create index if not exists idx_agente_tools_client on public.agente_tools(client_id);

-- 4) Semilla de las tools base (idempotente por `key`) ------------------------
insert into public.tools (key, nombre, descripcion, ambito) values
  ('buscar_conocimiento', 'Buscar en el conocimiento', 'RAG on-demand: busca informacion en los documentos/catalogo del agente.', 'todas'),
  ('responder_al_usuario', 'Responder al usuario', 'Tool terminal: entrega la respuesta final (texto + productos + acciones).', 'todas')
on conflict (key) do nothing;

-- 5) RLS ----------------------------------------------------------------------
-- tools: catalogo global -> lectura para todos los autenticados, escritura solo super admin.
alter table public.tools enable row level security;
drop policy if exists tools_select on public.tools;
create policy tools_select on public.tools for select using (true);
drop policy if exists tools_write on public.tools;
create policy tools_write on public.tools for all
  using (public.es_super_admin()) with check (public.es_super_admin());

-- agente_tools: misma politica "por client_id" que el resto de tablas de negocio.
alter table public.agente_tools enable row level security;
drop policy if exists agente_tools_rw on public.agente_tools;
create policy agente_tools_rw on public.agente_tools for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
