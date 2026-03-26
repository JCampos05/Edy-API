import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Ollama } from 'ollama';
import { createSession, getSession, appendMessage } from '../services/session.service';
import { loadProjectContext } from '../services/context.service';
import { analyzeIntent } from '../services/Ollama.service';
import { executeIntent } from '../services/action.router';

export const streamRouter = Router();

const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://localhost:11434' });
const MODEL = process.env.OLLAMA_MODEL ?? 'edy-assistant';

const StreamSchema = z.object({
    text: z.string().min(1).max(2000),
    deviceId: z.string().min(1).max(50),
    sessionId: z.string().uuid().optional(),
    projectSlug: z.string().max(100).optional(),
});

/**
 * GET /api/v1/stream?text=...&deviceId=...&sessionId=...&projectSlug=...
 *
 * Endpoint SSE — emite tokens de Ollama en tiempo real.
 * El cliente Angular escucha con EventSource.
 *
 * Eventos emitidos:
 *   data: {"type":"token",   "content":"hola"}
 *   data: {"type":"intent",  "content":{...}}
 *   data: {"type":"action",  "content":"Tarea creada..."}
 *   data: {"type":"done",    "sessionId":"uuid"}
 *   data: {"type":"error",   "content":"mensaje"}
 */
streamRouter.get('/', async (req: Request, res: Response) => {
    const parsed = StreamSchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid params', details: parsed.error.flatten() });
        return;
    }

    const { text, deviceId, sessionId, projectSlug } = parsed.data;

    // ── Cabeceras SSE ────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const emit = (payload: object) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
        // 1. Sesión
        let session = sessionId ? await getSession(sessionId) : null;
        if (!session) session = await createSession(deviceId, projectSlug ?? null);

        // 2. Contexto de proyecto
        const projectContext = projectSlug
            ? await loadProjectContext(projectSlug)
            : null;

        // 3. Contexto RAG (opcional, no bloquea el stream si falla)
        let ragContext = '';
        try {
            const ragRes = await fetch(`${process.env.RAG_SERVICE_URL ?? 'http://localhost:5001'}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: text, top_k: 3 }),
                signal: AbortSignal.timeout(4000),
            });
            if (ragRes.ok) {
                const rag = await ragRes.json() as { context: string };
                ragContext = rag.context ?? '';
            }
        } catch { /* RAG no disponible */ }

        // 4. Construir historial + system prompt
        let systemContent = 'Eres Edy, el asistente de ingeniería personal. Responde en español con ejemplos de código cuando aplique.';
        if (projectContext) {
            systemContent += `\n\n## Contexto del proyecto: ${projectContext.name}\n${projectContext.content}`;
        }

        const augmentedText = ragContext
            ? `Contexto relevante:\n${ragContext}\n\n---\n\nPregunta: ${text}`
            : text;

        const history = session.messages
            .filter(m => m.role !== 'system')
            .map(({ role, content }) => ({ role, content }));

        const messages = [
            { role: 'system' as const, content: systemContent },
            ...history,
            { role: 'user' as const, content: augmentedText },
        ];

        // 5. Analizar intent en paralelo (no espera al stream)
        const intentPromise = analyzeIntent(text);

        // 6. Stream de tokens
        let fullReply = '';
        const stream = await ollama.chat({ model: MODEL, messages, stream: true });

        for await (const chunk of stream) {
            const token = chunk.message.content;
            if (token) {
                fullReply += token;
                emit({ type: 'token', content: token });
            }
        }

        // 7. Emitir intent y ejecutar acción
        const intent = await intentPromise;
        const actionResult = await executeIntent(intent);

        emit({ type: 'intent', content: intent });

        if (actionResult.message) {
            emit({ type: 'action', content: actionResult.message });
        }

        // 8. Persistir conversación
        await appendMessage(session.sessionId, { role: 'user', content: text });
        await appendMessage(session.sessionId, { role: 'assistant', content: fullReply });

        emit({ type: 'done', sessionId: session.sessionId });

    } catch (err) {
        console.error('[stream] error:', err);
        emit({ type: 'error', content: 'Error procesando la solicitud.' });
    } finally {
        res.end();
    }
});