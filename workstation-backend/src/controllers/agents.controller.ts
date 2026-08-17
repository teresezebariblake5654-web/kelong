import { Request, Response, NextFunction } from 'express';
import { agentService } from '../services/agent.service';
import { runnerService } from '../services/runner.service';
import { AppError } from '../utils/errors';

export const agentsController = {
  list(_req: Request, res: Response) {
    res.json({ success: true, data: agentService.list() });
  },

  get(req: Request, res: Response, next: NextFunction) {
    try {
      const agent = agentService.get(String(req.params.agentId));
      res.json({ success: true, data: agent });
    } catch (error) {
      next(error);
    }
  },

  async run(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = String(req.params.agentId);
      const { fileId, task, agentRunId } = req.body ?? {};

      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      if (!fileId || typeof fileId !== 'string') {
        throw new AppError(400, '请提供 fileId', 'BAD_REQUEST');
      }

      if (!task || typeof task !== 'string') {
        throw new AppError(400, '请提供 task', 'BAD_REQUEST');
      }

      const result = await runnerService.runAgent(
        req.user!.id,
        req.org.organizationId,
        agentId,
        fileId,
        task,
        {
          agentRunId:
            typeof agentRunId === 'string' && agentRunId.trim()
              ? agentRunId.trim()
              : undefined,
        },
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
};
