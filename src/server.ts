import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import { commandRouter } from './routes/command';
import { sessionRouter } from './routes/session';
import { projectRouter } from './routes/project';
import { taskRouter }    from './routes/task';
import { actionRouter }  from './routes/action';

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/command',  commandRouter);   // Recibe texto del ESP32/cliente
app.use('/api/v1/sessions', sessionRouter);   // Gestión de sesiones
app.use('/api/v1/projects', projectRouter);   // Registro y consulta de proyectos
app.use('/api/v1/tasks',    taskRouter);
app.use('/api/v1/actions',  actionRouter);       // Tareas y recordatorios

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
});