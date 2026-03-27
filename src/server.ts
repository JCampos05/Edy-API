import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { commandRouter } from './routes/command.route';
import { sessionRouter } from './routes/session.route';
import { projectRouter } from './routes/project.route';
import { taskRouter } from './routes/task.route';
import { actionRouter } from './routes/action.route';
import { streamRouter } from './routes/stream.route';
import { deviceAutoRegister } from './middleware/deviceAutoRegister';
import { startScheduler } from './services/scheduler.service';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors({ origin: '*' })); // Ajusta el origin en producción
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(deviceAutoRegister); // Auto-registra cualquier deviceId nuevo

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/command', commandRouter);   // Recibe texto del ESP32/cliente
app.use('/api/v1/sessions', sessionRouter);   // Gestión de sesiones
app.use('/api/v1/projects', projectRouter);   // Registro y consulta de proyectos
app.use('/api/v1/tasks', taskRouter);
app.use('/api/v1/actions', actionRouter);
app.use('/api/v1/stream', streamRouter);       // Tareas y recordatorios

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'edy-api', timestamp: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`\nEdy API running → http://localhost:${PORT}`);
  console.log(`Model: ${process.env.OLLAMA_MODEL}`);
  console.log(`Context path: ${process.env.CONTEXT_BASE_PATH}\n`);
  startScheduler();
});