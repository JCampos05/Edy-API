import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { executeShellCommand, npmInstall, pipInstallRequirements, checkAvailableTools } from '../services/shell.service';
import { scaffoldProject } from '../services/scaffold.service';
import { createTaskBatch, normalizeBatchItems } from '../services/BatchTask.service';
import { PrismaClient } from '@prisma/client';
import type { ProjectStack } from '../types/project.types';
import path from 'path';
import fs from 'fs';

export const actionStreamRouter = Router();
const prisma = new PrismaClient();
const CONTEXT_BASE = process.env.CONTEXT_BASE_PATH ?? './projects';

const StreamActionSchema = z.object({
    type: z.enum(['RUN_COMMAND', 'INSTALL_DEPS', 'CHECK_TOOLS', 'CREATE_PROJECT']),
    params: z.record(z.unknown()).default({}),
});

/**
 * POST /api/v1/actions/stream
 *
 * Ejecuta un intent de shell y emite el output línea a línea vía SSE.
 *
 * Eventos emitidos:
 *   data: { "type": "shell_output", "content": "línea", "stream": "stdout"|"stderr" }
 *   data: { "type": "shell_done",   "exitCode": 0, "durationMs": 1234 }
 *   data: { "type": "error",        "content": "mensaje" }
 */
actionStreamRouter.post('/stream', async (req: Request, res: Response) => {
    const parsed = StreamActionSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        return;
    }

    const { type, params } = parsed.data;

    // ── Cabeceras SSE ────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const emit = (payload: object) => {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    };

    const onOutput = (line: string, stream: 'stdout' | 'stderr') => {
        emit({ type: 'shell_output', content: line, stream });
    };

    // Cancelar si el cliente se desconecta
    let cancelled = false;
    req.on('close', () => { cancelled = true; });

    try {
        switch (type) {

            // ── Ejecutar comando arbitrario ──────────────────────────────────
            case 'RUN_COMMAND': {
                const command = String(params['command'] ?? '');
                const projectSlug = params['projectSlug'] as string | undefined;
                const cwd = (params['cwd'] as string | undefined)
                    ?? (projectSlug ? path.join(CONTEXT_BASE, projectSlug) : process.cwd());

                if (!command) {
                    emit({ type: 'error', content: 'No se especificó ningún comando.' });
                    break;
                }

                const result = await executeShellCommand(command, { cwd, onOutput });
                emit({ type: 'shell_done', exitCode: result.exitCode, durationMs: result.durationMs });
                break;
            }

            // ── Instalar dependencias ────────────────────────────────────────
            case 'INSTALL_DEPS': {
                const projectSlug = params['projectSlug'] as string | undefined;

                if (!projectSlug) {
                    emit({ type: 'error', content: 'Falta projectSlug para instalar dependencias.' });
                    break;
                }

                const projectPath = path.join(CONTEXT_BASE, projectSlug);
                const hasPackageJson = fs.existsSync(path.join(projectPath, 'package.json'));
                const hasRequirements = fs.existsSync(path.join(projectPath, 'requirements.txt'));

                if (!hasPackageJson && !hasRequirements) {
                    emit({ type: 'error', content: `No hay package.json ni requirements.txt en "${projectSlug}".` });
                    break;
                }

                const start = Date.now();

                if (hasPackageJson) {
                    emit({ type: 'shell_output', content: '→ Detectado package.json, ejecutando npm...', stream: 'stdout' });
                    const r = await npmInstall(projectPath, onOutput);
                    if (!r.success) {
                        emit({ type: 'shell_done', exitCode: r.exitCode, durationMs: r.durationMs });
                        break;
                    }
                }

                if (hasRequirements) {
                    emit({ type: 'shell_output', content: '→ Detectado requirements.txt, ejecutando pip...', stream: 'stdout' });
                    const r = await pipInstallRequirements(projectPath, onOutput);
                    emit({ type: 'shell_done', exitCode: r.exitCode, durationMs: Date.now() - start });
                    break;
                }

                emit({ type: 'shell_done', exitCode: 0, durationMs: Date.now() - start });
                break;
            }

            // ── Verificar herramientas ───────────────────────────────────────
            case 'CHECK_TOOLS': {
                const tools = ['node', 'npm', 'python', 'python3', 'pip', 'pip3', 'git', 'ollama'];
                const start = Date.now();

                for (const tool of tools) {
                    if (cancelled) break;
                    const r = await executeShellCommand(`${tool} --version`);
                    const status = r.success ? '✓' : '✗';
                    const version = r.stdout.split('\n')[0]?.trim() ?? '';
                    emit({
                        type: 'shell_output',
                        content: `${status} ${tool.padEnd(10)} ${version}`,
                        stream: r.success ? 'stdout' : 'stderr',
                    });
                }

                emit({ type: 'shell_done', exitCode: 0, durationMs: Date.now() - start });
                break;
            }

            // ── Crear proyecto con scaffold + auto-install opcional ───────────
            case 'CREATE_PROJECT': {
                const projectName = params['projectName'] as string | undefined;
                const stack = (params['stack'] as ProjectStack | undefined) ?? 'generic';
                const description = (params['description'] as string | undefined) ?? '';
                const autoInstall = Boolean(params['autoInstall'] ?? false);
                const tasks = params['tasks'];

                if (!projectName) {
                    emit({ type: 'error', content: 'Falta el nombre del proyecto.' });
                    break;
                }

                const start = Date.now();
                emit({ type: 'shell_output', content: `→ Creando proyecto "${projectName}" (${stack})...`, stream: 'stdout' });

                const scaffold = await scaffoldProject(projectName, stack, description, {
                    autoInstall,
                    onInstallOutput: onOutput,
                });

                // Registrar en DB
                await prisma.project.upsert({
                    where: { slug: scaffold.projectSlug },
                    update: { name: projectName, description: description || null },
                    create: {
                        slug: scaffold.projectSlug,
                        name: projectName,
                        description: description || null,
                        contextPath: scaffold.projectPath,
                        isActive: true,
                    },
                });

                emit({
                    type: 'shell_output',
                    content: `✓ Proyecto creado en ${scaffold.projectPath} (${scaffold.filesCreated.length} archivos)`,
                    stream: 'stdout',
                });

                // Crear tareas iniciales si las hay
                if (tasks) {
                    const items = normalizeBatchItems(tasks, '');
                    if (items.length > 0) {
                        const batch = await createTaskBatch(items, scaffold.projectSlug);
                        emit({
                            type: 'shell_output',
                            content: `✓ ${batch.created} tarea(s) creadas`,
                            stream: 'stdout',
                        });
                    }
                }

                emit({
                    type: 'shell_done',
                    exitCode: scaffold.installSuccess === false ? 1 : 0,
                    durationMs: Date.now() - start,
                });
                break;
            }
        }

    } catch (err) {
        console.error('[action/stream] error:', err);
        emit({ type: 'error', content: 'Error interno ejecutando el comando.' });
    } finally {
        if (!res.writableEnded) res.end();
    }
});