import { PrismaClient, Priority } from '@prisma/client';
import { extractDateFromText, formatDateForReply } from '../utils/date-parser';
import type { BatchTaskItem } from '../types/project.types';

const prisma = new PrismaClient();

export interface BatchResult {
    created: number;
    failed: number;
    tasks: CreatedTask[];
    summary: string;
}

export interface CreatedTask {
    id: bigint;
    title: string;
    dueAt: Date | null;
    priority: string;
    projectSlug: string | null;
}

/**
 * Crea múltiples tareas en una sola transacción de base de datos.
 * Resuelve fechas en lenguaje natural para cada tarea.
 *
 * @example
 * createTaskBatch([
 *   { title: "resolver ESP32",    datetime: "el viernes" },
 *   { title: "configurar Ollama", datetime: "mañana a las 10" },
 *   { title: "documentar API",    priority: "HIGH" },
 * ], "edy")
 */
export async function createTaskBatch(
    items: BatchTaskItem[],
    defaultProject: string | null = null
): Promise<BatchResult> {

    const toCreate = items.map(item => {
        // Parsear fecha desde datetime o extraer del título
        let dueAt: Date | null = null;
        const textToParse = item.datetime ?? item.title;
        const parsed = extractDateFromText(textToParse);
        if (parsed) dueAt = new Date(parsed.iso);

        return {
            title: item.title,
            dueAt,
            priority: (item.priority ?? 'MEDIUM') as Priority,
            projectSlug: item.projectSlug ?? defaultProject,
            source: 'edy',
        };
    });

    // Insertar en una sola transacción
    const created: CreatedTask[] = [];
    let failed = 0;

    await prisma.$transaction(async (tx) => {
        for (const data of toCreate) {
            try {
                const task = await tx.task.create({ data });
                created.push(task as CreatedTask);
            } catch {
                failed++;
            }
        }
    });

    // Construir resumen legible para Edy
    const lines = created.map((t, i) => {
        const when = t.dueAt ? ` — ${formatDateForReply(t.dueAt.toISOString())}` : '';
        return `${i + 1}. ${t.title}${when}`;
    });

    const summary = created.length > 0
        ? `Creé ${created.length} tarea(s):\n${lines.join('\n')}${failed > 0 ? `\n(${failed} fallaron)` : ''}`
        : 'No se pudo crear ninguna tarea.';

    return { created: created.length, failed, tasks: created, summary };
}

/**
 * Parsea el texto libre de un comando de voz y extrae múltiples tareas.
 * El LLM ya hizo el análisis — aquí solo procesamos el array que devolvió.
 *
 * Si el LLM devolvió un string en vez de array (fallo de parseo),
 * creamos una sola tarea con el texto completo.
 */
export function normalizeBatchItems(raw: unknown, fallbackText: string): BatchTaskItem[] {
    if (Array.isArray(raw)) {
        return raw
            .filter(item => typeof item === 'object' && item?.title)
            .map(item => ({
                title: String(item.title),
                datetime: item.datetime ? String(item.datetime) : undefined,
                priority: item.priority ? String(item.priority) as BatchTaskItem['priority'] : 'MEDIUM',
                projectSlug: item.projectSlug ? String(item.projectSlug) : undefined,
            }));
    }

    // Fallback: una sola tarea con el texto original
    return [{ title: fallbackText, priority: 'MEDIUM' }];
}