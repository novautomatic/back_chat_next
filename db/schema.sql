-- ============================================================================
--  Plataforma de Chatbots Multi-cliente  ·  Esquema Supabase (Postgres)
--  Ejecutar en: Supabase Studio > SQL Editor (una sola vez).
--  Regla de oro: TODA tabla de negocio lleva client_id para aislar clientes.
-- ============================================================================

-- Extensiones -----------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ============================================================================
--  TABLAS
-- ============================================================================

-- Clientes (tenants). Los crea el SUPER ADMIN.
create table if not exists public.clientes (
  id             uuid primary key default uuid_generate_v4(),
  nombre         text not null,
  email_contacto text,
  plan           text not null default 'free',
  estado         text not null default 'activo',   -- activo | suspendido
  created_at     timestamptz not null default now()
);

-- Perfiles de usuario (1:1 con auth.users). client_id NULL = super admin.
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  client_id  uuid references public.clientes(id) on delete cascade,
  rol        text not null default 'cliente_admin',  -- super_admin | cliente_admin
  nombre     text,
  email      text,
  created_at timestamptz not null default now()
);

-- Agentes (el "cerebro"). Toda la conducta es configurable, no vive en codigo.
create table if not exists public.agentes (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clientes(id) on delete cascade,
  nombre            text not null,
  descripcion       text,
  modelo            text not null default 'gpt-4o-mini',
  temperatura       numeric not null default 0.5,
  persona           text,                  -- rol / personalidad / tono
  objetivo          text,                  -- meta de la conversacion
  saludo            text,                  -- mensaje de bienvenida del agente
  instrucciones_extra text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Reglas del agente, ordenadas y por fase (inicio / proceso / finalizacion / general).
create table if not exists public.agente_reglas (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid not null references public.agentes(id) on delete cascade,
  fase       text not null default 'general', -- inicio | proceso | finalizacion | general
  texto      text not null,
  orden      int  not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ejemplos few-shot (dialogos modelo: "asi se saluda", etc.)
create table if not exists public.agente_ejemplos (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid not null references public.agentes(id) on delete cascade,
  entrada    text not null,   -- lo que dice el usuario
  salida     text not null,   -- como deberia responder el agente
  orden      int  not null default 0,
  created_at timestamptz not null default now()
);

-- Flujos (iniciadores). Por ahora canal = 'web'.
create table if not exists public.flujos (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clientes(id) on delete cascade,
  agente_id       uuid references public.agentes(id) on delete set null,
  nombre          text not null,
  descripcion     text,
  canal           text not null default 'web',           -- web | instagram | whatsapp (futuro)
  trigger_tipo    text not null default 'inicio_conversacion', -- inicio_conversacion | palabra_clave
  trigger_palabras jsonb not null default '[]'::jsonb,
  widget_key      uuid not null default uuid_generate_v4() unique, -- clave publica del embed
  config_widget   jsonb not null default '{}'::jsonb,     -- colores, bienvenida, posicion, captura lead
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Documentos de "educacion" del agente.
create table if not exists public.documentos (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  agente_id  uuid not null references public.agentes(id) on delete cascade,
  tipo       text not null,                 -- archivo | url | texto
  titulo     text not null,
  fuente     text,                          -- storage path | url | (null para texto)
  contenido  text,                          -- texto crudo cuando tipo=texto
  estado     text not null default 'pendiente', -- pendiente | procesando | listo | error
  error_msg  text,
  created_at timestamptz not null default now()
);

-- Fragmentos vectorizados (RAG).
create table if not exists public.fragmentos (
  id           uuid primary key default uuid_generate_v4(),
  client_id    uuid not null references public.clientes(id) on delete cascade,
  agente_id    uuid not null references public.agentes(id) on delete cascade,
  documento_id uuid not null references public.documentos(id) on delete cascade,
  contenido    text not null,
  embedding    vector(1536),
  orden        int not null default 0,
  created_at   timestamptz not null default now()
);

-- Conversaciones.
create table if not exists public.conversaciones (
  id         uuid primary key default uuid_generate_v4(),
  client_id  uuid not null references public.clientes(id) on delete cascade,
  flujo_id   uuid references public.flujos(id) on delete set null,
  agente_id  uuid references public.agentes(id) on delete set null,
  canal      text not null default 'web',
  visitante  jsonb not null default '{}'::jsonb,  -- nombre/email/telefono capturados
  estado     text not null default 'abierta',     -- abierta | cerrada
  origen     jsonb not null default '{}'::jsonb,   -- url, user agent
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

-- Mensajes.
create table if not exists public.mensajes (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clientes(id) on delete cascade,
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,
  rol             text not null,            -- user | assistant | system
  contenido       text not null,
  tokens          int,
  created_at      timestamptz not null default now()
);

-- Indices utiles -------------------------------------------------------------
create index if not exists idx_agentes_client       on public.agentes(client_id);
create index if not exists idx_reglas_agente        on public.agente_reglas(agente_id);
create index if not exists idx_ejemplos_agente      on public.agente_ejemplos(agente_id);
create index if not exists idx_flujos_client        on public.flujos(client_id);
create index if not exists idx_documentos_agente    on public.documentos(agente_id);
create index if not exists idx_fragmentos_agente    on public.fragmentos(agente_id);
create index if not exists idx_conv_client          on public.conversaciones(client_id);
create index if not exists idx_mensajes_conv        on public.mensajes(conversacion_id);

-- Indice vectorial (IVFFlat, distancia coseno). Requiere datos para entrenar;
-- crear de todas formas; mejorar con 'lists' segun volumen.
create index if not exists idx_fragmentos_embedding
  on public.fragmentos using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================================
--  HELPERS de seguridad (leen el perfil del usuario autenticado)
-- ============================================================================
create or replace function public.es_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'super_admin');
$$;

create or replace function public.mi_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.perfiles where id = auth.uid();
$$;

-- ============================================================================
--  RPC de busqueda por similitud (RAG)
-- ============================================================================
create or replace function public.match_fragmentos(
  p_agente_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (id uuid, contenido text, similitud float)
language sql stable as $$
  select f.id, f.contenido,
         1 - (f.embedding <=> p_query_embedding) as similitud
  from public.fragmentos f
  where f.agente_id = p_agente_id
  order by f.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- ============================================================================
--  RLS (defensa en profundidad). El backend usa service_role y hace el scope;
--  estas politicas protegen accesos directos desde el front (Auth/Realtime).
-- ============================================================================
alter table public.clientes        enable row level security;
alter table public.perfiles        enable row level security;
alter table public.agentes         enable row level security;
alter table public.agente_reglas   enable row level security;
alter table public.agente_ejemplos enable row level security;
alter table public.flujos          enable row level security;
alter table public.documentos      enable row level security;
alter table public.fragmentos      enable row level security;
alter table public.conversaciones  enable row level security;
alter table public.mensajes        enable row level security;

-- Cada usuario ve su propio perfil; super admin ve todos.
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles for select
  using (id = auth.uid() or public.es_super_admin());

-- Clientes: super admin todo; cliente_admin solo el suyo.
drop policy if exists clientes_rw on public.clientes;
create policy clientes_rw on public.clientes for all
  using (public.es_super_admin() or id = public.mi_client_id())
  with check (public.es_super_admin());

-- Macro: politica estandar "por client_id" para las tablas de negocio.
do $$
declare t text;
begin
  foreach t in array array[
    'agentes','agente_reglas','agente_ejemplos','flujos',
    'documentos','fragmentos','conversaciones','mensajes'
  ] loop
    execute format('drop policy if exists %I_rw on public.%I;', t, t);
    execute format($f$
      create policy %I_rw on public.%I for all
        using (public.es_super_admin() or client_id = public.mi_client_id())
        with check (public.es_super_admin() or client_id = public.mi_client_id());
    $f$, t, t);
  end loop;
end $$;

-- ============================================================================
--  Trigger: al crear un usuario en auth, crear su perfil vacio (cliente_admin).
--  El super admin se marca manualmente (ver db/seed.sql).
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, rol)
  values (new.id, new.email, 'cliente_admin')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
