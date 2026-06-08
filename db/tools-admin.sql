-- ============================================================================
--  Catálogo de herramientas AMPLIADO (gestión total desde Super Admin)
--
--  Convierte `tools` en un catálogo rico que el super admin controla por completo:
--   - tipo: 'sistema' (handler en código) | 'webhook' (HTTP genérico, SIN código).
--   - marca: categoria + proveedor + icono/color + tags.
--   - variables: parametros_schema (JSON Schema de lo que el LLM rellena).
--   - configuración del cliente: config_schema (campos que el cliente completa).
--   - webhook: metodo + url_plantilla + headers + cuerpo_plantilla (con {{args.x}},
--     {{config.x}}, {{ctx.conversacion_id}}…).
--   - permisos: { planes:[...], clientes:[...] } (gating por plan y whitelist).
--
--  Idempotente. Correr DESPUES de motor-agente.sql.
-- ============================================================================

alter table public.tools add column if not exists tipo            text not null default 'sistema'; -- sistema | webhook
alter table public.tools add column if not exists categoria       text not null default 'general';
alter table public.tools add column if not exists proveedor       text not null default 'generico';
alter table public.tools add column if not exists icono           text not null default '🛠️';
alter table public.tools add column if not exists color           text not null default 'slate';
alter table public.tools add column if not exists tags            jsonb not null default '[]'::jsonb;
alter table public.tools add column if not exists config_schema   jsonb not null default '[]'::jsonb;  -- [{key,label,tipo,requerido,placeholder}]
alter table public.tools add column if not exists metodo          text;                                -- GET|POST|PUT|PATCH|DELETE (webhook)
alter table public.tools add column if not exists url_plantilla   text;
alter table public.tools add column if not exists headers         jsonb not null default '{}'::jsonb;
alter table public.tools add column if not exists cuerpo_plantilla text;
alter table public.tools add column if not exists permisos        jsonb not null default '{}'::jsonb;  -- { planes:[], clientes:[] }

-- Backfill: marca de las herramientas del sistema (idempotente por key).
update public.tools set tipo = 'sistema' where tipo is null;
update public.tools set categoria='datos',        proveedor='interno',  icono='🔎' where key='buscar_conocimiento';
update public.tools set categoria='sistema',      proveedor='interno',  icono='💬' where key='responder_al_usuario';
update public.tools set categoria='ventas',       proveedor='shopify',  icono='🛒' where key='consultar_producto';
update public.tools set categoria='ventas',       proveedor='interno',  icono='🧲' where key='crear_lead';
update public.tools set categoria='soporte',      proveedor='interno',  icono='🆘' where key='escalar_humano';
update public.tools set categoria='agenda',       proveedor='generico', icono='📅' where key='agendar';
update public.tools set categoria='memoria',      proveedor='interno',  icono='🧠' where key='recordar';
update public.tools set categoria='orquestacion', proveedor='interno',  icono='🔀' where key='delegar_a';

-- Config que el cliente completa para las tools de sistema que usan webhook opcional.
update public.tools set config_schema='[{"key":"webhook_url","label":"Webhook (URL)","tipo":"url","requerido":false}]'::jsonb
  where key in ('escalar_humano','agendar') and config_schema = '[]'::jsonb;
