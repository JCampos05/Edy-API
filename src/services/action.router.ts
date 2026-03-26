import type { IntentResult } from '../types';
import { PrismaClient, Priority } from '@prisma/client';
import { taskeerClient } from './taskeer.client';
import { weatherlyClient } from './weatherly.client';
import { extractDateFromText, formatDateForReply } from './dateParser';
import { scaffoldProject } from './scaffold.service';
import { createTaskBatch, normalizeBatchItems } from './BatchTask.service';
import type { ProjectStack } from '../types/project.types';

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

            // Parsear fecha desde el campo datetime O extrayéndola del texto original
            let dueAt: Date | undefined;
            if (datetime) {
                const parsed = extractDateFromText(datetime);
                if (parsed) dueAt = new Date(parsed.iso);
            } else {
                const parsed = extractDateFromText(intent.rawText);
                if (parsed) dueAt = new Date(parsed.iso);
            }

            const created = await prisma.task.create({
                data: {
                    title: task,
                    dueAt: dueAt ?? null,
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
                ? ` para ${formatDateForReply(created.dueAt.toISOString())}`
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

        // ── Crear múltiples tareas en batch ───────────────────────────────────
        case 'CREATE_TASK_BATCH': {
            const rawTasks = intent.params.tasks;
            const projectSlug = intent.params.projectSlug ?? null;
            const items = normalizeBatchItems(rawTasks, intent.rawText);

            if (items.length === 0) {
                return { success: false, message: 'No se detectaron tareas en el comando.' };
            }

            const result = await createTaskBatch(items, projectSlug);

            return {
                success: result.created > 0,
                message: result.summary,
                data: result.tasks,
            };
        }

        // ── Crear proyecto con scaffold ───────────────────────────────────────
        case 'CREATE_PROJECT': {
            const { projectName, stack, description, tasks } = intent.params as {
                projectName?: string;
                stack?: string;
                description?: string;
                tasks?: unknown;
            };

            if (!projectName) {
                return { success: false, message: 'No se detectó nombre para el proyecto.' };
            }

            const validStack = (stack as ProjectStack) ?? 'generic';

            // 1. Generar estructura en disco
            const scaffold = await scaffoldProject(projectName, validStack, description ?? '');

            // 2. Registrar en la tabla projects
            await prisma.project.upsert({
                where: { slug: scaffold.projectSlug },
                update: { name: projectName, description: description ?? null },
                create: {
                    slug: scaffold.projectSlug,
                    name: projectName,
                    description: description ?? null,
                    contextPath: scaffold.projectPath,
                    isActive: true,
                },
            });

            // 3. Crear tareas iniciales si las hay
            let tasksCreated = 0;
            if (tasks) {
                const items = normalizeBatchItems(tasks, '');
                if (items.length > 0) {
                    const batch = await createTaskBatch(items, scaffold.projectSlug);
                    tasksCreated = batch.created;
                }
            }

            const fileList = scaffold.filesCreated
                .slice(0, 6)
                .map(f => `  • ${f}`)
                .join('\n');

            const extraFiles = scaffold.filesCreated.length > 6
                ? `\n  ...y ${scaffold.filesCreated.length - 6} archivo(s) más`
                : '';

            return {
                success: true,
                message: [
                    `Proyecto "${projectName}" creado en ${scaffold.projectPath}`,
                    `Stack: ${validStack}`,
                    `Archivos generados:\n${fileList}${extraFiles}`,
                    tasksCreated > 0 ? `Tareas creadas: ${tasksCreated}` : '',
                ].filter(Boolean).join('\n'),
                data: { ...scaffold, tasksCreated },
            };
        }

        // ── Consulta general — no requiere acción externa ─────────────────────
        case 'GENERAL_QUERY':
        default:
            return { success: true, message: '' };
    }
}