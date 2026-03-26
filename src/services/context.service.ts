import fs from 'fs';
import path from 'path';
import type { ProjectContext } from '../types';

const CONTEXT_BASE = process.env.CONTEXT_BASE_PATH ?? './projects';

// Extensiones que se cargan como contexto
const CONTEXT_EXTENSIONS = new Set(['.md', '.txt', '.json']);

// Caché en memoria por slug (se invalida manualmente o al reiniciar)
const contextCache = new Map<string, ProjectContext>();

// ── Cargar contexto de un proyecto ───────────────────────────────────────────

export async function loadProjectContext(slug: string): Promise<ProjectContext | null> {
    // Retornar desde caché si ya está cargado
    if (contextCache.has(slug)) {
        return contextCache.get(slug)!;
    }

    const projectDir = path.join(CONTEXT_BASE, slug);

    // Prioridad 1: README.md en la raíz del proyecto
    const readmePath = path.join(projectDir, 'README.md');
    if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf-8');
        const ctx = buildContext(slug, content, [readmePath]);
        contextCache.set(slug, ctx);
        return ctx;
    }

    // Prioridad 2: context.md o edy-context.md
    for (const name of ['context.md', 'edy-context.md', 'CONTEXT.md']) {
        const ctxPath = path.join(projectDir, name);
        if (fs.existsSync(ctxPath)) {
            const content = fs.readFileSync(ctxPath, 'utf-8');
            const ctx = buildContext(slug, content, [ctxPath]);
            contextCache.set(slug, ctx);
            return ctx;
        }
    }

    // Prioridad 3: Concatenar todos los .md/.txt/.json del directorio (máx 5 archivos)
    if (fs.existsSync(projectDir)) {
        const files = fs
            .readdirSync(projectDir)
            .filter(f => CONTEXT_EXTENSIONS.has(path.extname(f).toLowerCase()))
            .slice(0, 5)
            .map(f => path.join(projectDir, f));

        if (files.length > 0) {
            const content = files
                .map(f => `### ${path.basename(f)}\n${fs.readFileSync(f, 'utf-8')}`)
                .join('\n\n---\n\n');

            const ctx = buildContext(slug, content, files);
            contextCache.set(slug, ctx);
            return ctx;
        }
    }

    return null;
}

// ── Listar proyectos disponibles en disco ─────────────────────────────────────

export function listAvailableProjects(): string[] {
    if (!fs.existsSync(CONTEXT_BASE)) return [];

    return fs
        .readdirSync(CONTEXT_BASE, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
}

// ── Invalidar caché de un proyecto (para recargar en caliente) ────────────────

export function invalidateProjectCache(slug: string): void {
    contextCache.delete(slug);
}

// ── Construir objeto ProjectContext ──────────────────────────────────────────

function buildContext(slug: string, content: string, files: string[]): ProjectContext {
    return {
        slug,
        name: slug,
        content: content.slice(0, 6000), // Límite para no saturar el contexto
        loadedFiles: files,
        loadedAt: new Date().toISOString(),
    };
}