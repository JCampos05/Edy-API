import { PrismaClient } from '@prisma/client';
import type { SessionState, ChatMessage } from '../types';

const prisma = new PrismaClient();
const MAX_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES ?? '20');

// ── Caché en memoria (activo mientras el servidor está corriendo) ──────────────
const memoryCache = new Map<string, SessionState>();

// ── Crear sesión nueva ────────────────────────────────────────────────────────

export async function createSession(
    deviceId: string,
    projectSlug: string | null = null
): Promise<SessionState> {
    const record = await prisma.session.create({
        data: {
            deviceId,
            projectSlug,
            messages: [],
        },
    });

    const state: SessionState = {
        sessionId: record.id,
        deviceId: record.deviceId,
        projectSlug: record.projectSlug,
        messages: [],
        createdAt: record.createdAt.toISOString(),
    };

    memoryCache.set(record.id, state);
    return state;
}

// ── Obtener sesión (memoria → MySQL) ─────────────────────────────────────────

export async function getSession(sessionId: string): Promise<SessionState | null> {
    // 1. Intentar desde memoria
    if (memoryCache.has(sessionId)) {
        return memoryCache.get(sessionId)!;
    }

    // 2. Cargar desde MySQL (reinicio del servidor)
    const record = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!record) return null;

    const state: SessionState = {
        sessionId: record.id,
        deviceId: record.deviceId,
        projectSlug: record.projectSlug,
        messages: (record.messages as unknown) as ChatMessage[],
        createdAt: record.createdAt.toISOString(),
    };

    memoryCache.set(sessionId, state);
    return state;
}

// ── Agregar mensaje y persistir ───────────────────────────────────────────────

export async function appendMessage(
    sessionId: string,
    message: Omit<ChatMessage, 'timestamp'>
): Promise<SessionState> {
    const state = await getSession(sessionId);
    if (!state) throw new Error(`Session not found: ${sessionId}`);

    const newMessage: ChatMessage = {
        ...message,
        timestamp: new Date().toISOString(),
    };

    state.messages.push(newMessage);

    // Comprimir si supera el límite (conserva system + últimos N mensajes)
    if (state.messages.length > MAX_MESSAGES) {
        const systemMessages = state.messages.filter(m => m.role === 'system');
        const recent = state.messages
            .filter(m => m.role !== 'system')
            .slice(-MAX_MESSAGES);

        state.messages = [...systemMessages, ...recent];
    }

    // Persistir en MySQL de forma asíncrona (no bloquea la respuesta)
    prisma.session.update({
        where: { id: sessionId },
        data: { messages: state.messages as object[] },
    }).catch(err => console.error('[session] persist error:', err));

    memoryCache.set(sessionId, state);
    return state;
}

// ── Cerrar sesión ─────────────────────────────────────────────────────────────

export async function closeSession(sessionId: string): Promise<void> {
    memoryCache.delete(sessionId);
    await prisma.session.update({
        where: { id: sessionId },
        data: { closedAt: new Date() },
    });
}

// ── Listar sesiones activas de un dispositivo ─────────────────────────────────

export async function getActiveSessions(deviceId: string) {
    return prisma.session.findMany({
        where: { deviceId, closedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 10,
    });
}
// ── Renombrar sesión ──────────────────────────────────────────────────────────

export async function renameSession(sessionId: string, name: string): Promise<void> {
    // Usamos 'as any' temporalmente hasta correr: npx prisma generate
    // El campo 'name' existe en el schema pero el cliente aún no lo conoce
    await (prisma.session.update as any)({
        where: { id: sessionId },
        data: { name },
    });
    const cached = memoryCache.get(sessionId);
    if (cached) memoryCache.set(sessionId, { ...cached, name } as any);
}