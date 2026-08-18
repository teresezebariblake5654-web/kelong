import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { createSalesProspect, getSalesProspect, listSalesProspects } from '../services/sales/sales-prospect.service';
import { listProspectMessages, queueOutboundMessage } from '../services/sales/sales-message.service';
import { listSalesActivities } from '../services/sales/sales-activity.service';
import { ingestInboundEmail, ingestWhatsAppWebhook } from '../services/sales/sales-inbound.service';
import {
  createSalesAgentProfile,
  getSalesAgentProfile,
  listSalesAgentProfiles,
} from '../services/sales/sales-agent-profile.service';
import { runSalesAgent } from '../services/sales/sales-agent.service';
import { enqueueSalesAgentRun } from '../queues/sales-agent.queue';
import { prisma } from '../config/database';
import type { SalesProspectStatus } from '@prisma/client';
import { timingSafeEqualString, verifyWhatsAppSignature } from '../services/system/provider-health.service';

const prospectBodySchema = z
  .object({
    leadCompanyId: z.string().min(1),
    leadContactId: z.string().min(1).optional(),
    preferredChannel: z.enum(['EMAIL', 'WHATSAPP']),
  })
  .strict();

const messageBodySchema = z
  .object({
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    subject: z.string().trim().max(200).optional(),
    content: z.string().trim().min(1).max(8000),
  })
  .strict();

const inboundEmailSchema = z
  .object({
    from: z.string().trim().min(3),
    to: z.string().trim().optional(),
    subject: z.string().optional(),
    content: z.string().trim().min(1),
    providerMessageId: z.string().trim().min(1),
    threadId: z.string().trim().optional(),
  })
  .strict();

const profileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    companyDescription: z.string().trim().min(1).max(4000),
    productDescription: z.string().trim().min(1).max(4000),
    targetCustomerDescription: z.string().trim().min(1).max(4000),
    tone: z.string().trim().max(80).optional(),
    language: z.string().trim().max(40).optional(),
    salesInstructions: z.string().trim().max(8000).optional(),
    handoffInstructions: z.string().trim().max(4000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const agentRunBodySchema = z
  .object({
    trigger: z.enum(['INITIAL_OUTREACH', 'MANUAL']).optional(),
  })
  .strict();

const prospectStatusSchema = z.enum([
  'NEW',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NOT_INTERESTED',
  'FOLLOW_UP',
  'HANDOFF',
  'CLOSED',
]);

export const salesController = {
  async createProspect(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const parsed = prospectBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'leadCompanyId 与 preferredChannel 必填', 'BAD_REQUEST');
      }
      const data = await createSalesProspect({
        organizationId: req.org.organizationId,
        ...parsed.data,
      });
      res.status(data.created ? 201 : 200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listProspects(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
      const statusParsed = statusRaw ? prospectStatusSchema.safeParse(statusRaw) : null;
      if (statusRaw && !statusParsed?.success) {
        throw new AppError(400, '无效的 status', 'BAD_REQUEST');
      }
      const data = await listSalesProspects({
        organizationId: req.org.organizationId,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 20,
        status: statusParsed?.success ? (statusParsed.data as SalesProspectStatus) : undefined,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getProspect(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const data = await getSalesProspect({
        organizationId: req.org.organizationId,
        prospectId: String(req.params.prospectId || ''),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const parsed = messageBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'channel 与 content 必填', 'BAD_REQUEST');
      }
      const idempotencyKey =
        typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : undefined;
      const data = await queueOutboundMessage({
        organizationId: req.org.organizationId,
        prospectId: String(req.params.prospectId || ''),
        channel: parsed.data.channel,
        subject: parsed.data.subject,
        content: parsed.data.content,
        idempotencyKey: idempotencyKey || undefined,
      });
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listMessages(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const data = await listProspectMessages({
        organizationId: req.org.organizationId,
        prospectId: String(req.params.prospectId || ''),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listActivities(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      await getSalesProspect({
        organizationId: req.org.organizationId,
        prospectId: String(req.params.prospectId || ''),
      });
      const activities = await listSalesActivities({
        organizationId: req.org.organizationId,
        prospectId: String(req.params.prospectId || ''),
      });
      res.json({
        success: true,
        data: {
          activities: activities.map((a) => ({
            id: a.id,
            type: a.type,
            payload: a.payload,
            createdAt: a.createdAt.toISOString(),
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async verifyWhatsAppWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = String(req.query['hub.mode'] || '');
      const token = String(req.query['hub.verify_token'] || '');
      const challenge = String(req.query['hub.challenge'] || '');
      if (
        mode === 'subscribe' &&
        env.whatsappVerifyToken &&
        timingSafeEqualString(token, env.whatsappVerifyToken)
      ) {
        res.status(200).type('text/plain').send(challenge);
        return;
      }
      throw new AppError(403, 'WhatsApp webhook 校验失败', 'WEBHOOK_UNAUTHORIZED');
    } catch (error) {
      next(error);
    }
  },

  async receiveWhatsAppWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      if (env.whatsappAppSecret) {
        const signature = req.headers['x-hub-signature-256'];
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        const ok = verifyWhatsAppSignature(
          rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
          typeof signature === 'string' ? signature : undefined,
        );
        if (!ok) {
          throw new AppError(401, 'WhatsApp 签名无效', 'WEBHOOK_UNAUTHORIZED');
        }
      }
      const data = await ingestWhatsAppWebhook(req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async receiveEmailWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = inboundEmailSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'inbound email payload 无效', 'BAD_REQUEST');
      }
      const secret =
        (typeof req.headers['x-sales-email-webhook-secret'] === 'string' &&
          req.headers['x-sales-email-webhook-secret']) ||
        undefined;
      const data = await ingestInboundEmail(parsed.data, secret);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createAgentProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const parsed = profileBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'SalesAgentProfile 字段无效', 'BAD_REQUEST');
      }
      const data = await createSalesAgentProfile({
        organizationId: req.org.organizationId,
        ...parsed.data,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listAgentProfiles(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const data = await listSalesAgentProfiles(req.org.organizationId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getAgentProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const data = await getSalesAgentProfile({
        organizationId: req.org.organizationId,
        profileId: String(req.params.profileId || ''),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async runAgent(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const parsed = agentRunBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'agent-run payload 无效', 'BAD_REQUEST');
      }
      const prospectId = String(req.params.prospectId || '');
      await getSalesProspect({ organizationId: req.org.organizationId, prospectId });
      const trigger = parsed.data.trigger || 'INITIAL_OUTREACH';

      const sync = req.query.sync === '1' || req.query.sync === 'true';
      if (sync) {
        const data = await runSalesAgent({
          organizationId: req.org.organizationId,
          prospectId,
          trigger,
        });
        res.status(200).json({ success: true, data });
        return;
      }

      const { jobId } = await enqueueSalesAgentRun({
        organizationId: req.org.organizationId,
        prospectId,
        trigger,
      });
      res.status(202).json({ success: true, data: { jobId, trigger, prospectId } });
    } catch (error) {
      next(error);
    }
  },

  async listAgentRuns(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org?.organizationId) throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      const prospectId = String(req.params.prospectId || '');
      await getSalesProspect({ organizationId: req.org.organizationId, prospectId });
      const runs = await prisma.salesAgentRun.findMany({
        where: { organizationId: req.org.organizationId, prospectId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({
        success: true,
        data: {
          runs: runs.map((r) => ({
            id: r.id,
            trigger: r.trigger,
            status: r.status,
            model: r.model,
            decision: r.decision,
            errorCode: r.errorCode,
            createdAt: r.createdAt.toISOString(),
            completedAt: r.completedAt?.toISOString() ?? null,
          })),
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
