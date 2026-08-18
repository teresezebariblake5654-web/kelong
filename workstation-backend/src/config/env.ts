import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { AI_PROVIDER_IDS, type AiProviderId } from '../providers/llm/providerCatalog';

function loadEnvFiles(): void {
  const cwd = process.cwd();
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const files = ['.env', `.env.${nodeEnv}`, '.env.local'];

  for (const file of files) {
    const fullPath = path.resolve(cwd, file);
    if (fs.existsSync(fullPath)) {
      // Do not override variables already provided by the process/shell/CI.
      dotenv.config({ path: fullPath, override: false });
    }
  }
}

loadEnvFiles();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  });

const aiProviderSchema = z.enum(AI_PROVIDER_IDS);

const PLACEHOLDER_SECRET_RE =
  /^(replace-with|changeme|change-me|your[-_]?secret|todo|xxx|test[-_]?secret|dev[-_]?secret)/i;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Bind address. production is forced to 127.0.0.1 after parse. */
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3001),
    APP_BASE_URL: z.string().default('http://localhost:3001'),
    WEB_BASE_URL: z.string().default('http://localhost:5173'),

    /** When false, all HTTP rate limiters are no-ops (dev/test only). */
    RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
    LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    SIGNUP_BONUS_CREDITS_MAX: z.coerce.number().int().positive().default(50_000),
    CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    CHAT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    AI_CONCURRENCY_LIMIT: z.coerce.number().int().positive().default(2),
    FEEDBACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),
    FEEDBACK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_DATABASE_URL: z.string().min(1).optional(),
    DB_SSL: booleanFromEnv.default(false),
    DB_SSL_REJECT_UNAUTHORIZED: booleanFromEnv.default(true),
    DB_POOL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DB_POOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    /** Preferred alias; falls back to MODEL_PROVIDER when unset. */
    AI_PROVIDER: aiProviderSchema.optional(),
    MODEL_PROVIDER: aiProviderSchema.default('mock'),

    /** 通用 OpenAI 兼容接入（优先于厂商专用变量） */
    LLM_API_KEY: z.string().optional().default(''),
    LLM_BASE_URL: z.string().optional().default(''),
    LLM_MODEL: z.string().optional().default(''),

    OPENAI_API_KEY: z.string().optional().default(''),
    OPENAI_BASE_URL: z.string().optional().default(''),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    DEEPSEEK_API_KEY: z.string().optional().default(''),
    DEEPSEEK_BASE_URL: z.string().optional().default('https://api.deepseek.com'),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    AI_MAX_INPUT_BYTES: z.coerce.number().int().positive().default(65_536),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32_768).default(2_048),
    /** Credits charged per 1000 input tokens (App product credits). */
    AI_INPUT_CREDIT_PER_1K_TOKENS: z.coerce.number().nonnegative().default(30),
    /** Credits charged per 1000 output/completion tokens. */
    AI_OUTPUT_CREDIT_PER_1K_TOKENS: z.coerce.number().nonnegative().default(120),
    /** @deprecated Prefer mode-specific mins; kept as CHAT fallback. */
    AI_MIN_CREDIT_COST: z.coerce.number().int().nonnegative().default(20),
    AI_CHAT_MULTIPLIER: z.coerce.number().positive().default(1),
    AI_CHAT_MIN_CREDIT_COST: z.coerce.number().int().nonnegative().default(20),
    AI_AGENT_MULTIPLIER: z.coerce.number().positive().default(2),
    AI_AGENT_MIN_CREDIT_COST: z.coerce.number().int().nonnegative().default(300),
    AI_AGENT_MAX_CREDIT_PER_RUN: z.coerce.number().int().positive().default(20_000),
    AI_AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
    AI_WORKFLOW_MULTIPLIER: z.coerce.number().positive().default(2.5),
    AI_WORKFLOW_MIN_CREDIT_COST: z.coerce.number().int().nonnegative().default(500),
    CREDIT_LOW_BALANCE_THRESHOLD: z.coerce.number().int().nonnegative().default(5_000),
    SIGNUP_BONUS_CREDITS: z.coerce.number().int().nonnegative().default(20_000),
    /** User-facing product name only; does not affect DB or billing math. */
    CREDIT_DISPLAY_NAME: z.string().min(1).default('AI积分'),
    UPLOAD_DIR: z.string().default('uploads'),
    DEFAULT_USER_CREDITS: z.coerce.number().int().nonnegative().default(1000),
    DEVICE_BINDING_LIMIT: z.coerce.number().int().positive().default(2),
    /** When false, AI analyze skips license product/credit enforcement (local tonight). */
    LICENSE_ENFORCEMENT_ENABLED: booleanFromEnv.default(true),
    LICENSE_TOKEN_SECRET: z.string().min(32).optional(),
    LICENSE_TOKEN_TTL: z.string().default('15m'),
    LICENSE_HASH_PEPPER: z.string().min(32).optional(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    COOKIE_SECURE: booleanFromEnv.optional(),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().optional().default(''),
    REFRESH_COOKIE_NAME: z.string().default('refresh_token'),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    AI_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    AI_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    ALLOW_DEMO_USER: booleanFromEnv.default(true),

    DEMO_USER_PASSWORD: z.string().min(8).default('DemoPass123!'),

    /** mock=dev only; manual=扫码人工确认; wechat/alipay=SDK（未接好前勿开） */
    DEFAULT_PAYMENT_PROVIDER: z.enum(['mock', 'manual', 'wechat', 'alipay']).default('mock'),
    MOCK_PAYMENT_SECRET: z.string().min(16).default('dev-mock-payment-secret'),
    WECHAT_PAY_ENABLED: booleanFromEnv.default(false),
    ALIPAY_ENABLED: booleanFromEnv.default(false),

    /** Manual recharge QR / copy (Phase 7 settings; URLs may be empty). */
    PAYMENT_WECHAT_QR_URL: z.string().optional().default(''),
    /** Per-plan WeChat fixed-amount QR codes (yuan). */
    PAYMENT_WECHAT_QR_URL_50: z.string().optional().default(''),
    PAYMENT_WECHAT_QR_URL_100: z.string().optional().default(''),
    PAYMENT_WECHAT_QR_URL_500: z.string().optional().default(''),
    PAYMENT_ALIPAY_QR_URL: z.string().optional().default(''),
    /** Per-plan Alipay fixed-amount QR codes (yuan). */
    PAYMENT_ALIPAY_QR_URL_50: z.string().optional().default(''),
    PAYMENT_ALIPAY_QR_URL_100: z.string().optional().default(''),
    PAYMENT_ALIPAY_QR_URL_500: z.string().optional().default(''),
    PAYMENT_PAYEE_NAME: z.string().optional().default(''),
    PAYMENT_SUPPORT_TEXT: z.string().optional().default(''),
    PAYMENT_NOTICE: z.string().optional().default(''),

    /** Email OTP — mock | smtp | ses-api（腾讯云邮件推送模板 API）. */
    MAIL_PROVIDER: z.enum(['smtp', 'mock', 'ses-api']).default('mock'),
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: booleanFromEnv.default(true),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    MAIL_FROM: z.string().optional().default(''),
    MAIL_FROM_NAME: z.string().optional().default('AI工作站'),
    /** Tencent Cloud CAM keys for SES API (SendEmail template). */
    TENCENT_SECRET_ID: z.string().optional().default(''),
    TENCENT_SECRET_KEY: z.string().optional().default(''),
    TENCENT_SES_REGION: z.enum(['ap-guangzhou', 'ap-hongkong']).default('ap-guangzhou'),
  /** SES console template ID for OTP (variables: username, verify_code). */
  TENCENT_SES_OTP_TEMPLATE_ID: z.coerce.number().int().nonnegative().default(0),
    /** Inbox that receives in-app help feedback emails (server-only, never exposed to UI). */
    FEEDBACK_INBOX_EMAIL: z.string().email().optional().default('jq202604@126.com'),
    /** Optional dedicated SMTP for feedback (e.g. smtp.126.com + 授权码). */
    FEEDBACK_SMTP_HOST: z.string().optional().default(''),
    FEEDBACK_SMTP_PORT: z.coerce.number().int().positive().default(465),
    FEEDBACK_SMTP_SECURE: booleanFromEnv.default(true),
    FEEDBACK_SMTP_USER: z.string().optional().default(''),
    FEEDBACK_SMTP_PASS: z.string().optional().default(''),
    FEEDBACK_SMTP_FROM: z.string().optional().default(''),
    EMAIL_OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
    EMAIL_OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive().default(60),
    EMAIL_OTP_DAILY_LIMIT: z.coerce.number().int().positive().default(10),

    /** Lead discovery dry-run providers (optional until configured). */
    SEARXNG_BASE_URL: z.string().optional().default(''),
    SEARXNG_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    KEELEAD_BASE_URL: z.string().optional().default(''),
    KEELEAD_PROVIDER_KEY: z.string().optional().default(''),
    KEELEAD_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    /** e.g. http://127.0.0.1:3002 — fill from your running Firecrawl; do not invent. */
    FIRECRAWL_BASE_URL: z.string().optional().default(''),
    FIRECRAWL_API_KEY: z.string().optional().default(''),
    FIRECRAWL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

    /**
     * Isolated LobsterAI job-queue Redis.
     * Do not point this at Firecrawl's internal Redis.
     */
    LEAD_QUEUE_REDIS_HOST: z.string().min(1).default('127.0.0.1'),
    LEAD_QUEUE_REDIS_PORT: z.coerce.number().int().positive().default(6379),
    LEAD_QUEUE_REDIS_USERNAME: z.string().optional().default(''),
    LEAD_QUEUE_REDIS_PASSWORD: z.string().optional().default(''),
    LEAD_QUEUE_REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
    LEAD_DISCOVERY_QUEUE_NAME: z.string().min(1).default('lead-discovery'),
    LEAD_DISCOVERY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(1),
    /** Acquisition Agent hard limits (LLM cannot override). */
    LEAD_AGENT_MAX_SEARCH_ROUNDS: z.coerce.number().int().min(1).max(20).default(3),
    LEAD_AGENT_MAX_QUERIES_PER_ROUND: z.coerce.number().int().min(1).max(20).default(5),
    LEAD_AGENT_MAX_TOTAL_QUERIES: z.coerce.number().int().min(1).max(50).default(10),
    LEAD_AGENT_MAX_RESEARCH_COMPANIES: z.coerce.number().int().min(1).max(50).default(20),
    LEAD_AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    LEAD_MAX_TARGET_COUNT: z.coerce.number().int().min(1).max(500).default(100),
    LEAD_MAX_ACTIVE_TASKS_PER_ORG: z.coerce.number().int().min(1).max(50).default(2),
    LEAD_RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(5).optional(),
    LEAD_FIRECRAWL_RESEARCH_CONCURRENCY: z.coerce.number().int().min(1).max(5).optional(),
    LEAD_EMAIL_VERIFY_CONCURRENCY: z.coerce.number().int().min(1).max(8).optional(),
    LEAD_KEELEAD_VERIFY_CONCURRENCY: z.coerce.number().int().min(1).max(8).optional(),
    LEAD_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(3).optional(),
    LEAD_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(3).optional(),
    LEAD_PROVIDER_RETRY_BASE_MS: z.coerce.number().int().min(50).max(5_000).default(250),
    LEAD_SEARXNG_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    LEAD_FIRECRAWL_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    LEAD_KEELEAD_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

    /** Optional sales SMTP override; falls back to shared SMTP_* / MAIL_FROM. */
    SALES_EMAIL_HOST: z.string().optional().default(''),
    SALES_EMAIL_PORT: z.coerce.number().int().positive().optional(),
    SALES_EMAIL_SECURE: booleanFromEnv.optional(),
    SALES_EMAIL_USER: z.string().optional().default(''),
    SALES_EMAIL_PASSWORD: z.string().optional().default(''),
    SALES_EMAIL_FROM: z.string().optional().default(''),
    SALES_EMAIL_WEBHOOK_SECRET: z.string().optional().default(''),

    WHATSAPP_GRAPH_BASE_URL: z.string().optional().default('https://graph.facebook.com/v21.0'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
    WHATSAPP_APP_SECRET: z.string().optional().default(''),

    SALES_OUTBOUND_QUEUE_NAME: z.string().min(1).default('sales-outbound'),
    SALES_OUTBOUND_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(1),

    SALES_AGENT_QUEUE_NAME: z.string().min(1).default('sales-agent'),
    SALES_AGENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    SALES_AGENT_MAX_OUTBOUND_PER_PROSPECT: z.coerce.number().int().min(1).max(50).default(8),
    SALES_AGENT_MIN_FOLLOWUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    SALES_AGENT_CONTEXT_MESSAGE_LIMIT: z.coerce.number().int().min(5).max(50).default(20),
    SALES_AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    SALES_AGENT_FOLLOWUP_SCAN_INTERVAL_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(300_000),
    SALES_MAX_OUTBOUND_PER_ORG_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(120),
  })
  .superRefine((data, ctx) => {
    if (data.COOKIE_SAME_SITE === 'none' && data.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true when SameSite=None',
      });
    }
    if (data.NODE_ENV === 'production' && !data.LICENSE_TOKEN_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LICENSE_TOKEN_SECRET'],
        message: 'LICENSE_TOKEN_SECRET is required in production',
      });
    }
    if (data.NODE_ENV === 'production' && !data.LICENSE_HASH_PEPPER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LICENSE_HASH_PEPPER'],
        message: 'LICENSE_HASH_PEPPER is required in production',
      });
    }
    if (data.NODE_ENV === 'production') {
      const host = data.HOST.trim() || '127.0.0.1';
      if (host !== '127.0.0.1' && host !== '::1') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['HOST'],
          message: 'production requires HOST=127.0.0.1 (nginx reverse-proxy only)',
        });
      }
      if (data.RATE_LIMIT_ENABLED === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RATE_LIMIT_ENABLED'],
          message: 'RATE_LIMIT_ENABLED=false is forbidden in production',
        });
      }
      if (data.COOKIE_SECURE === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production',
        });
      }
      if (PLACEHOLDER_SECRET_RE.test(data.JWT_ACCESS_SECRET.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must not be a placeholder/default value in production',
        });
      }
      if (data.SIGNUP_BONUS_CREDITS > data.SIGNUP_BONUS_CREDITS_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SIGNUP_BONUS_CREDITS'],
          message: `SIGNUP_BONUS_CREDITS must be <= SIGNUP_BONUS_CREDITS_MAX (${data.SIGNUP_BONUS_CREDITS_MAX})`,
        });
      }
      const provider = data.AI_PROVIDER ?? data.MODEL_PROVIDER;
      if (provider === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MODEL_PROVIDER'],
          message: 'MODEL_PROVIDER/AI_PROVIDER=mock is forbidden in production',
        });
      }
      if (data.DEFAULT_PAYMENT_PROVIDER === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEFAULT_PAYMENT_PROVIDER'],
          message:
            'DEFAULT_PAYMENT_PROVIDER=mock is forbidden in production (use manual 扫码充值, or wechat/alipay when ready)',
        });
      }
      const origins = data.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean);
      if (origins.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS=* is forbidden in production',
        });
      }
      if (data.ALLOW_DEMO_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ALLOW_DEMO_USER'],
          message: 'ALLOW_DEMO_USER must be false in production',
        });
      }
      if (!data.LICENSE_ENFORCEMENT_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LICENSE_ENFORCEMENT_ENABLED'],
          message: 'LICENSE_ENFORCEMENT_ENABLED must be true in production',
        });
      }
      if (data.MAIL_PROVIDER === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MAIL_PROVIDER'],
          message: 'MAIL_PROVIDER=mock is forbidden in production; use smtp or ses-api',
        });
      }
      if (data.MAIL_PROVIDER === 'smtp') {
        for (const [key, value] of [
          ['SMTP_HOST', data.SMTP_HOST],
          ['SMTP_USER', data.SMTP_USER],
          ['SMTP_PASS', data.SMTP_PASS],
          ['MAIL_FROM', data.MAIL_FROM],
        ] as const) {
          if (!value?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} is required when MAIL_PROVIDER=smtp`,
            });
          }
        }
      }
      if (data.MAIL_PROVIDER === 'ses-api') {
        for (const [key, value] of [
          ['TENCENT_SECRET_ID', data.TENCENT_SECRET_ID],
          ['TENCENT_SECRET_KEY', data.TENCENT_SECRET_KEY],
          ['MAIL_FROM', data.MAIL_FROM],
        ] as const) {
          if (!value?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} is required when MAIL_PROVIDER=ses-api`,
            });
          }
        }
        if (!data.TENCENT_SES_OTP_TEMPLATE_ID || data.TENCENT_SES_OTP_TEMPLATE_ID <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['TENCENT_SES_OTP_TEMPLATE_ID'],
            message: 'TENCENT_SES_OTP_TEMPLATE_ID is required when MAIL_PROVIDER=ses-api',
          });
        }
      }
    }
    const provider = data.AI_PROVIDER ?? data.MODEL_PROVIDER;
    if (provider === 'mock') return;

    const hasUniversalKey = Boolean(data.LLM_API_KEY?.trim());
    const hasOpenAiKey = Boolean(data.OPENAI_API_KEY?.trim());
    const hasDeepSeekKey = Boolean(data.DEEPSEEK_API_KEY?.trim());
    const hasAnyKey = hasUniversalKey || hasOpenAiKey || hasDeepSeekKey;

    if (!hasAnyKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_API_KEY'],
        message:
          'LLM_API_KEY（推荐）或 OPENAI_API_KEY / DEEPSEEK_API_KEY 至少配置一个，当 MODEL_PROVIDER 非 mock 时必填',
      });
    }

    if (
      provider === 'custom' &&
      !data.LLM_BASE_URL?.trim() &&
      !data.OPENAI_BASE_URL?.trim() &&
      !data.DEEPSEEK_BASE_URL?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_BASE_URL'],
        message: 'MODEL_PROVIDER=custom 时必须设置 LLM_BASE_URL',
      });
    }

    // Production: all real AI traffic must use HTTPS LLM_BASE_URL + LLM_API_KEY (1701).
    if (data.NODE_ENV === 'production') {
      if (!data.LLM_API_KEY?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LLM_API_KEY'],
          message: 'production requires LLM_API_KEY for upstream model calls',
        });
      }
      if (!data.LLM_BASE_URL?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LLM_BASE_URL'],
          message: 'production requires LLM_BASE_URL (e.g. https://1701.store/v1)',
        });
      } else if (!/^https:\/\//i.test(data.LLM_BASE_URL.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LLM_BASE_URL'],
          message: 'LLM_BASE_URL must be HTTPS in production',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${details}`);
}

const raw = parsed.data;

function withQueryParams(url: string, params: Record<string, string | number | boolean>): string {
  const hasQuery = url.includes('?');
  const pieces = Object.entries(params).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
  );
  if (pieces.length === 0) return url;
  return `${url}${hasQuery ? '&' : '?'}${pieces.join('&')}`;
}

const databaseUrl = withQueryParams(raw.DATABASE_URL, {
  connection_limit: raw.DB_POOL_CONNECTION_LIMIT,
  pool_timeout: Math.max(1, Math.ceil(raw.DB_POOL_TIMEOUT_MS / 1000)),
  connect_timeout: Math.max(1, Math.ceil(raw.DB_CONNECT_TIMEOUT_MS / 1000)),
  ...(raw.DB_SSL
    ? {
        sslmode: 'require',
      }
    : {}),
});

const directDatabaseUrl = withQueryParams(raw.DIRECT_DATABASE_URL ?? raw.DATABASE_URL, {
  connect_timeout: Math.max(1, Math.ceil(raw.DB_CONNECT_TIMEOUT_MS / 1000)),
  ...(raw.DB_SSL
    ? {
        sslmode: 'require',
      }
    : {}),
});

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_DATABASE_URL = directDatabaseUrl;

export type AppEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  host: string;
  port: number;
  rateLimitEnabled: boolean;
  llmRequestTimeoutMs: number;
  signupBonusCreditsMax: number;
  chatRateLimitWindowMs: number;
  chatRateLimitMax: number;
  aiConcurrencyLimit: number;
  feedbackRateLimitWindowMs: number;
  feedbackRateLimitMax: number;
  uploadRateLimitWindowMs: number;
  uploadRateLimitMax: number;
  appBaseUrl: string;
  webBaseUrl: string;
  databaseUrl: string;
  directDatabaseUrl: string;
  dbSsl: boolean;
  dbSslRejectUnauthorized: boolean;
  dbPoolConnectionLimit: number;
  dbConnectTimeoutMs: number;
  dbPoolTimeoutMs: number;
  modelProvider: AiProviderId;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  aiMaxInputBytes: number;
  aiMaxOutputTokens: number;
  aiInputCreditPer1kTokens: number;
  aiOutputCreditPer1kTokens: number;
  aiMinCreditCost: number;
  aiChatMultiplier: number;
  aiChatMinCreditCost: number;
  aiAgentMultiplier: number;
  aiAgentMinCreditCost: number;
  aiAgentMaxCreditPerRun: number;
  aiAgentMaxSteps: number;
  aiWorkflowMultiplier: number;
  aiWorkflowMinCreditCost: number;
  creditLowBalanceThreshold: number;
  signupBonusCredits: number;
  creditDisplayName: string;
  uploadDir: string;
  defaultUserCredits: number;
  deviceBindingLimit: number;
  licenseEnforcementEnabled: boolean;
  licenseTokenSecret: string;
  licenseTokenTtl: string;
  licenseHashPepper: string;
  jwtAccessSecret: string;
  jwtAccessTtl: string;
  refreshTokenTtlDays: number;
  bcryptRounds: number;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  cookieDomain?: string;
  refreshCookieName: string;
  corsOrigins: string[];
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  aiRateLimitWindowMs: number;
  aiRateLimitMax: number;
  allowDemoUser: boolean;
  demoUserPassword: string;
  defaultPaymentProvider: 'mock' | 'manual' | 'wechat' | 'alipay';
  mockPaymentSecret: string;
  wechatPayEnabled: boolean;
  alipayEnabled: boolean;
  paymentWechatQrUrl: string;
  paymentWechatQrUrl50: string;
  paymentWechatQrUrl100: string;
  paymentWechatQrUrl500: string;
  paymentAlipayQrUrl: string;
  paymentAlipayQrUrl50: string;
  paymentAlipayQrUrl100: string;
  paymentAlipayQrUrl500: string;
  paymentPayeeName: string;
  paymentSupportText: string;
  paymentNotice: string;
  mailProvider: 'smtp' | 'mock' | 'ses-api';
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  mailFrom: string;
  mailFromName: string;
  tencentSecretId: string;
  tencentSecretKey: string;
  tencentSesRegion: 'ap-guangzhou' | 'ap-hongkong';
  tencentSesOtpTemplateId: number;
  feedbackInboxEmail: string;
  feedbackSmtpHost: string;
  feedbackSmtpPort: number;
  feedbackSmtpSecure: boolean;
  feedbackSmtpUser: string;
  feedbackSmtpPass: string;
  feedbackSmtpFrom: string;
  emailOtpTtlSec: number;
  emailOtpResendCooldownSec: number;
  emailOtpDailyLimit: number;
  searxngBaseUrl: string;
  searxngTimeoutMs: number;
  keeleadBaseUrl: string;
  keeleadProviderKey: string;
  keeleadTimeoutMs: number;
  firecrawlBaseUrl: string;
  firecrawlApiKey: string;
  firecrawlTimeoutMs: number;
  leadQueueRedisHost: string;
  leadQueueRedisPort: number;
  leadQueueRedisUsername: string;
  leadQueueRedisPassword: string;
  leadQueueRedisDb: number;
  leadDiscoveryQueueName: string;
  leadDiscoveryWorkerConcurrency: number;
  leadAgentMaxSearchRounds: number;
  leadAgentMaxQueriesPerRound: number;
  leadAgentMaxTotalQueries: number;
  leadAgentMaxResearchCompanies: number;
  leadAgentLlmTimeoutMs: number;
  leadMaxTargetCount: number;
  leadMaxActiveTasksPerOrg: number;
  leadResearchConcurrency: number;
  leadEmailVerifyConcurrency: number;
  leadProviderRetryAttempts: number;
  leadProviderRetryBaseMs: number;
  salesEmailHost: string;
  salesEmailPort: number;
  salesEmailSecure: boolean;
  salesEmailUser: string;
  salesEmailPassword: string;
  salesEmailFrom: string;
  salesEmailWebhookSecret: string;
  whatsappGraphBaseUrl: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  whatsappVerifyToken: string;
  whatsappAppSecret: string;
  salesOutboundQueueName: string;
  salesOutboundWorkerConcurrency: number;
  salesAgentQueueName: string;
  salesAgentWorkerConcurrency: number;
  salesAgentMaxOutboundPerProspect: number;
  salesAgentMinFollowupIntervalHours: number;
  salesAgentContextMessageLimit: number;
  salesAgentLlmTimeoutMs: number;
  salesAgentFollowupScanIntervalMs: number;
  salesMaxOutboundPerOrgPerHour: number;
};

const resolvedHost =
  raw.NODE_ENV === 'production' ? '127.0.0.1' : (raw.HOST.trim() || '127.0.0.1');

export const env: AppEnv = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  host: resolvedHost,
  port: raw.PORT,
  rateLimitEnabled: raw.RATE_LIMIT_ENABLED,
  llmRequestTimeoutMs: Math.min(raw.LLM_REQUEST_TIMEOUT_MS, 120_000),
  signupBonusCreditsMax: raw.SIGNUP_BONUS_CREDITS_MAX,
  chatRateLimitWindowMs: raw.CHAT_RATE_LIMIT_WINDOW_MS,
  chatRateLimitMax: raw.CHAT_RATE_LIMIT_MAX,
  aiConcurrencyLimit: raw.AI_CONCURRENCY_LIMIT,
  feedbackRateLimitWindowMs: raw.FEEDBACK_RATE_LIMIT_WINDOW_MS,
  feedbackRateLimitMax: raw.FEEDBACK_RATE_LIMIT_MAX,
  uploadRateLimitWindowMs: raw.UPLOAD_RATE_LIMIT_WINDOW_MS,
  uploadRateLimitMax: raw.UPLOAD_RATE_LIMIT_MAX,
  appBaseUrl: raw.APP_BASE_URL,
  webBaseUrl: raw.WEB_BASE_URL,
  databaseUrl,
  directDatabaseUrl,
  dbSsl: raw.DB_SSL,
  dbSslRejectUnauthorized: raw.DB_SSL_REJECT_UNAUTHORIZED,
  dbPoolConnectionLimit: raw.DB_POOL_CONNECTION_LIMIT,
  dbConnectTimeoutMs: raw.DB_CONNECT_TIMEOUT_MS,
  dbPoolTimeoutMs: raw.DB_POOL_TIMEOUT_MS,
  modelProvider: raw.AI_PROVIDER ?? raw.MODEL_PROVIDER,
  llmApiKey: raw.LLM_API_KEY,
  llmBaseUrl: raw.LLM_BASE_URL,
  llmModel: raw.LLM_MODEL,
  openaiApiKey: raw.OPENAI_API_KEY,
  openaiBaseUrl: raw.OPENAI_BASE_URL,
  openaiModel: raw.OPENAI_MODEL,
  deepseekApiKey: raw.DEEPSEEK_API_KEY,
  deepseekBaseUrl: raw.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  deepseekModel: raw.DEEPSEEK_MODEL,
  aiMaxInputBytes: raw.AI_MAX_INPUT_BYTES,
  aiMaxOutputTokens: raw.AI_MAX_OUTPUT_TOKENS,
  aiInputCreditPer1kTokens: raw.AI_INPUT_CREDIT_PER_1K_TOKENS,
  aiOutputCreditPer1kTokens: raw.AI_OUTPUT_CREDIT_PER_1K_TOKENS,
  aiMinCreditCost: raw.AI_MIN_CREDIT_COST,
  aiChatMultiplier: raw.AI_CHAT_MULTIPLIER,
  aiChatMinCreditCost: raw.AI_CHAT_MIN_CREDIT_COST,
  aiAgentMultiplier: raw.AI_AGENT_MULTIPLIER,
  aiAgentMinCreditCost: raw.AI_AGENT_MIN_CREDIT_COST,
  aiAgentMaxCreditPerRun: raw.AI_AGENT_MAX_CREDIT_PER_RUN,
  aiAgentMaxSteps: raw.AI_AGENT_MAX_STEPS,
  aiWorkflowMultiplier: raw.AI_WORKFLOW_MULTIPLIER,
  aiWorkflowMinCreditCost: raw.AI_WORKFLOW_MIN_CREDIT_COST,
  creditLowBalanceThreshold: raw.CREDIT_LOW_BALANCE_THRESHOLD,
  signupBonusCredits: raw.SIGNUP_BONUS_CREDITS,
  creditDisplayName: raw.CREDIT_DISPLAY_NAME,
  uploadDir: raw.UPLOAD_DIR,
  defaultUserCredits: raw.DEFAULT_USER_CREDITS,
  deviceBindingLimit: raw.DEVICE_BINDING_LIMIT,
  licenseEnforcementEnabled: raw.LICENSE_ENFORCEMENT_ENABLED,
  licenseTokenSecret: raw.LICENSE_TOKEN_SECRET ?? raw.JWT_ACCESS_SECRET,
  licenseTokenTtl: raw.LICENSE_TOKEN_TTL,
  licenseHashPepper: raw.LICENSE_HASH_PEPPER ?? raw.JWT_ACCESS_SECRET,
  jwtAccessSecret: raw.JWT_ACCESS_SECRET,
  jwtAccessTtl: raw.JWT_ACCESS_TTL,
  refreshTokenTtlDays: raw.REFRESH_TOKEN_TTL_DAYS,
  bcryptRounds: raw.BCRYPT_ROUNDS,
  cookieSecure: raw.COOKIE_SECURE ?? raw.NODE_ENV === 'production',
  cookieSameSite: raw.COOKIE_SAME_SITE,
  cookieDomain: raw.COOKIE_DOMAIN || undefined,
  refreshCookieName: raw.REFRESH_COOKIE_NAME,
  corsOrigins: raw.CORS_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean),
  authRateLimitWindowMs: raw.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitMax: raw.AUTH_RATE_LIMIT_MAX,
  aiRateLimitWindowMs: raw.AI_RATE_LIMIT_WINDOW_MS,
  aiRateLimitMax: raw.AI_RATE_LIMIT_MAX,
  allowDemoUser: raw.ALLOW_DEMO_USER,
  demoUserPassword: raw.DEMO_USER_PASSWORD,
  defaultPaymentProvider: raw.DEFAULT_PAYMENT_PROVIDER,
  mockPaymentSecret: raw.MOCK_PAYMENT_SECRET,
  wechatPayEnabled: raw.WECHAT_PAY_ENABLED,
  alipayEnabled: raw.ALIPAY_ENABLED,
  paymentWechatQrUrl: raw.PAYMENT_WECHAT_QR_URL.trim(),
  paymentWechatQrUrl50: raw.PAYMENT_WECHAT_QR_URL_50.trim(),
  paymentWechatQrUrl100: raw.PAYMENT_WECHAT_QR_URL_100.trim(),
  paymentWechatQrUrl500: raw.PAYMENT_WECHAT_QR_URL_500.trim(),
  paymentAlipayQrUrl: raw.PAYMENT_ALIPAY_QR_URL.trim(),
  paymentAlipayQrUrl50: raw.PAYMENT_ALIPAY_QR_URL_50.trim(),
  paymentAlipayQrUrl100: raw.PAYMENT_ALIPAY_QR_URL_100.trim(),
  paymentAlipayQrUrl500: raw.PAYMENT_ALIPAY_QR_URL_500.trim(),
  paymentPayeeName: raw.PAYMENT_PAYEE_NAME.trim(),
  paymentSupportText: raw.PAYMENT_SUPPORT_TEXT.trim(),
  paymentNotice: raw.PAYMENT_NOTICE.trim(),
  mailProvider: raw.MAIL_PROVIDER,
  smtpHost: raw.SMTP_HOST.trim(),
  smtpPort: raw.SMTP_PORT,
  smtpSecure: raw.SMTP_SECURE,
  smtpUser: raw.SMTP_USER.trim(),
  smtpPass: raw.SMTP_PASS,
  mailFrom: raw.MAIL_FROM.trim(),
  mailFromName: raw.MAIL_FROM_NAME.trim() || 'AI工作站',
  tencentSecretId: raw.TENCENT_SECRET_ID.trim(),
  tencentSecretKey: raw.TENCENT_SECRET_KEY,
  tencentSesRegion: raw.TENCENT_SES_REGION,
  tencentSesOtpTemplateId: raw.TENCENT_SES_OTP_TEMPLATE_ID,
  feedbackInboxEmail: raw.FEEDBACK_INBOX_EMAIL.trim() || 'jq202604@126.com',
  feedbackSmtpHost: raw.FEEDBACK_SMTP_HOST.trim(),
  feedbackSmtpPort: raw.FEEDBACK_SMTP_PORT,
  feedbackSmtpSecure: raw.FEEDBACK_SMTP_SECURE,
  feedbackSmtpUser: raw.FEEDBACK_SMTP_USER.trim(),
  feedbackSmtpPass: raw.FEEDBACK_SMTP_PASS,
  feedbackSmtpFrom: raw.FEEDBACK_SMTP_FROM.trim(),
  emailOtpTtlSec: raw.EMAIL_OTP_TTL_SEC,
  emailOtpResendCooldownSec: raw.EMAIL_OTP_RESEND_COOLDOWN_SEC,
  emailOtpDailyLimit: raw.EMAIL_OTP_DAILY_LIMIT,
  searxngBaseUrl: raw.SEARXNG_BASE_URL.trim(),
  searxngTimeoutMs: Math.min(raw.LEAD_SEARXNG_TIMEOUT_MS ?? raw.SEARXNG_TIMEOUT_MS, 60_000),
  keeleadBaseUrl: raw.KEELEAD_BASE_URL.trim(),
  keeleadProviderKey: raw.KEELEAD_PROVIDER_KEY.trim(),
  keeleadTimeoutMs: Math.min(raw.LEAD_KEELEAD_TIMEOUT_MS ?? raw.KEELEAD_TIMEOUT_MS, 60_000),
  firecrawlBaseUrl: raw.FIRECRAWL_BASE_URL.trim(),
  firecrawlApiKey: raw.FIRECRAWL_API_KEY.trim(),
  firecrawlTimeoutMs: Math.min(raw.LEAD_FIRECRAWL_TIMEOUT_MS ?? raw.FIRECRAWL_TIMEOUT_MS, 120_000),
  leadQueueRedisHost: raw.LEAD_QUEUE_REDIS_HOST.trim() || '127.0.0.1',
  leadQueueRedisPort: raw.LEAD_QUEUE_REDIS_PORT,
  leadQueueRedisUsername: raw.LEAD_QUEUE_REDIS_USERNAME.trim(),
  leadQueueRedisPassword: raw.LEAD_QUEUE_REDIS_PASSWORD,
  leadQueueRedisDb: raw.LEAD_QUEUE_REDIS_DB,
  leadDiscoveryQueueName: raw.LEAD_DISCOVERY_QUEUE_NAME.trim() || 'lead-discovery',
  leadDiscoveryWorkerConcurrency: raw.LEAD_DISCOVERY_WORKER_CONCURRENCY,
  leadAgentMaxSearchRounds: raw.LEAD_AGENT_MAX_SEARCH_ROUNDS,
  leadAgentMaxQueriesPerRound: raw.LEAD_AGENT_MAX_QUERIES_PER_ROUND,
  leadAgentMaxTotalQueries: raw.LEAD_AGENT_MAX_TOTAL_QUERIES,
  leadAgentMaxResearchCompanies: raw.LEAD_AGENT_MAX_RESEARCH_COMPANIES,
  leadAgentLlmTimeoutMs: Math.min(raw.LEAD_AGENT_LLM_TIMEOUT_MS, 120_000),
  leadMaxTargetCount: raw.LEAD_MAX_TARGET_COUNT,
  leadMaxActiveTasksPerOrg: raw.LEAD_MAX_ACTIVE_TASKS_PER_ORG,
  leadResearchConcurrency:
    raw.LEAD_FIRECRAWL_RESEARCH_CONCURRENCY ?? raw.LEAD_RESEARCH_CONCURRENCY ?? 3,
  leadEmailVerifyConcurrency:
    raw.LEAD_KEELEAD_VERIFY_CONCURRENCY ?? raw.LEAD_EMAIL_VERIFY_CONCURRENCY ?? 5,
  leadProviderRetryAttempts: raw.LEAD_PROVIDER_MAX_RETRIES ?? raw.LEAD_PROVIDER_RETRY_ATTEMPTS ?? 2,
  leadProviderRetryBaseMs: raw.LEAD_PROVIDER_RETRY_BASE_MS,
  salesEmailHost: raw.SALES_EMAIL_HOST.trim(),
  salesEmailPort: raw.SALES_EMAIL_PORT ?? raw.SMTP_PORT,
  salesEmailSecure: raw.SALES_EMAIL_SECURE ?? raw.SMTP_SECURE,
  salesEmailUser: raw.SALES_EMAIL_USER.trim(),
  salesEmailPassword: raw.SALES_EMAIL_PASSWORD,
  salesEmailFrom: raw.SALES_EMAIL_FROM.trim(),
  salesEmailWebhookSecret: raw.SALES_EMAIL_WEBHOOK_SECRET,
  whatsappGraphBaseUrl: raw.WHATSAPP_GRAPH_BASE_URL.trim() || 'https://graph.facebook.com/v21.0',
  whatsappPhoneNumberId: raw.WHATSAPP_PHONE_NUMBER_ID.trim(),
  whatsappAccessToken: raw.WHATSAPP_ACCESS_TOKEN,
  whatsappVerifyToken: raw.WHATSAPP_VERIFY_TOKEN,
  whatsappAppSecret: raw.WHATSAPP_APP_SECRET,
  salesOutboundQueueName: raw.SALES_OUTBOUND_QUEUE_NAME.trim() || 'sales-outbound',
  salesOutboundWorkerConcurrency: raw.SALES_OUTBOUND_WORKER_CONCURRENCY,
  salesAgentQueueName: raw.SALES_AGENT_QUEUE_NAME.trim() || 'sales-agent',
  salesAgentWorkerConcurrency: raw.SALES_AGENT_WORKER_CONCURRENCY,
  salesAgentMaxOutboundPerProspect: raw.SALES_AGENT_MAX_OUTBOUND_PER_PROSPECT,
  salesAgentMinFollowupIntervalHours: raw.SALES_AGENT_MIN_FOLLOWUP_INTERVAL_HOURS,
  salesAgentContextMessageLimit: raw.SALES_AGENT_CONTEXT_MESSAGE_LIMIT,
  salesAgentLlmTimeoutMs: Math.min(raw.SALES_AGENT_LLM_TIMEOUT_MS, 120_000),
  salesAgentFollowupScanIntervalMs: raw.SALES_AGENT_FOLLOWUP_SCAN_INTERVAL_MS,
  salesMaxOutboundPerOrgPerHour: raw.SALES_MAX_OUTBOUND_PER_ORG_PER_HOUR,
};
