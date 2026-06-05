-- ============================================================================
--  EDUCACIÓN DEL AGENTE: TALLERES de tejido  ·  Sofía / DyeTales
--  Agente: 51d2d1fe-e8db-4388-9365-95cecb571517
--
--  Objetivo: que Sofía entienda que dentro del catálogo hay productos que son
--  TALLERES (clases para aprender a tejer) y que SIEMPRE, ante cualquier
--  intención de aprender / tomar un curso / clase / taller, los informe de
--  inmediato y mande sus enlaces en "productos", sin preguntar antes.
--
--  Refuerza las 3 vías de educación de la plataforma:
--    1) documentos   -> conocimiento RAG (con sinónimos + enlaces reales)
--    2) agente_reglas -> conducta inyectada al prompt
--    3) agente_ejemplos -> few-shot
--
--  Idempotente: limpia SOLO lo relativo a talleres y lo vuelve a insertar.
--  El client_id se toma del propio agente.
--
--  IMPORTANTE: tras correr esto hay que VECTORIZAR el documento nuevo:
--      node scripts/ingest-pendientes.js
--  (requiere OPENAI_API_KEY en back/.env). Sin ese paso, el RAG no lo "verá".
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) CONOCIMIENTO (RAG): documento de Talleres enriquecido.
--    Se borran versiones previas del documento de talleres y se inserta una
--    sola, cargada de sinónimos para que el embedding la recupere ante muchas
--    formas de preguntar (taller, curso, clase, aprender, enseñan, etc.) y con
--    los ENLACES REALES completos de cada taller.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM public.documentos
WHERE agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  AND titulo ILIKE '%taller%';

INSERT INTO public.documentos (client_id, agente_id, tipo, titulo, contenido, estado)
SELECT a.client_id, a.id, 'texto', v.titulo, v.contenido, 'pendiente'
FROM public.agentes a,
(VALUES
  ($s$Talleres de tejido (cursos y clases para aprender)$s$,
   $s$DyeTales ofrece TALLERES de tejido: son productos del catálogo pensados para personas que quieren APRENDER a tejer y mejorar su técnica. Sinónimos y formas de preguntar que se refieren a esto: taller, talleres, curso, cursos, clase, clases, lección, capacitación, aprender a tejer, quiero aprender, enseñan a tejer, dónde aprendo, dan clases, workshop. Ante cualquiera de estas intenciones, SIEMPRE informa de los talleres y comparte sus enlaces.

Talleres disponibles (enlace https://dyetales.cl/products/{handle}):
- Taller Brioche en Plötulopi — $37.000 (handle: lana-taller-brioche-en-plotulopi). URL: https://dyetales.cl/products/lana-taller-brioche-en-plotulopi. Aprenderás la técnica brioche en plano, a 1 y 2 colores. Incluye materiales (excepto palillos), desayuno y la clase. Ideal para quien quiere partir o reforzar brioche. Próximas fechas por confirmar.
- Taller Plötulopi Avanzado — $37.000 (handle: lana-taller-plotulopi-avanzado). URL: https://dyetales.cl/products/lana-taller-plotulopi-avanzado. Colorwork (jacquard) con lana sin torcer Plötulopi tejido en circular. Requisito: saber tejer en redondo. Para quien ya teje y quiere subir de nivel. Próximas fechas por confirmar.

Las fechas se confirman al reservar; el cupo se toma comprando el taller en su enlace en la web. Cupos limitados.$s$)
) AS v(titulo, contenido)
WHERE a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) REGLA de conducta (se inyecta al prompt en TODA conversación).
--    Limpia reglas previas de talleres y agrega una en fase 'general' con
--    orden alto para que pese, sin tocar el resto de reglas del agente.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM public.agente_reglas
WHERE agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  AND texto ILIKE '%taller%';

INSERT INTO public.agente_reglas (client_id, agente_id, fase, texto, orden, activo)
SELECT a.client_id, a.id, v.fase, v.texto, v.orden, true
FROM public.agentes a,
(VALUES
  ($s$general$s$,
   $s$TALLERES (PRIORITARIO): Si la clienta muestra cualquier intención de aprender —menciona taller, curso, clase, lección, capacitación, "quiero aprender a tejer", "enseñan a tejer", "dan clases", "dónde aprendo" o algo similar— informa SIEMPRE y de inmediato sobre los talleres de tejido y agrégalos en "productos" con su precio y su enlace directo. NO preguntes antes "¿te interesa un taller?" ni "¿quieres más info?": ofrécelos directo. Si la consulta calza con un taller específico (brioche, colorwork/jacquard, Plötulopi, nivel avanzado), prioriza ese; si es general, ofrece ambos talleres.$s$, 90)
) AS v(fase, texto, orden)
WHERE a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) EJEMPLOS few-shot (enseñan el comportamiento esperado).
--    Limpia ejemplos previos de talleres y agrega nuevos.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM public.agente_ejemplos
WHERE agente_id = '51d2d1fe-e8db-4388-9365-95cecb571517'
  AND (entrada ILIKE '%taller%' OR salida ILIKE '%taller%'
       OR entrada ILIKE '%aprender a tejer%' OR entrada ILIKE '%clase%');

INSERT INTO public.agente_ejemplos (client_id, agente_id, entrada, salida, orden)
SELECT a.client_id, a.id, v.entrada, v.salida, v.orden
FROM public.agentes a,
(VALUES
  ($s$Quiero aprender a tejer, ¿tienen clases?$s$,
   $s${"respuesta": "¡Me encanta que quieras aprender! 🧶 Tenemos talleres presenciales para eso. El Taller Brioche en Plötulopi es ideal para partir (incluye materiales, desayuno y clase) y, si ya tejes en redondo, el Taller Plötulopi Avanzado te sube de nivel con colorwork. Te dejo ambos aquí abajo 💛", "productos": [{"nombre": "Taller Brioche en Plötulopi", "precio": "$37.000 CLP", "url": "https://dyetales.cl/products/lana-taller-brioche-en-plotulopi"}, {"nombre": "Taller Plötulopi Avanzado", "precio": "$37.000 CLP", "url": "https://dyetales.cl/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 0),
  ($s$¿Hacen talleres o cursos de tejido?$s$,
   $s${"respuesta": "¡Sí! 🧶 Tenemos dos talleres de tejido. El de Brioche en Plötulopi para aprender la técnica en plano a 1 y 2 colores, y el Plötulopi Avanzado de colorwork en circular (para quienes ya tejen en redondo). Ambos incluyen la clase y las próximas fechas se confirman al reservar ✨", "productos": [{"nombre": "Taller Brioche en Plötulopi", "precio": "$37.000 CLP", "url": "https://dyetales.cl/products/lana-taller-brioche-en-plotulopi"}, {"nombre": "Taller Plötulopi Avanzado", "precio": "$37.000 CLP", "url": "https://dyetales.cl/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 1),
  ($s$Me gustaría aprender colorwork / jacquard$s$,
   $s${"respuesta": "¡Justo para eso tenemos el Taller Plötulopi Avanzado! 💛 Es colorwork con lana sin torcer tejido en circular; el único requisito es saber tejer en redondo. Te lo dejo aquí para que reserves tu cupo 🧶", "productos": [{"nombre": "Taller Plötulopi Avanzado", "precio": "$37.000 CLP", "url": "https://dyetales.cl/products/lana-taller-plotulopi-avanzado"}], "acciones": []}$s$, 2)
) AS v(entrada, salida, orden)
WHERE a.id = '51d2d1fe-e8db-4388-9365-95cecb571517';

-- ============================================================================
--  FIN. Pasos siguientes:
--   1) Vectorizar el documento nuevo (OBLIGATORIO para que el RAG lo use):
--        node scripts/ingest-pendientes.js
--   2) Verificar:
--        select titulo, estado from public.documentos
--         where agente_id='51d2d1fe-e8db-4388-9365-95cecb571517' and titulo ilike '%taller%';
--        select fase, orden, texto from public.agente_reglas
--         where agente_id='51d2d1fe-e8db-4388-9365-95cecb571517' and texto ilike '%taller%';
--        select entrada from public.agente_ejemplos
--         where agente_id='51d2d1fe-e8db-4388-9365-95cecb571517' and salida ilike '%taller%';
-- ============================================================================
