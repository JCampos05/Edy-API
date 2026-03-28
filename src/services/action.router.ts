import type { IntentResult } from '../types';
import { PrismaClient } from '@prisma/client';
import type { Priority } from '@prisma/client';
import { taskeerClient } from '../integrations/taskeer.client';
import { weatherlyClient } from '../integrations/weatherly.client';
import { extractDateFromText, formatDateForReply } from '../utils/date-parser';
import { scaffoldProject } from './scaffold.service';
import { createTaskBatch, normalizeBatchItems } from './BatchTask.service';
import {
    executeShellCommand,
    checkAvailableTools,
    npmInstall,
    pipInstallRequirements,
} from './shell.service';
import type { ProjectStack } from '../types/project.types';

const prisma = new PrismaClient();

export interface ActionResult {
    success: boolean;
    message: string;
    data?: unknown;
}

/**
 * Recibe el intent analizado por Ollama y ejecuta la acción correspondiente.
 * Retorna un mensaje legible para incluir en la respuesta al usuario.
 */
export async function executeIntent(intent: IntentResult): Promise<ActionResult> {
    switch (intent.type) {

        // ── Crear recordatorio / tarea ─────────────────────────────────────────
        case 'CREATE_REMINDER':
        case 'CREATE_TASK': {
            const { task, datetime, priority, projectSlug } = intent.params;
            if (!task) return { success: false, message: 'No se detectó descripción de la tarea.' };

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
            } catch {
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
            const { projectSlug } = intent.params;
            if (!projectSlug) return { success: false, message: 'No se detectó nombre de proyecto.' };
            return {
                success: true,
                message: `Contexto del proyecto "${projectSlug}" cargado en la conversación.`,
                data: { projectSlug },
            };
        }

        // ── Crear múltiples tareas en batch ────────────────────────────────────
        case 'CREATE_TASK_BATCH': {
            const { tasks: rawTasks, projectSlug } = intent.params;
            const items = normalizeBatchItems(rawTasks, intent.rawText);

            if (items.length === 0) {
                return { success: false, message: 'No se detectaron tareas en el comando.' };
            }

            const result = await createTaskBatch(items, projectSlug ?? null);
            return {
                success: result.created > 0,
                message: result.summary,
                data: result.tasks,
            };
        }

        // ── Crear proyecto con scaffold ────────────────────────────────────────
        case 'CREATE_PROJECT': {
            const { projectName, stack, description, tasks, autoInstall } = intent.params;

            if (!projectName) {
                return { success: false, message: 'No se detectó nombre para el proyecto.' };
            }

            const validStack = (stack as ProjectStack | undefined) ?? 'generic';
            const installLines: string[] = [];

            const scaffold = await scaffoldProject(
                projectName,
                validStack,
                description ?? '',
                {
                    autoInstall: autoInstall ?? false,
                    onInstallOutput: (line) => installLines.push(line),
                }
            );

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

            let tasksCreated = 0;
            if (tasks) {
                const items = normalizeBatchItems(tasks, '');
                if (items.length > 0) {
                    const batch = await createTaskBatch(items, scaffold.projectSlug);
                    tasksCreated = batch.created;
                }
            }

            const fileList = scaffold.filesCreated.slice(0, 6).map(f => `  • ${f}`).join('\n');
            const extraFiles = scaffold.filesCreated.length > 6
                ? `\n  ...y ${scaffold.filesCreated.length - 6} archivo(s) más` : '';
            const installNote = scaffold.installLog?.length
                ? `\nInstalación: ${scaffold.installLog.join(' | ')}` : '';

            return {
                success: true,
                message: [
                    `Proyecto "${projectName}" creado en ${scaffold.projectPath}`,
                    `Stack: ${validStack}`,
                    `Archivos generados:\n${fileList}${extraFiles}`,
                    tasksCreated > 0 ? `Tareas creadas: ${tasksCreated}` : '',
                    installNote,
                ].filter(Boolean).join('\n'),
                data: { ...scaffold, tasksCreated },
            };
        }

        // ── Ejecutar comando de shell ──────────────────────────────────────────
        case 'RUN_COMMAND': {
            const { command, projectSlug, cwd } = intent.params;

            if (!command) {
                return { success: false, message: 'No se detectó ningún comando para ejecutar.' };
            }

            const CONTEXT_BASE = process.env.CONTEXT_BASE_PATH ?? './projects';
            const workingDir = (cwd as string | undefined)
                ?? (projectSlug ? `${CONTEXT_BASE}/${projectSlug}` : process.cwd());

            const outputLines: string[] = [];

            const result = await executeShellCommand(command, {
                cwd: workingDir,
                onOutput: (line, stream) => {
                    outputLines.push(stream === 'stderr' ? `[err] ${line}` : line);
                },
            });

            const outputPreview = outputLines.slice(-15).join('\n');
            const fullMessage = [
                result.summary,
                outputPreview ? `\`\`\`\n${outputPreview}\n\`\`\`` : '',
            ].filter(Boolean).join('\n');

            return {
                success: result.success,
                message: fullMessage,
                data: {
                    exitCode: result.exitCode,
                    durationMs: result.durationMs,
                    stdout: result.stdout.slice(-2000),
                    stderr: result.stderr.slice(-1000),
                },
            };
        }

        // ── Instalar dependencias de proyecto existente ────────────────────────
        case 'INSTALL_DEPS': {
            const { projectSlug } = intent.params;
            const CONTEXT_BASE = process.env.CONTEXT_BASE_PATH ?? './projects';

            if (!projectSlug) {
                return { success: false, message: 'Indica el proyecto donde instalar dependencias.' };
            }

            const projectPath = `${CONTEXT_BASE}/${projectSlug}`;
            const outputLines: string[] = [];
            const onOutput = (line: string) => outputLines.push(line);

            const fs = await import('fs');
            const hasPackageJson = fs.existsSync(`${projectPath}/package.json`);
            const hasRequirements = fs.existsSync(`${projectPath}/requirements.txt`);

            if (!hasPackageJson && !hasRequirements) {
                return {
                    success: false,
                    message: `No encontré package.json ni requirements.txt en "${projectSlug}".`,
                };
            }

            const results: string[] = [];

            if (hasPackageJson) {
                const r = await npmInstall(projectPath, onOutput);
                results.push(r.summary);
            }

            if (hasRequirements) {
                const r = await pipInstallRequirements(projectPath, onOutput);
                results.push(r.summary);
            }

            return {
                success: true,
                message: results.join('\n'),
                data: { outputLines },
            };
        }

        // ── Verificar herramientas disponibles ─────────────────────────────────
        case 'CHECK_TOOLS': {
            const tools = await checkAvailableTools();
            const lines = Object.entries(tools)
                .map(([tool, available]) => `${available ? '✓' : '✗'} ${tool}`)
                .join('\n');

            return {
                success: true,
                message: `Herramientas disponibles en el sistema:\n${lines}`,
                data: tools,
            };
        }

        // ── Consulta general — no requiere acción externa ──────────────────────
        case 'GENERAL_QUERY':
        default:
            return { success: true, message: '' };
    }
}