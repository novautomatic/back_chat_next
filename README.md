# agente-back

Backend (Node.js + Express, JS) de la plataforma de chatbots multi-cliente.

## Requisitos
- Node 20+
- Un proyecto Supabase (Postgres + pgvector + Auth + Storage + Realtime)
- Una API key de OpenAI

## Puesta en marcha

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Copiar variables de entorno:
   ```bash
   cp .env.example .env   # en Windows: copy .env.example .env
   ```
   y rellenar `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`.
3. Crear el esquema en Supabase: abrir **SQL Editor** y ejecutar `db/schema.sql`.
4. Crear tu super admin: en **Authentication > Users** crea tu usuario, luego ejecuta `db/seed.sql` (ajusta el email).
5. Arrancar en local:
   ```bash
   npm run dev          # http://localhost:4000
   ```

## Arquitectura
- `src/app.js` — app Express (rutas + middleware).
- `src/lib/` — clientes de Supabase (service_role), OpenAI y broadcast Realtime.
- `src/middleware/` — auth del dashboard (+ impersonacion super admin) y resolucion del widget.
- `src/services/` — `promptBuilder` (arma el system prompt desde la BD), `rag`, `ingest`, `orchestrator`.
- `src/routes/` — `auth, clientes, agentes, flujos, documentos, conversaciones, widget`.
- `api/index.js` + `vercel.json` — despliegue serverless en Vercel.

## Notas
- El **service_role key** solo vive aqui. Nunca en el front ni en el widget.
- La entrega del chat al widget es por **Supabase Realtime Broadcast** (canal `widget:{conversacion_id}`).
- Toda tabla lleva `client_id`; el scope se aplica en cada ruta (`req.effectiveClientId`).
