// ── Conversación ─────────────────────────────────────────────────────────────

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: string; // ISO
}

export interface SessionState {
    sessionId: string;
    deviceId: string;
    projectSlug: string | null;
    messages: ChatMessage[];
    createdAt: string;
}

// ── Comandos entrantes ────────────────────────────────────────────────────────

export interface CommandRequest {
    text: string;       // Texto transcrito del ESP32
    deviceId: string;
    sessionId?: string;       // Si viene de una sesión existente
    projectSlug?: string;      // Contexto de proyecto a cargar
}

export interface CommandResponse {
    reply: string;
    intent: IntentResult;
    sessionId: string;
    sources?: string[];      // Archivos RAG usados como contexto
}

// ── Intenciones ───────────────────────────────────────────────────────────────

export type IntentType =
    | 'CREATE_REMINDER'
    | 'CREATE_TASK'
    | 'GET_WEATHER'
    | 'GET_TASK_LIST'
    | 'OPEN_PROJECT'
    | 'GENERAL_QUERY'
    | 'UNKNOWN';

export interface IntentResult {
    type: IntentType;
    confidence: number;        // 0-1
    params: IntentParams;
    rawText: string;
}

export interface IntentParams {
    task?: string;
    datetime?: string;      // ISO o expresión natural: "mañana a las 8am"
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    projectSlug?: string;
    query?: string;
    location?: string;
}

// ── Contexto de proyecto ──────────────────────────────────────────────────────

export interface ProjectContext {
    slug: string;
    name: string;
    content: string;       // Contenido del .md o archivos del directorio
    loadedFiles: string[];     // Rutas de archivos cargados
    loadedAt: string;       // ISO
}