import { Ollama } from 'ollama';
import type { ChatMessage, ProjectContext, IntentResult } from '../types';
import { fetchRagContext } from '../integrations/rag.client';

const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://localhost:11434' });
const MODEL = process.env.OLLAMA_MODEL ?? 'edy-assistant';

// ── Construir mensaje de sistema con contexto del proyecto ────────────────────

function buildSystemMessage(projectContext: ProjectContext | null): string {
    let system = 'Eres Edy, el asistente de ingeniería personal. Responde en español y con ejemplos de código cuando aplique.';

    if (projectContext) {
        system += `\n\n## Contexto del proyecto: ${projectContext.name}\n${projectContext.content}`;
    }

    return system;
}

// ── Chat principal con historial + RAG ────────────────────────────────────────

export interface ChatOptions {
    messages: ChatMessage[];
    userText: string;
    projectContext: ProjectContext | null;
    useRag?: boolean;
}

export interface ChatResult {
    reply: string;
    sources: string[];
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
    const { messages, userText, projectContext, useRag = true } = options;

    // 1. Obtener contexto RAG si está disponible
    let ragContext = '';
    let sources: string[] = [];

    if (useRag) {
        const rag = await fetchRagContext(userText);
        ragContext = rag.context;
        sources = rag.sources;
    }

    // 2. Construir prompt aumentado
    const augmentedText = ragContext
        ? `Contexto relevante de mis proyectos:\n${ragContext}\n\n---\n\nPregunta: ${userText}`
        : userText;

    // 3. Armar historial completo para Ollama
    const systemMessage: ChatMessage = {
        role: 'system',
        content: buildSystemMessage(projectContext),
        timestamp: new Date().toISOString(),
    };

    // Filtrar mensajes system anteriores (usamos el recién construido)
    const history = messages.filter(m => m.role !== 'system');

    const fullMessages = [
        systemMessage,
        ...history,
        { role: 'user' as const, content: augmentedText, timestamp: new Date().toISOString() },
    ];

    // 4. Llamar a Ollama con historial completo
    const response = await ollama.chat({
        model: MODEL,
        messages: fullMessages.map(({ role, content }) => ({ role, content })),
        options: { temperature: 0.3 },
    });

    return {
        reply: response.message.content,
        sources,
    };
}

// ── Analizar intención del texto ──────────────────────────────────────────────

export async function analyzeIntent(text: string): Promise<IntentResult> {
    const prompt = `Analiza el siguiente texto y responde ÚNICAMENTE con un objeto JSON válido.

Texto: "${text}"

Tipos de intent disponibles:
- CREATE_REMINDER     → recordatorio con fecha/hora ("recuérdame X mañana a las 8")
- CREATE_TASK         → una sola tarea sin fecha específica ("agrega tarea: revisar PR")
- CREATE_TASK_BATCH   → múltiples tareas en un solo comando ("esta semana necesito: X, Y, Z")
- CREATE_PROJECT      → crear un proyecto nuevo ("crea un proyecto Express TypeScript llamado mi-api")
- GET_WEATHER         → consulta de clima
- GET_TASK_LIST       → listar tareas pendientes
- OPEN_PROJECT        → cambiar contexto a un proyecto
- RUN_COMMAND         → ejecutar un comando de terminal ("ejecuta npm install en mi-api", "corre npm run dev", "instala express en mi proyecto")
- INSTALL_DEPS        → instalar dependencias de un proyecto existente ("instala las dependencias de mi-api")
- CHECK_TOOLS         → verificar herramientas disponibles ("qué herramientas tengo instaladas", "está disponible python?")
- GENERAL_QUERY       → pregunta técnica o consulta general
- UNKNOWN             → no se reconoció la intención
 
// Para RUN_COMMAND, INSTALL_DEPS y CHECK_TOOLS, el JSON params debe incluir:
{
  "type": "RUN_COMMAND",
  "confidence": 0.0-1.0,
  "params": {
    "command": "npm install express zod",      // comando exacto a ejecutar
    "projectSlug": "mi-api",                   // slug del proyecto (si aplica)
    "cwd": null                                // ruta custom (null = usar projectSlug)
  }
}
 
// Para INSTALL_DEPS:
{
  "type": "INSTALL_DEPS",
  "params": {
    "projectSlug": "mi-api"
  }
}
 
// Para CHECK_TOOLS no se necesitan params.

Devuelve este JSON (sin markdown, sin explicaciones):
{
  "type": "<tipo>",
  "confidence": 0.0-1.0,
  "params": {
    "task": "descripción si es una sola tarea",
    "datetime": "fecha/hora expresión natural",
    "priority": "LOW | MEDIUM | HIGH",
    "projectSlug": "slug-del-proyecto si menciona uno existente",
    "query": "pregunta si es consulta general",
    "location": "lugar si pregunta clima",

    "tasks": [
      { "title": "...", "datetime": "...", "priority": "MEDIUM", "projectSlug": "..." }
    ],

    "projectName": "nombre del proyecto a crear (solo para CREATE_PROJECT)",
    "stack": "express-ts | express-js | angular | python-flask | python-fastapi | arduino-cpp | generic",
    "description": "descripción del proyecto a crear"
  }
}`;

    const response = await ollama.chat({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.1 }, // Baja temperatura para JSON determinístico
    });

    try {
        // Limpiar posibles bloques markdown que el modelo agregue
        const raw = response.message.content.trim();
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        return {
            type: parsed.type ?? 'UNKNOWN',
            confidence: parsed.confidence ?? 0,
            params: parsed.params ?? {},
            rawText: text,
        };
    } catch {
        return {
            type: 'UNKNOWN',
            confidence: 0,
            params: { query: text },
            rawText: text,
        };
    }
}