import { Router, Request, Response } from 'express';
import { getActiveSessions, closeSession, renameSession } from '../services/session.service';

export const sessionRouter = Router();

// GET /api/v1/sessions/:deviceId
sessionRouter.get('/:deviceId', async (req: Request, res: Response) => {
    try {
        const sessions = await getActiveSessions(req.params.deviceId);
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

// DELETE /api/v1/sessions/:sessionId
sessionRouter.delete('/:sessionId', async (req: Request, res: Response) => {
    try {
        await closeSession(req.params.sessionId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to close session' });
    }
});

// PATCH /api/v1/sessions/:sessionId — renombrar sesión
sessionRouter.patch('/:sessionId', async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    try {
        await renameSession(req.params.sessionId, name);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to rename session' });
    }
});