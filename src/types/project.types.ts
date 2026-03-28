// src/types/project.types.ts

// ── Stacks disponibles ────────────────────────────────────────────────────────

export type ProjectStack =
    | 'express-ts'      // Express + TypeScript + Prisma
    | 'express-js'      // Express + JavaScript
    | 'angular'         // Angular standalone
    | 'python-flask'    // Python + Flask
    | 'python-fastapi'  // Python + FastAPI
    | 'arduino-cpp'     // Arduino / ESP32 C++
    | 'generic';        // Solo estructura básica

// ── Resultado del scaffold ────────────────────────────────────────────────────

export interface ProjectScaffoldResult {
    projectPath: string;
    filesCreated: string[];
    tasksCreated: number;
    projectSlug: string;
    /** Líneas de resumen de la instalación (npm/pip), si se ejecutó autoInstall */
    installLog?: string[];
    /** true si la instalación terminó sin errores (undefined si no se ejecutó) */
    installSuccess?: boolean;
}

// ── Batch de tareas ───────────────────────────────────────────────────────────

export interface BatchTaskItem {
    title: string;
    datetime?: string;               // expresión natural o ISO
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    projectSlug?: string;
}

export interface CreateTaskBatchParams {
    tasks: BatchTaskItem[];
    projectSlug?: string;            // aplica a todas si no tienen slug propio
}

// ── Params de CREATE_PROJECT ──────────────────────────────────────────────────

export interface CreateProjectParams {
    name: string;
    stack: ProjectStack;
    description?: string;
    tasks?: BatchTaskItem[];
    autoInstall?: boolean;
}