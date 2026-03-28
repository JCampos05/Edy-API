// src/types/index.ts

import type { BatchTaskItem } from './project.types';

// ── Conversación ──────────────────────────────────────────────────────────────

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: string;   // ISO
}

export interface SessionState {
    sessionId: string;
    deviceId: string;
    projectSlug: string | null;
    messages: ChatMessage[];
    createdAt: string;
    name?: string;
}

// ── Comandos entrantes ────────────────────────────────────────────────────────

export interface CommandRequest {
    text: string;          // Texto transcrito del ESP32
    deviceId: string;
    sessionId?: string;    // Si viene de una sesión existente
    projectSlug?: string;  // Contexto de proyecto a cargar
}

export interface CommandResponse {
    reply: string;
    intent: IntentResult;
    sessionId: string;
    sources?: string[];    // Archivos RAG usados como contexto
}

// ── Intenciones ───────────────────────────────────────────────────────────────

export type IntentType =
    | 'CREATE_REMINDER'
    | 'CREATE_TASK'
    | 'CREATE_TASK_BATCH'
    | 'CREATE_PROJECT'
    | 'GET_WEATHER'
    | 'GET_TASK_LIST'
    | 'OPEN_PROJECT'
    | 'RUN_COMMAND'
    | 'INSTALL_DEPS'
    | 'CHECK_TOOLS'
    | 'GENERAL_QUERY'
    | 'UNKNOWN';

export interface IntentResult {
    type: IntentType;
    confidence: number;    // 0–1
    params: IntentParams;
    rawText: string;
}

/**
 * Params es un objeto abierto para no tener que ampliar la interfaz
 * cada vez que se agrega un intent. Los campos tipados son los más comunes;
 * los específicos de cada intent (command, tasks, stack…) viajan como
 * propiedades adicionales y se acceden con cast explícito en action.router.ts.
 */
export interface IntentParams {
    // CREATE_TASK / CREATE_REMINDER
    task?: string;
    datetime?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';

    // CREATE_TASK_BATCH
    tasks?: BatchTaskItem[];

    // CREATE_PROJECT
    projectName?: string;
    stack?: string;
    description?: string;
    autoInstall?: boolean;

    // RUN_COMMAND
    command?: string;
    cwd?: string;

    // INSTALL_DEPS / contexto general
    projectSlug?: string;

    // GET_WEATHER
    location?: string;

    // GENERAL_QUERY
    query?: string;

    // Escape hatch para params no tipados
    [key: string]: unknown;
}

// ── Contexto de proyecto ──────────────────────────────────────────────────────

export interface ProjectContext {
    slug: string;
    name: string;
    content: string;        // Contenido del .md o archivos del directorio
    loadedFiles: string[];  // Rutas de archivos cargados
    loadedAt: string;       // ISO
}

// Re-exportar tipos de project.types para imports centralizados
export type { BatchTaskItem, ProjectStack, ProjectScaffoldResult } from './project.types';