import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { executeIntent } from '../services/action.router';
import type { IntentType } from '../types';

export const actionRouter = Router();

const ActionSchema = z.object({
  type:   z.string(),
  params: z.record(z.unknown()).optional().default({}),
});

/**
 * POST /api/v1/actions/execute
 * Ejecuta un intent directamente (útil para testing o llamadas externas).
 * Body: { type: "CREATE_TASK", params: { task: "...", datetime: "..." } }
 */
actionRouter.post('/execute', async (req: Request, res: Response) => {
  const parsed = ActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const result = await executeIntent({
      type:       parsed.data.type as IntentType,
      confidence: 1,
      params:     parsed.data.params as Record<string, string>,
      rawText:    '',
    });
    res.json(result);
  } catch (err) {
    console.error('[action] execute error:', err);
    res.status(500).json({ error: 'Failed to execute action' });
  }
});