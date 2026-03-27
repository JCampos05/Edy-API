import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { loadProjectContext, listAvailableProjects, invalidateProjectCache } from '../services/context.service';

export const projectRouter = Router();
const prisma = new PrismaClient();

// GET /api/v1/projects — lista proyectos registrados en DB + disponibles en disco
projectRouter.get('/', async (_req: Request, res: Response) => {
    try {
        const [dbProjects, diskProjects] = await Promise.all([
            prisma.project.findMany({ where: { isActive: true } }),
            Promise.resolve(listAvailableProjects()),
        ]);
        res.json({ db: dbProjects, disk: diskProjects });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET /api/v1/projects/:slug/context — previsualiza el contexto que se cargará
projectRouter.get('/:slug/context', async (req: Request, res: Response) => {
    try {
        const ctx = await loadProjectContext(req.params.slug);
        if (!ctx) return res.status(404).json({ error: 'Project context not found' });
        res.json(ctx);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load context' });
    }
});

// POST /api/v1/projects/:slug/reload — invalida caché y recarga desde disco
projectRouter.post('/:slug/reload', async (req: Request, res: Response) => {
    invalidateProjectCache(req.params.slug);
    const ctx = await loadProjectContext(req.params.slug);
    res.json({ success: true, reloaded: !!ctx });
});

// POST /api/v1/projects — registrar proyecto en DB
projectRouter.post('/', async (req: Request, res: Response) => {
    const { slug, name, description, contextPath } = req.body;
    if (!slug || !name) return res.status(400).json({ error: 'slug and name are required' });

    try {
        const project = await prisma.project.upsert({
            where: { slug },
            update: { name, description, contextPath },
            create: { slug, name, description, contextPath },
        });
        res.status(201).json(project);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save project' });
    }
});