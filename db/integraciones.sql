-- ============================================================================
--  Integraciones externas: Shopify (fuente de productos para el RAG).
--  Cada agente puede conectar UNA tienda Shopify.
--
--  Auth: "client credentials grant" del nuevo Dev Dashboard de Shopify
--  (servidor-a-servidor, sin OAuth interactivo). El backend guarda el Client ID
--  (api_key) y el Client secret (api_secret) de la app y obtiene un access_token
--  de 24h bajo demanda; lo cachea aqui (access_token / token_expira).
--  El front NUNCA recibe estos secretos de vuelta.
--  Correr DESPUES de schema.sql.
-- ============================================================================
create table if not exists public.integraciones_shopify (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clientes(id) on delete cascade,
  agente_id      uuid not null references public.agentes(id) on delete cascade,
  shop_domain    text not null,                       -- xxxxx.myshopify.com
  api_key        text not null,                       -- Client ID de la app (Dev Dashboard)
  api_secret     text not null,                       -- Client secret (token grant + HMAC webhooks) SECRETO
  access_token   text,                                -- token de 24h cacheado (lo obtiene el backend)
  token_expira   timestamptz,                         -- vencimiento del token cacheado
  api_version    text not null default '2024-10',
  estado         text not null default 'conectado',   -- conectado | sincronizando | error | desconectado
  webhooks_ok    boolean not null default false,      -- webhooks registrados en Shopify
  ultima_sync    timestamptz,
  productos_sync int not null default 0,
  error_msg      text,
  created_at     timestamptz not null default now(),
  unique (agente_id)                                  -- 1 tienda por agente (MVP)
);

create index if not exists idx_shopify_client on public.integraciones_shopify(client_id);
create index if not exists idx_shopify_domain on public.integraciones_shopify(shop_domain);

-- RLS: misma politica "por client_id" que el resto de tablas de negocio.
alter table public.integraciones_shopify enable row level security;
drop policy if exists integraciones_shopify_rw on public.integraciones_shopify;
create policy integraciones_shopify_rw on public.integraciones_shopify for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());
