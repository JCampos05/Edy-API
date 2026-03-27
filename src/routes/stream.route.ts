import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Ollama } from 'ollama';
import { createSession, getSession, appendMessage } from '../services/session.service';
import { loadProjectContext } from '../services/context.service';
import { analyzeIntent } from '../services/Ollama.service';
import { executeIntent } from '../services/action.router';
import { fetchRagContext } from '../integrations/rag.client';

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
        const { context: ragContext } = await fetchRagContext(text);

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

        // 5. AbortController para cancelar Ollama si el cliente se desconecta
        const abortController = new AbortController();
        req.on('close', () => {
            if (!res.writableEnded) abortController.abort();
        });

        // 6. Stream de tokens — intent se analiza con los primeros 120 chars
        //    para no esperar a que termine el stream completo
        let fullReply = '';
        let intentStarted = false;
        let intentPromise: ReturnType<typeof analyzeIntent> | null = null;

        const stream = await ollama.chat({ model: MODEL, messages, stream: true });

        for await (const chunk of stream) {
            // Si el cliente se fue, abortar
            if (abortController.signal.aborted) break;

            const token = chunk.message.content;
            if (token) {
                fullReply += token;
                emit({ type: 'token', content: token });

                // Lanzar el análisis de intent en background después de los
                // primeros 120 caracteres — suficiente contexto, sin esperar el fin
                if (!intentStarted && fullReply.length >= 120) {
                    intentStarted = true;
                    intentPromise = analyzeIntent(text); // no await aquí
                }
            }
        }

        // Si el texto fue muy corto, lanzar el intent ahora
        if (!intentStarted) {
            intentPromise = analyzeIntent(text);
        }

        // 7. Resolver intent y ejecutar acción con timeout de seguridad
        const intent = await intentPromise!;

        // Si executeIntent tarda más de 8 segundos (ej: Taskeer sin configurar),
        // emitir done de todas formas para no bloquear el cliente
        const actionResult = await Promise.race([
            executeIntent(intent),
            new Promise<{ success: boolean; message: string }>(resolve =>
                setTimeout(() => resolve({ success: false, message: '' }), 8000)
            ),
        ]);

        // Emitir intent solo si es relevante (no GENERAL_QUERY)
        if (intent.type !== 'GENERAL_QUERY' && intent.type !== 'UNKNOWN') {
            emit({ type: 'intent', content: intent });
        }

        // Emitir acción si produjo un mensaje
        if (actionResult.message) {
            emit({ type: 'action', content: actionResult.message });
        }

        // 8. Persistir conversación de forma no bloqueante
        Promise.all([
            appendMessage(session.sessionId, { role: 'user', content: text }),
            appendMessage(session.sessionId, { role: 'assistant', content: fullReply }),
        ]).catch(err => console.error('[stream] persist error:', err));

        // 9. Señal de fin — el cliente cierra el EventSource al recibirla
        emit({ type: 'done', sessionId: session.sessionId });

    } catch (err) {
        if (!res.writableEnded) {
            console.error('[stream] error:', err);
            emit({ type: 'error', content: 'Error procesando la solicitud.' });
        }
    } finally {
        // Cierre explícito y limpio de la conexión SSE
        if (!res.writableEnded) res.end();
    }
});