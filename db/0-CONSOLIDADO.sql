-- ############################################################################
-- #  CONSOLIDADO DE MIGRACIONES  ·  Agente-Next (motor a agente)
-- #
-- #  Pega TODO este archivo en Supabase Studio > SQL Editor y dale Run.
-- #
-- #  100% IDEMPOTENTE: es seguro correrlo aunque ya hayas ejecutado algunos
-- #  de los SQL por separado. No duplica datos, no borra nada (salvo
-- #  re-inserciones controladas en la seccion OPCIONAL de Sofia), y se puede
-- #  re-correr las veces que quieras.
-- #
-- #  PRERREQUISITO: schema.sql ya aplicado (tablas base clientes/agentes/
-- #  conversaciones/mensajes/documentos/flujos/agente_reglas/agente_ejemplos,
-- #  extension pgvector, y las funciones es_super_admin() / mi_client_id()).
-- #  En tu proyecto en produccion eso ya existe.
-- #
-- #  ORDEN (por dependencias):
-- #    1. trazas              (Fase 0 · telemetria)
-- #    2. motor-agente        (Fase 1 · flag modo_motor + catalogo tools)
-- #    3. tools-negocio       (Fase 2 · leads, escalado, seed tools)
-- #    4. memoria             (Fase 3 · memoria_visitante + resumen)
-- #    5. equipos             (Fase 4 · orquestacion multi-agente)
-- #    6. observabilidad      (Fase 5 · feedback + evals)
-- #    7. tools-admin         (catalogo ampliado + backfill de marca)
-- #    8. ajustes-agente      (max_productos / rag_fragmentos / max_historial)
-- #    9. documentos-editable (documentos.bloqueado)
-- #   10. etapas              (agente_secciones + area; reemplaza secciones.sql)
-- #   11. [OPCIONAL] sofia-normas (datos del agente Sofia/DyeTales)
-- #
-- #  DESPUES: reinicia el backend :4000. Para activar el motor en un agente:
-- #    update agentes set modo_motor='loop' where id='<id-del-agente>';
-- #  y activa sus tools insertando filas en agente_tools (incluyendo siempre
-- #  buscar_conocimiento + responder_al_usuario). Rollback: modo_motor='clasico'.
-- ############################################################################



-- ############################################################################
-- ##  >>> trazas.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> motor-agente.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> tools-negocio.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> memoria.sql
-- ############################################################################
-- ============================================================================
--  Memoria del agente  (Fase 3)
--
--  - conversaciones.resumen*: resumen incremental de la conversacion (da
--    continuidad mas alla de la ventana de ultimos N mensajes).
--  - memoria_visitante: hechos/preferencias DURABLES por visitante recurrente,
--    identificado por visitante_key (email: / tel: / cookie:). Se recuperan por
--    similitud coseno EN MEMORIA (igual criterio que fragmentos / rag.js).
--  - tool `recordar`: el agente decide que guardar (se activa via agente_tools).
--
--  Idempotente. Correr DESPUES de schema.sql y motor-agente.sql.
-- ============================================================================

-- 1) Resumen incremental en conversaciones ------------------------------------
alter table public.conversaciones
  add column if not exists resumen               text;
alter table public.conversaciones
  add column if not exists resumen_hasta_mensaje uuid;
alter table public.conversaciones
  add column if not exists resumen_actualizado_at timestamptz;

-- 2) Memoria de largo plazo por visitante -------------------------------------
create table if not exists public.memoria_visitante (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references public.clientes(id) on delete cascade,
  agente_id     uuid references public.agentes(id) on delete set null,
  visitante_key text not null,                 -- email:... | tel:... | cookie:...
  tipo          text not null default 'hecho', -- hecho | preferencia | resumen_conv
  contenido     text not null,
  embedding     vector(1536),
  importancia   int  not null default 1,
  ultima_vez    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_memoria_vis_lookup
  on public.memoria_visitante(client_id, visitante_key);
create index if not exists idx_memoria_vis_embedding
  on public.memoria_visitante using hnsw (embedding vector_cosine_ops);

alter table public.memoria_visitante enable row level security;
drop policy if exists memoria_visitante_rw on public.memoria_visitante;
create policy memoria_visitante_rw on public.memoria_visitante for all
  using (public.es_super_admin() or client_id = public.mi_client_id())
  with check (public.es_super_admin() or client_id = public.mi_client_id());

-- 3) Semilla de la tool `recordar` (idempotente por `key`) --------------------
insert into public.tools (key, nombre, descripcion, ambito) values
  ('recordar', 'Recordar (memoria)', 'Guarda un dato durable del visitante para futuras conversaciones.', 'todas')
on conflict (key) do nothing;


-- ############################################################################
-- ##  >>> equipos.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> observabilidad.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> tools-admin.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> ajustes-agente.sql
-- ############################################################################
-- ============================================================================
--  Ajustes de COMPORTAMIENTO del agente  (configurables, no hardcodeados)
--
--  Saca al panel parámetros que antes vivían fijos en el código:
--   - max_productos : tope de productos por respuesta (antes: sin límite -> "los
--     manda todos de golpe"). Default 6 = base para todos los agentes.
--   - rag_fragmentos: cuántos fragmentos de conocimiento recupera el RAG por
--     turno (antes: fijo 8).
--   - max_historial : cuántos mensajes previos entran como contexto (antes: 12).
--
--  Al agregar la columna con DEFAULT, Postgres rellena las filas existentes con
--  ese valor: así TODOS los agentes (presentes y futuros) heredan la base, y
--  cada uno se puede ajustar desde el panel. Para cambiar la BASE de los futuros
--  agentes, cambia el DEFAULT de la columna (alter ... set default N).
--
--  Idempotente. Correr DESPUES de motor-agente.sql.
-- ============================================================================

alter table public.agentes add column if not exists max_productos  int not null default 6;
alter table public.agentes add column if not exists rag_fragmentos int not null default 8;
alter table public.agentes add column if not exists max_historial  int not null default 12;


-- ############################################################################
-- ##  >>> documentos-editable.sql
-- ############################################################################
-- ============================================================================
--  Documentos EDITABLES manualmente  (conocimiento + productos Shopify)
--
--  `bloqueado` = el documento fue editado a mano y manda su `contenido`:
--   - La ingesta (ingest.js) vectoriza desde `contenido` (no re-extrae de la
--     URL/archivo/Shopify), así la edición manual es la fuente de verdad.
--   - La re-sincronización de Shopify NO lo borra ni lo sobreescribe, así tus
--     cambios manuales sobre un producto sobreviven a futuras syncs.
--
--  Idempotente. Correr DESPUES de schema.sql.
-- ============================================================================
alter table public.documentos add column if not exists bloqueado boolean not null default false;


-- ############################################################################
-- ##  >>> etapas.sql
-- ############################################################################
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


-- ############################################################################
-- ##  >>> sofia-normas.sql   [OPCIONAL · solo afecta al agente de Sofia]
-- ##  Si esta BD no es la de DyeTales, los updates/inserts simplemente no
-- ##  encuentran ese agente id y no hacen nada. Puedes borrar esta seccion.
-- ############################################################################
-- ============================================================================
--  NORMAS de Sofía / DyeTales  ·  Agente 51d2d1fe-e8db-4388-9365-95cecb571517
--
--  Consolida TODO lo que acordamos en una sola corrida idempotente:
--   0) Asegura las columnas de ajustes (por si no corriste ajustes-agente.sql).
--   1) Ajustes CONFIGURABLES de Sofía (el tope de productos ya NO es hardcode:
--      es la columna agentes.max_productos; aquí solo le ponemos el valor 3).
--   2) Norma de TALLERES (regla inyectada al prompt).
--   3) Norma "no listar todos los colores de golpe" (cualitativa, sin número).
--   4) Ejemplos few-shot de talleres.
--
--  Los PRODUCTOS de taller (Taller Brioche / Taller Plotulopi avanzado) NO se
--  cargan aquí: vienen del catálogo Shopify (ya los traje y vectoricé). Si
--  vuelven a faltar, re-sincroniza la tienda en Integraciones.
--
--  Seguro de re-correr. Se puede ejecutar entero en Supabase Studio.
-- ============================================================================

-- 0) Columnas de ajustes (idempotente; rellena los agentes existentes con la base).
alter table public.agentes add column if not exists max_productos  int not null default 6;
alter table public.agentes add column if not exists rag_fragmentos int not null default 8;
alter table public.agentes add column if not exists max_historial  int not null default 12;

-- 1) Ajustes de comportamiento de Sofía (configurables; aquí fijamos sus valores).
--    max_productos = 3  -> no "manda todos de golpe" (lo aplica el motor, no el prompt).
update public.agentes
set max_productos  = 3,
    rag_fragmentos = 8,
    max_historial  = 12
where id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- 2) NORMA: TALLERES (regla en fase 'general', orden alto para que pese).
--    Idempotente: borra cualquier regla previa de talleres y la vuelve a insertar.
delete from public.agente_reglas
where agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  and texto ilike '%taller%';

insert into public.agente_reglas (client_id, agente_id, fase, texto, orden, activo)
select a.client_id, a.id, 'general', $s$TALLERES (PRIORITARIO): Si la clienta muestra cualquier intención de aprender —menciona taller, curso, clase, lección, capacitación, "quiero aprender a tejer", "enseñan a tejer", "dan clases", "dónde aprendo" o similar— informa SIEMPRE y de inmediato sobre los TALLERES de tejido y agrégalos en "productos" con su precio y su enlace directo. Los talleres son productos reales del catálogo cuyo nombre EMPIEZA con "Taller" (ej: "Taller Brioche en Plotulopi", "Taller Plotulopi avanzado"). NO confundas con lanas: la palabra "taller" aparece en muchas descripciones de lana porque están "teñidas a mano en nuestro taller"; esas NO son clases. Si la consulta calza con un taller específico (brioche, colorwork/jacquard, Plötulopi, avanzado), prioriza ese; si es general, ofrece ambos. NUNCA preguntes antes "¿te interesa un taller?": ofrécelos directo.$s$, 90, true
from public.agentes a
where a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- 3) NORMA: no listar todos los colores/productos de golpe (cualitativa).
--    El NÚMERO exacto lo controla agentes.max_productos (configurable); esta regla
--    solo guía el estilo. Idempotente por una frase-marcador.
delete from public.agente_reglas
where agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  and texto ilike '%no listes todos%';

insert into public.agente_reglas (client_id, agente_id, fase, texto, orden, activo)
select a.client_id, a.id, 'general', $s$SELECCIÓN DE PRODUCTOS: No listes todos los colores ni todos los productos de una línea de golpe. Muestra solo los más relevantes para lo que pide la clienta; si hay muchas opciones, ofrece unas pocas y dile que hay más colores/variantes disponibles para que pida el que quiera. Cuando digas que vas a mostrar algo ("te lo dejo aquí", "mira estos"), SIEMPRE inclúyelo de verdad en "productos"; nunca anuncies que lo mandarás sin adjuntarlo.$s$, 80, true
from public.agentes a
where a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- 4) EJEMPLOS few-shot de talleres (idempotente).
delete from public.agente_ejemplos
where agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  and (entrada ilike '%taller%' or salida ilike '%taller%'
       or entrada ilike '%aprender a tejer%' or entrada ilike '%clase%');

insert into public.agente_ejemplos (client_id, agente_id, entrada, salida, orden)
select a.client_id, a.id, v.entrada, v.salida, v.orden
from public.agentes a,
(values
  ($s$Quiero aprender a tejer, ¿tienen clases?$s$,
   $s${"respuesta": "¡Me encanta que quieras aprender! 🧶 Tenemos talleres presenciales para eso. El Taller Brioche en Plötulopi es ideal para partir (incluye materiales, desayuno y clase) y, si ya tejes en redondo, el Taller Plötulopi Avanzado te sube de nivel con colorwork. Te dejo ambos aquí abajo 💛", "productos": [{"nombre": "Taller Brioche en Plotulopi", "precio": "$37.000 CLP", "url": "https://mxx6fy-dd.myshopify.com/products/lana-taller-brioche-en-plotulopi"}, {"nombre": "Taller Plotulopi avanzado", "precio": "$37.000 CLP", "url": "https://mxx6fy-dd.myshopify.com/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 0),
  ($s$¿Hacen talleres o cursos de tejido?$s$,
   $s${"respuesta": "¡Sí! 🧶 Tenemos dos talleres de tejido. El de Brioche en Plötulopi para aprender la técnica en plano a 1 y 2 colores, y el Plötulopi Avanzado de colorwork en circular (para quienes ya tejen en redondo). Las próximas fechas se confirman al reservar ✨", "productos": [{"nombre": "Taller Brioche en Plotulopi", "precio": "$37.000 CLP", "url": "https://mxx6fy-dd.myshopify.com/products/lana-taller-brioche-en-plotulopi"}, {"nombre": "Taller Plotulopi avanzado", "precio": "$37.000 CLP", "url": "https://mxx6fy-dd.myshopify.com/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 1),
  ($s$Me gustaría aprender colorwork / jacquard$s$,
   $s${"respuesta": "¡Justo para eso tenemos el Taller Plötulopi Avanzado! 💛 Es colorwork con lana sin torcer tejido en circular; el único requisito es saber tejer en redondo. Te lo dejo aquí para que reserves tu cupo 🧶", "productos": [{"nombre": "Taller Plotulopi avanzado", "precio": "$37.000 CLP", "url": "https://mxx6fy-dd.myshopify.com/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 2)
) as v(entrada, salida, orden)
where a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- ============================================================================
--  Verificación rápida (opcional):
--   select max_productos, rag_fragmentos, max_historial from public.agentes
--    where id='51d2d1fe-e8db-4388-9365-95cecb571517';
--   select fase, orden, left(texto,60) from public.agente_reglas
--    where agente_id='51d2d1fe-e8db-4388-9365-95cecb571517' order by orden desc;
-- ============================================================================
