import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { formatDateForReply } from './dateParser';

const prisma = new PrismaClient();

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Notification {
    taskId: bigint;
    title: string;
    dueAt: Date;
    channel: 'console' | 'webhook';
}

// Handlers externos que se pueden registrar (ej: enviar al ESP32, SSE, webhook)
type NotifyHandler = (n: Notification) => void | Promise<void>;
const handlers: NotifyHandler[] = [];

export function onNotification(handler: NotifyHandler): void {
    handlers.push(handler);
}

// ── Disparar notificaciones ────────────────────────────────────────────────────

async function fireNotification(n: Notification): Promise<void> {
    console.log(`[scheduler]  "${n.title}" — ${formatDateForReply(n.dueAt.toISOString())}`);
    for (const handler of handlers) {
        try { await handler(n); } catch (err) {
            console.error('[scheduler] handler error:', err);
        }
    }
}

// ── Verificar tareas próximas ──────────────────────────────────────────────────

async function checkDueTasks(): Promise<void> {
    const now = new Date();
    const window = new Date(now.getTime() + 60 * 1000); // próximos 60 segundos

    const tasks = await prisma.task.findMany({
        where: {
            status: 'PENDING',
            dueAt: { gte: now, lte: window },
        },
    });

    for (const task of tasks) {
        await fireNotification({
            taskId: task.id,
            title: task.title,
            dueAt: task.dueAt!,
            channel: 'console',
        });

        // Marcar como IN_PROGRESS para no disparar dos veces
        await prisma.task.update({
            where: { id: task.id },
            data: { status: 'IN_PROGRESS' },
        });
    }
}

// ── Resumen diario ─────────────────────────────────────────────────────────────

async function dailySummary(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    const tasks = await prisma.task.findMany({
        where: {
            status: { in: ['PENDING', 'IN_PROGRESS'] },
            dueAt: { gte: today, lt: tomorrow },
        },
        orderBy: { dueAt: 'asc' },
    });

    if (tasks.length === 0) {
        console.log('[scheduler]  Hoy no tienes tareas programadas.');
        return;
    }

    console.log(`[scheduler]  Resumen del día — ${tasks.length} tarea(s):`);
    tasks.forEach(t => {
        const time = t.dueAt
            ? t.dueAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
            : 'sin hora';
        console.log(`   • [${time}] ${t.title} (${t.priority})`);
    });
}

// ── Limpiar tareas vencidas (más de 7 días) ────────────────────────────────────

async function cleanOldTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const { count } = await prisma.task.updateMany({
        where: {
            status: 'PENDING',
            dueAt: { lt: cutoff },
        },
        data: { status: 'CANCELLED' },
    });

    if (count > 0) {
        console.log(`[scheduler]  ${count} tarea(s) vencidas marcadas como CANCELLED`);
    }
}

// ── Iniciar todos los jobs ─────────────────────────────────────────────────────

export function startScheduler(): void {
    // Verificar tareas cada minuto
    cron.schedule('* * * * *', checkDueTasks, {
        timezone: 'America/Mazatlan', // Zona horaria Los Mochis, Sinaloa
    });

    // Resumen diario a las 8:00 AM
    cron.schedule('0 8 * * *', dailySummary, {
        timezone: 'America/Mazatlan',
    });

    // Limpiar tareas vencidas cada domingo a medianoche
    cron.schedule('0 0 * * 0', cleanOldTasks, {
        timezone: 'America/Mazatlan',
    });

    console.log('[scheduler] Jobs activos: verificación cada minuto, resumen 8AM, limpieza domingos');
}

// ── Exponer checkDueTasks para testing manual ──────────────────────────────────
export { checkDueTasks };