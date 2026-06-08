-- ============================================================================
--  Etapas de la conversacion  (reemplaza el viejo concepto de "pipeline")
--
--  Una "etapa" es un momento en el que puede estar el cliente (compra,
--  postventa, informacion general, agendar cita...). El agente entiende
--  que hacer segun la etapa en que se encuentra.
--
--  Tecnicamente una etapa es una fila de agente_secciones con area = 'etapa'
--  (las secciones de "Conocimiento y reglas" usan area = 'zona'). Sus reglas
--  se guardan en agente_reglas con fase = id (uuid) de la etapa, igual que las
--  secciones. El campo `descripcion` se reutiliza como el disparador
--  ("cuando aplica" esta etapa).
--
--  Las 3 etapas base (inicio / proceso / finalizacion) NO viven aqui: son
--  constantes del front con fase fija, para no migrar reglas existentes.
--
--  Este script es AUTOSUFICIENTE e IDEMPOTENTE: crea la tabla agente_secciones
--  si no existe (con la columna `area`), o solo agrega `area` si la tabla ya
--  estaba. Se puede correr varias veces sin romper nada.
-- ============================================================================

-- 1) La tabla (igual que en schema.sql) por si nunca se creo en esta BD.
create table if not exists public.agente_secciones (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references public.clientes(id) on delete cascade,
  agente_id   uuid not null references public.agentes(id) on delete cascade,
  titulo      text not null,
  descripcion text,
  icono       text not null default '📋',
  color       text not null default 'slate',   -- amber|rose|cyan|emerald|violet|sky|indigo|slate
  tipo        text not null default 'simple',   -- simple | caso
  area        text not null default 'zona',     -- etapa | zona
  orden       int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 2) Si la tabla ya existia SIN la columna `area`, la agrega.
alter table public.agente_secciones
  add column if not exists area text not null default 'zona';  -- 'etapa' | 'zona'

-- 3) Indices.
create index if not exists idx_secciones_agente on public.agente_secciones(agente_id);
create index if not exists idx_secciones_area   on public.agente_secciones(agente_id, area);

-- 4) RLS: misma politica "por client_id" que el resto de tablas de negocio.
alter table public.agente_secciones enable row level security;
drop policy if exists agente_secciones_rw on public.agente_secciones;
create policy agente_secciones_rw on public.agente_secciones for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
