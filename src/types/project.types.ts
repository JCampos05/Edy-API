// Agregar a src/types/index.ts

export type IntentType =
    | 'CREATE_REMINDER'
    | 'CREATE_TASK'
    | 'CREATE_TASK_BATCH'   // ← nuevo
    | 'CREATE_PROJECT'      // ← nuevo
    | 'GET_WEATHER'
    | 'GET_TASK_LIST'
    | 'OPEN_PROJECT'
    | 'GENERAL_QUERY'
    | 'UNKNOWN';

// ── Parámetros de CREATE_TASK_BATCH ──────────────────────────────────────────

export interface BatchTaskItem {
    title: string;
    datetime?: string;   // expresión natural o ISO
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    projectSlug?: string;
}

export interface CreateTaskBatchParams {
    tasks: BatchTaskItem[];
    projectSlug?: string;   // aplica a todas si no tienen slug propio
}

// ── Parámetros de CREATE_PROJECT ─────────────────────────────────────────────

export type ProjectStack =
    | 'express-ts'         // Express + TypeScript + Prisma
    | 'express-js'         // Express + JavaScript
    | 'angular'            // Angular standalone
    | 'python-flask'       // Python + Flask
    | 'python-fastapi'     // Python + FastAPI
    | 'arduino-cpp'        // Arduino / ESP32 C++
    | 'generic';           // Solo estructura básica

export interface CreateProjectParams {
    name: string;           // slug del proyecto: "mi-proyecto"
    stack: ProjectStack;
    description?: string;
    tasks?: BatchTaskItem[];  // tareas iniciales opcionales
}

export interface ProjectScaffoldResult {
    projectPath: string;
    filesCreated: string[];
    tasksCreated: number;
    projectSlug: string;
}