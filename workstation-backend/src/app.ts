import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { checkDatabaseHealth } from './config/database';
import { env } from './config/env';
import { errorMiddleware } from './middleware/error.middleware';
import {
  requestContextMiddleware,
  securityHeadersMiddleware,
} from './middleware/security.middleware';
import { AppError } from './utils/errors';
import { initLlmRuntimeFromEnv } from './providers/llm';
import agentsRoutes from './routes/agents.routes';
import authRoutes from './routes/auth.routes';
import filesRoutes from './routes/files.routes';
import userRoutes from './routes/user.routes';
import reportsRoutes from './routes/reports.routes';
import usageRoutes from './routes/usage.routes';
import v1AiRoutes from './routes/v1/ai.routes';
import v1ChatRoutes from './routes/v1/chat.routes';
import v1ConversationRoutes from './routes/v1/conversation.routes';
import v1AuthRoutes from './routes/v1/auth.routes';
import v1LicenseAccountRoutes from './routes/v1/licenseAccount.routes';
import v1LicensesRoutes from './routes/v1/licenses.routes';
import v1OrganizationsRoutes from './routes/v1/organizations.routes';
import v1AccountRoutes from './routes/v1/account.routes';
import v1CreditsRoutes from './routes/v1/credits.routes';
import v1PaymentRoutes from './routes/v1/payment.routes';
import v1RechargeRoutes from './routes/v1/recharge.routes';
import v1AdminRoutes from './routes/v1/admin.routes';
import v1FeedbackRoutes from './routes/v1/feedback.routes';
import v1LeadsRoutes from './routes/v1/leads.routes';
import v1SalesRoutes from './routes/v1/sales.routes';
import v1SystemRoutes from './routes/v1/system.routes';

async function healthHandler(deep: boolean) {
  if (!deep) {
    return {
      status: 'ok',
      message: 'backend is running',
      env: env.nodeEnv,
    };
  }

  const db = await checkDatabaseHealth();
  return {
    status: db.ok ? 'ok' : 'degraded',
    message: db.ok ? 'backend and database are healthy' : 'database check failed',
    env: env.nodeEnv,
    database: db,
  };
}

export function createApp() {
  // Safe to call repeatedly; ensures AI availability flag is set even when
  // tests boot the app without going through server.ts.
  initLlmRuntimeFromEnv();

  const app = express();

  app.set('trust proxy', 1);
  app.use(requestContextMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        // Wildcard only allowed outside production (env validator blocks * in prod).
        if (!env.isProduction && env.corsOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition', 'X-File-Name'],
    }),
  );
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  // Public assets (payment QR codes, etc.) — no auth
  app.use(
    '/static',
    express.static(path.resolve(process.cwd(), 'public'), {
      maxAge: env.isProduction ? '1d' : 0,
      index: false,
    }),
  );
  // User avatars (written under UPLOAD_DIR/avatars)
  app.use(
    '/static/avatars',
    express.static(path.resolve(process.cwd(), env.uploadDir, 'avatars'), {
      maxAge: env.isProduction ? '7d' : 0,
      index: false,
    }),
  );

  app.get('/api/health', async (req, res, next) => {
    try {
      const deep = req.query.deep === '1' || req.query.deep === 'true';
      const payload = await healthHandler(deep);
      res.status(payload.status === 'ok' ? 200 : 503).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/health', async (req, res, next) => {
    try {
      const deep = req.query.deep === '1' || req.query.deep === 'true';
      const payload = await healthHandler(deep);
      res.status(payload.status === 'ok' ? 200 : 503).json({
        success: true,
        data: {
          ...payload,
          version: '2.0.0-auth',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/ready', async (_req, res, next) => {
    try {
      const db = await checkDatabaseHealth();
      if (!db.ok) {
        res.status(503).json({
          success: false,
          message: 'database not ready',
          code: 'NOT_READY',
        });
        return;
      }
      res.json({ success: true, data: { ready: true, database: db } });
    } catch (error) {
      next(error);
    }
  });

  // V1 business routes (JWT required where middleware applied)
  app.use('/api/agents', agentsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/usage', usageRoutes);

  // V2 surfaces
  app.use('/api/v1/ai', v1AiRoutes);
  app.use('/api/v1/chat', v1ChatRoutes);
  app.use('/api/v1/conversations', v1ConversationRoutes);
  app.use('/api/v1/auth', v1AuthRoutes);
  app.use('/api/v1', v1LicenseAccountRoutes);
  app.use('/api/v1', v1PaymentRoutes);
  app.use('/api/v1/licenses', v1LicensesRoutes);
  app.use('/api/v1/organizations', v1OrganizationsRoutes);
  app.use('/api/v1/account', v1AccountRoutes);
  app.use('/api/v1/credits', v1CreditsRoutes);
  app.use('/api/v1/recharge', v1RechargeRoutes);
  app.use('/api/v1/admin', v1AdminRoutes);
  app.use('/api/v1/feedback', v1FeedbackRoutes);
  app.use('/api/v1/leads', v1LeadsRoutes);
  app.use('/api/v1/sales', v1SalesRoutes);
  app.use('/api/v1/system', v1SystemRoutes);

  if (env.nodeEnv !== 'production') {
    app.get('/api/test-error', () => {
      throw new AppError(400, '测试错误信息', 'TEST_ERROR');
    });
  }

  app.use((_req, _res, next) => {
    next(new AppError(404, '接口不存在', 'NOT_FOUND'));
  });

  app.use(errorMiddleware);

  return app;
}
