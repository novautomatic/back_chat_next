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
