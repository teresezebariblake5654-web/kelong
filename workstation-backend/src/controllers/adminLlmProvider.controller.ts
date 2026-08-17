import { NextFunction, Request, Response } from 'express';
import {
  fetchLlmProviderQuota,
  probeLlmProviderStatus,
} from '../providers/llm/upstreamProbe';

/** Admin-only labels: never call 1701 data "user AI points". */
const UPSTREAM_LABELS = {
  statusTitle: '上游模型状态',
  quotaTitle: '上游 Token 状态',
  totalUsed: '上游累计用量',
  totalGranted: '上游累计授予',
  totalAvailable: '上游可用额度',
  note: '以下为 1701 上游平台数据，不是用户 AI 积分。',
} as const;

export const adminLlmProviderController = {
  async status(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await probeLlmProviderStatus();
      res.json({
        success: true,
        data: {
          ...data,
          scope: 'upstream',
          labels: {
            title: UPSTREAM_LABELS.statusTitle,
            note: UPSTREAM_LABELS.note,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async quota(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await fetchLlmProviderQuota();
      res.json({
        success: true,
        data: {
          ...data,
          scope: 'upstream',
          labels: {
            title: UPSTREAM_LABELS.quotaTitle,
            totalUsed: UPSTREAM_LABELS.totalUsed,
            totalGranted: UPSTREAM_LABELS.totalGranted,
            totalAvailable: UPSTREAM_LABELS.totalAvailable,
            note: UPSTREAM_LABELS.note,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
