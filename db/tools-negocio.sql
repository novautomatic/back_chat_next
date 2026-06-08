-- ============================================================================
--  Tools de negocio  (Fase 2): leads, escalado a humano y catalogo de tools.
--
--  - leads: contactos capturados por la tool crear_lead (y solicitudes de cita).
--  - conversaciones.escalada*: marca cuando la tool escalar_humano deriva el caso.
--  - Semilla de las tools de negocio en el catalogo `tools` (creado en
--    motor-agente.sql). Estas tools NO estan en el set base: se activan por
--    agente insertando filas en agente_tools (UI en fase posterior).
--
--  Idempotente. Correr DESPUES de schema.sql y motor-agente.sql.
-- ============================================================================

-- 1) Leads --------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clientes(id) on delete cascade,
  agente_id       uuid references public.agentes(id) on delete set null,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  nombre          text,
  email           text,
  telefono        text,
  nota            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_leads_client on public.leads(client_id, created_at);
create index if not exists idx_leads_agente on public.leads(agente_id);

alter table public.leads enable row level security;
drop policy if exists leads_rw on public.leads;
create policy leads_rw on public.leads for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

-- 2) Escalado a humano en conversaciones --------------------------------------
alter table public.conversaciones
  add column if not exists escalada        boolean not null default false;
alter table public.conversaciones
  add column if not exists escalada_motivo text;
alter table public.conversaciones
  add column if not exists escalada_at      timestamptz;

-- 3) Semilla de tools de negocio (idempotente por `key`) ----------------------
insert into public.tools (key, nombre, descripcion, ambito) values
  ('consultar_producto', 'Consultar producto (en vivo)', 'Consulta precio, disponibilidad y stock actual en la tienda Shopify conectada.', 'ventas'),
  ('crear_lead',         'Crear lead',                   'Guarda los datos de contacto del visitante (nombre/email/telefono).', 'todas'),
  ('escalar_humano',     'Escalar a humano',             'Marca la conversacion para que la atienda una persona; notifica por webhook si esta configurado.', 'soporte'),
  ('agendar',            'Agendar cita',                 'Agenda/reserva una cita; delega a un webhook de agenda si esta configurado.', 'reservas')
on conflict (key) do nothing;
