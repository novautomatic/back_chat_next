-- ============================================================================
--  Secciones personalizadas de "Conocimiento y reglas"
--  Cada "cuadrado" de la pestaña Conocimiento puede ser una seccion fija
--  (definida en el front: casos / promociones / productos_nuevos / general)
--  o una seccion personalizada que el cliente crea aqui.
--
--  Las reglas de una seccion personalizada se guardan en agente_reglas con
--  fase = id (uuid) de la seccion. No hace falta tocar agente_reglas.
--
--  Idempotente: se puede correr varias veces sin romper nada.
-- ============================================================================

create table if not exists public.agente_secciones (
  id          uuid primary key default uuid_generate_v4(),
  client_id   uuid not null references public.clientes(id) on delete cascade,
  agente_id   uuid not null references public.agentes(id) on delete cascade,
  titulo      text not null,
  descripcion text,
  icono       text not null default '📋',
  color       text not null default 'slate',   -- nombre de paleta: amber|rose|cyan|emerald|violet|sky|indigo|slate
  tipo        text not null default 'simple',   -- simple | caso (cuando -> entonces)
  orden       int  not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_secciones_agente on public.agente_secciones(agente_id);

-- RLS: misma politica "por client_id" que el resto de tablas de negocio.
alter table public.agente_secciones enable row level security;
drop policy if exists agente_secciones_rw on public.agente_secciones;
create policy agente_secciones_rw on public.agente_secciones for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
