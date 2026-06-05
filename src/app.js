// App Express (exportada). La usan tanto el server local como Vercel.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import clientesRoutes from './routes/clientes.js';
import agentesRoutes from './routes/agentes.js';
import flujosRoutes from './routes/flujos.js';
import documentosRoutes from './routes/documentos.js';
import conversacionesRoutes from './routes/conversaciones.js';
import widgetRoutes from './routes/widget.js';
import integracionesRoutes from './routes/integraciones.js';
import webhooksRoutes from './routes/webhooks.js';

const app = express();

// Webhooks ANTES del json global: necesitan el body crudo para validar el HMAC
// (el router usa su propio express.raw). No deben pasar por express.json().
app.use('/webhooks', webhooksRoutes);

app.use(express.json({ limit: '2mb' }));

// CORS: el dashboard tiene origenes definidos; el widget (publico) se permite abierto.
const dashOrigins = (process.env.DASHBOARD_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: true })); // abierto: el widget vive en webs de terceros
void dashOrigins; // referencia para futura restriccion del dashboard

app.get('/', (_req, res) => res.json({ ok: true, servicio: 'agente-back' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/clientes', clientesRoutes);
app.use('/agentes', agentesRoutes);
app.use('/flujos', flujosRoutes);
app.use('/documentos', documentosRoutes);
app.use('/conversaciones', conversacionesRoutes);
app.use('/widget', widgetRoutes);
app.use('/integraciones', integracionesRoutes);

// 404 + manejador de errores.
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno' });
});

export default app;
