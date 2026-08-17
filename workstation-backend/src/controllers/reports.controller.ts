import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { reportService } from '../services/report.service';
import { AppError } from '../utils/errors';

export const reportsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }
      const reports = await reportService.getUserReports(req.org.organizationId);
      res.json({ success: true, data: reports });
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }
      const report = await reportService.getReportById(
        req.org.organizationId,
        String(req.params.reportId),
      );
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  },

  async mockCreate(req: Request, res: Response, next: NextFunction) {
    try {
      if (env.nodeEnv === 'production') {
        throw new AppError(404, '接口不存在', 'NOT_FOUND');
      }
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const report = await reportService.createReport({
        userId: req.user!.id,
        organizationId: req.org.organizationId,
        agentId: 'hr',
        title: 'HR 分析报告（Mock）',
        task: '分析员工考勤与绩效数据，识别异常趋势',
        content: `# HR 分析报告（Mock）

## 概述
这是开发环境用的模拟报告，用于测试 reports 模块。

## 关键发现
- 研发部门平均出勤率 96%
- 销售部门绩效分布较为均衡

## 建议
- 继续跟进低出勤记录
- 下月复测销售 KPI 数据`,
        summary: 'Mock 报告：研发出勤良好，销售绩效均衡',
        status: 'completed',
        creditCost: 20,
      });

      res.status(201).json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  },
};
