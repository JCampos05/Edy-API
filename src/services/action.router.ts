import type { IntentResult } from '../types';
import { PrismaClient, Priority } from '@prisma/client';
import { taskeerClient } from './taskeer.client';
import { weatherlyClient } from './weatherly.client';

const prisma = new PrismaClient();

export interface ActionResult {
    success: boolean;
    message: string;
    data?: unknown;
}

/**
 * Recibe el intent analizado por Ollama y ejecuta la acción correspondiente.
 * Retorna un mensaje legible que se puede incluir en la respuesta al usuario.
 */
export async function executeIntent(intent: IntentResult): Promise<ActionResult> {
    switch (intent.type) {

        // ── Crear recordatorio / tarea ─────────────────────────────────────────
        case 'CREATE_REMINDER':
        case 'CREATE_TASK': {
            const { task, datetime, priority, projectSlug } = intent.params;
            if (!task) return { success: false, message: 'No se detectó descripción de la tarea.' };

            const created = await prisma.task.create({
                data: {
                    title: task,
                    dueAt: datetime ? new Date(datetime) : undefined,
                    priority: (priority as Priority) ?? 'MEDIUM',
                    projectSlug: projectSlug ?? null,
                    source: 'edy',
                },
            });

            // Intentar sincronizar con Taskeer si está configurado
            if (process.env.TASKEER_API_URL) {
                await taskeerClient.createTask(created).catch(err =>
                    console.warn('[action] Taskeer sync failed:', err.message)
                );
            }

            const when = created.dueAt
                ? ` para el ${created.dueAt.toLocaleString('es-MX')}`
                : '';
            return {
                success: true,
                message: `Tarea creada: "${created.title}"${when}.`,
                data: created,
            };
        }

        // ── Consultar clima ────────────────────────────────────────────────────
        case 'GET_WEATHER': {
            const location = intent.params.location ?? 'Los Mochis, Sinaloa';
            try {
                const weather = await weatherlyClient.getCurrent(location);
                return {
                    success: true,
                    message: `Clima en ${location}: ${weather.description}, ${weather.temp}°C.`,
                    data: weather,
                };
            } catch (err) {
                return { success: false, message: `No se pudo obtener el clima para ${location}.` };
            }
        }

        // ── Listar tareas ──────────────────────────────────────────────────────
        case 'GET_TASK_LIST': {
            const tasks = await prisma.task.findMany({
                where: { status: { not: 'CANCELLED' } },
                orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
                take: 10,
            });

            if (tasks.length === 0) {
                return { success: true, message: 'No tienes tareas pendientes.', data: [] };
            }

            const list = tasks
                .map((t, i) => `${i + 1}. ${t.title}${t.dueAt ? ` (${t.dueAt.toLocaleDateString('es-MX')})` : ''}`)
                .join('\n');

            return {
                success: true,
                message: `Tienes ${tasks.length} tarea(s) pendiente(s):\n${list}`,
                data: tasks,
            };
        }

        // ── Abrir contexto de proyecto ─────────────────────────────────────────
        case 'OPEN_PROJECT': {
            const slug = intent.params.projectSlug;
            if (!slug) return { success: false, message: 'No se detectó nombre de proyecto.' };
            return {
                success: true,
                message: `Contexto del proyecto "${slug}" cargado en la conversación.`,
                data: { projectSlug: slug },
            };
        }

        // ── Consulta general — no requiere acción externa ─────────────────────
        case 'GENERAL_QUERY':
        default:
            return { success: true, message: '' };
    }
}