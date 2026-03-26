import { Router, Request, Response } from 'express';
import { PrismaClient, Priority, TaskStatus } from '@prisma/client';
import { z } from 'zod';

export const taskRouter = Router();
const prisma = new PrismaClient();

const TaskSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    dueAt: z.string().datetime().optional(),
    priority: z.nativeEnum(Priority).default('MEDIUM'),
    projectSlug: z.string().optional(),
    source: z.string().default('edy'),
});

// GET /api/v1/tasks
taskRouter.get('/', async (req: Request, res: Response) => {
    const { status, project } = req.query;
    try {
        const tasks = await prisma.task.findMany({
            where: {
                ...(status ? { status: status as TaskStatus } : { status: { not: 'CANCELLED' } }),
                ...(project ? { projectSlug: project as string } : {}),
            },
            orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        });
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// POST /api/v1/tasks
taskRouter.post('/', async (req: Request, res: Response) => {
    const parsed = TaskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
        const task = await prisma.task.create({ data: parsed.data });
        res.status(201).json(task);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// PATCH /api/v1/tasks/:id
taskRouter.patch('/:id', async (req: Request, res: Response) => {
    try {
        const task = await prisma.task.update({
            where: { id: BigInt(req.params.id) },
            data: req.body,
        });
        res.json(task);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update task' });
    }
});