import { Ollama } from 'ollama';
import type { ChatMessage, ProjectContext, IntentResult } from '../types';

const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? 'http://localhost:11434' });
const MODEL = process.env.OLLAMA_MODEL ?? 'edy-assistant';
const RAG_URL = process.env.RAG_SERVICE_URL ?? 'http://localhost:5001';

// ── Consulta al RAG service (Python/ChromaDB) ─────────────────────────────────

async function fetchRagContext(question: string): Promise<{ context: string; sources: string[] }> {
    try {
        const res = await fetch(`${RAG_URL}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, top_k: 3 }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { context: '', sources: [] };
        return res.json() as Promise<{ context: string; sources: string[] }>;
    } catch {
        // RAG no disponible — continúa sin contexto extra
        return { context: '', sources: [] };
    }
}

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

Devuelve este JSON (sin markdown, sin explicaciones):
{
  "type": "CREATE_REMINDER" | "CREATE_TASK" | "GET_WEATHER" | "GET_TASK_LIST" | "OPEN_PROJECT" | "GENERAL_QUERY" | "UNKNOWN",
  "confidence": 0.0-1.0,
  "params": {
    "task": "descripción si aplica",
    "datetime": "fecha/hora en ISO o expresión natural",
    "priority": "LOW" | "MEDIUM" | "HIGH",
    "projectSlug": "slug si menciona proyecto",
    "query": "pregunta si es consulta general",
    "location": "lugar si pregunta clima"
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