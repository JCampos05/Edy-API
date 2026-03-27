import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createSession, getSession, appendMessage } from '../services/session.service';
import { loadProjectContext } from '../services/context.service';
import { chat, analyzeIntent } from '../services/Ollama.service';
import { executeIntent } from '../services/action.router';
import type { CommandRequest, CommandResponse } from '../types';

export const commandRouter = Router();

// ── Validación del body con Zod ───────────────────────────────────────────────
const CommandSchema = z.object({
    text: z.string().min(1).max(2000),
    deviceId: z.string().min(1).max(50),
    sessionId: z.string().uuid().optional(),
    projectSlug: z.string().max(100).optional(),
});

// ── POST /api/v1/command ──────────────────────────────────────────────────────
// Endpoint principal: recibe texto transcrito y devuelve respuesta de Edy.
commandRouter.post('/', async (req: Request, res: Response) => {
    const parsed = CommandSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { text, deviceId, sessionId, projectSlug }: CommandRequest = parsed.data;

    try {
        // 1. Obtener o crear sesión
        let session = sessionId ? await getSession(sessionId) : null;
        if (!session) {
            session = await createSession(deviceId, projectSlug ?? null);
        }

        // 2. Cargar contexto del proyecto (si se especifica)
        const projectContext = projectSlug
            ? await loadProjectContext(projectSlug)
            : null;

        // 3. Analizar intención en paralelo con el chat
        const [intent, chatResult] = await Promise.all([
            analyzeIntent(text),
            chat({ messages: session.messages, userText: text, projectContext, useRag: true }),
        ]);

        // 4. Ejecutar acción concreta si el intent lo requiere
        const actionResult = await executeIntent(intent);

        // 5. Enriquecer la respuesta con el resultado de la acción si aplica
        const finalReply = actionResult.message
            ? `${chatResult.reply}\n\n${actionResult.message}`.trim()
            : chatResult.reply;

        // 6. Guardar mensajes en sesión
        await appendMessage(session.sessionId, { role: 'user', content: text });
        await appendMessage(session.sessionId, { role: 'assistant', content: finalReply });

        const response: CommandResponse = {
            reply: finalReply,
            intent,
            sessionId: session.sessionId,
            sources: chatResult.sources,
        };

        return res.json(response);

    } catch (err) {
        console.error('[command] error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});